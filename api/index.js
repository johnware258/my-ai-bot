const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Supabase & Gemini connect karna
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Vercel Serverless Function export
export default async function handler(req, res) {
    // CORS fix taaki widget har jagah chale
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Sirf POST request allow hai' });
    }

    const { message, client_id } = req.body;

    try {
        // Database se client context uthana
        const { data: client, error } = await supabase
            .from('clients')
            .select('*')
            .eq('client_id', client_id)
            .single();

        if (error || !client) {
            return res.status(404).json({ error: "Client ID nahi mila" });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Context: ${client.context}. User says: ${message}. Rule: If lead found, add @@LEAD@@ at end.`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return res.status(200).json({ reply: responseText });
    } catch (err) {
        return res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
}
