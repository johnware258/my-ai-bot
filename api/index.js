const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Backend setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (req, res) => {
    // CORS headers taaki har website se chat ho sake
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { message, client_id } = req.body;

    try {
        const { data: client } = await supabase.from('clients').select('*').eq('client_id', client_id).single();
        if (!client) return res.status(404).json({ error: "Client Not Found" });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Assistant context: ${client.context}. User says: ${message}. Rule: If lead found, add @@LEAD@@ at end.`;

        const result = await model.generateContent(prompt);
        res.status(200).json({ reply: result.response.text() });
    } catch (err) {
        res.status(500).json({ error: "Error" });
    }
};
