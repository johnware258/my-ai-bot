// api/index.js
// Vercel Serverless (CommonJS exports)
// Uses: @supabase/supabase-js and @google/generative-ai
// ENV required: SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_ANON_KEY not set.');
}
if (!GEMINI_API_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set.');
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Initialize Gemini client and model (re-used across invocations)
let genModel = null;
try {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  // Use gemini-1.5-flash model
  genModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
} catch (err) {
  // If initialization fails, we'll surface error when called.
  console.error('Failed to initialize GoogleGenerativeAI client:', err?.message || err);
  genModel = null;
}

/**
 * Simple lead detection (email or phone) in the message.
 * Adjust regexes to be stricter/looser as you prefer.
 */
function containsContactInfo(text) {
  if (!text || typeof text !== 'string') return false;
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const phoneRe = /(\+?\d{1,3}[-.\s]?)?(\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|\(\d{3}\)\s*\d{3}[-.\s]\d{4})/;
  return emailRe.test(text) || phoneRe.test(text);
}

/**
 * Safe extractor for different SDK response shapes.
 */
function extractTextFromGenResult(result) {
  // Many SDK samples show result.response.text() as the accessor.
  // We'll attempt several safe fallbacks.
  try {
    if (!result) return '';
    // 1) result.response.text() function
    if (result.response && typeof result.response.text === 'function') {
      return result.response.text();
    }
    // 2) result.response.text string
    if (result.response && typeof result.response.text === 'string') {
      return result.response.text;
    }
    // 3) candidates array fallback (older/alternate shapes)
    if (Array.isArray(result.candidates) && result.candidates[0]) {
      const c = result.candidates[0];
      if (c.content && Array.isArray(c.content.parts) && c.content.parts[0] && typeof c.content.parts[0].text === 'string') {
        return c.content.parts[0].text;
      }
    }
    // 4) as last resort, try JSON-stringify
    return JSON.stringify(result).slice(0, 2000); // truncate to avoid huge responses
  } catch (e) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  // CORS headers (allow any website domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  let body = req.body;
  // Vercel sometimes gives parsed body; if not, attempt to parse
  if (!body) {
    try {
      body = JSON.parse(req.rawBody || '{}');
    } catch (e) {
      // fallthrough
    }
  }

  const message = body?.message;
  const clientId = body?.client_id || body?.clientId || body?.client;

  if (!message || !clientId) {
    return res.status(400).json({ error: 'Request JSON must include "message" and "client_id".' });
  }

  // Fetch client-specific context from Supabase
  let clientContext = '';
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('context')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Supabase query error:', error.message || error);
      // continue with empty context
    } else if (data && typeof data.context === 'string') {
      clientContext = data.context;
    } else if (data && data.context === null) {
      clientContext = '';
    }
    // If no row found, clientContext remains ''
  } catch (err) {
    console.error('Unexpected Supabase error:', err?.message || err);
  }

  // Build a prompt that includes client context and user message
  // Adjust system / instruction text as you like.
  const prompt = [
    `You are an assistant for client: ${clientId}.`,
    'Use the client context below when answering the user. Keep answers concise, helpful, and professional.',
    '=== CLIENT CONTEXT START ===',
    clientContext || '[no context provided]',
    '=== CLIENT CONTEXT END ===',
    '',
    'User message:',
    message,
  ].join('\n');

  // Ensure the Gemini client was initialized
  if (!genModel) {
    return res.status(500).json({ error: 'AI client not initialized. Check GEMINI_API_KEY and server logs.' });
  }

  // Call Gemini to generate a response
  let aiText = '';
  try {
    // The library supports generateContent(prompt) per docs/samples.
    const genResult = await genModel.generateContent(prompt);
    aiText = extractTextFromGenResult(genResult) || '';
  } catch (err) {
    console.error('Gemini generate error:', err?.message || err);
    return res.status(502).json({ error: 'AI service error. See server logs.' });
  }

  // Lead detection on the user message (if user supplied contact info)
  const isLead = containsContactInfo(message);

  if (isLead && !aiText.includes('@@LEAD@@')) {
    aiText = (aiText ? aiText + ' ' : '') + '@@LEAD@@';
  }

  // Return the final response
  return res.status(200).json({
    reply: aiText,
    lead_detected: isLead,
    client_id: clientId,
  });
};
