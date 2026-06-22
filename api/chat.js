const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: [], ok: true });
    }

    // DIREKTAN VECTOR SEARCH (bez OpenAI API runtime)
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: null,   // koristi SQL-side embedding logiku ako je već implementirana
      match_threshold: 0,
      match_count: 50,
      query_text: q
    });

    if (error) {
      return res.status(200).json({ answer: [], error: error.message });
    }

    return res.status(200).json({
      answer: data || [],
      ok: true
    });

  } catch (err) {
    return res.status(200).json({
      answer: [],
      error: err.message
    });
  }
}
