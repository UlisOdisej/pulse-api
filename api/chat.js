export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body || {});

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: [], ok: true });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // 1. EMBEDDING
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: q
      })
    });

    const embeddingData = await embeddingRes.json();
    const query_embedding = embeddingData?.data?.[0]?.embedding;

    if (!query_embedding) {
      return res.status(200).json({
        answer: [],
        error: "Embedding failed"
      });
    }

    // 2. SUPABASE SEARCH (CLEAN + FILTERED)
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/match_documents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          query_embedding,
          match_threshold: 0.75,
          match_count: 50
        })
      }
    );

    const data = await response.json();

    // 3. HARD GUARD (UI stabilnost)
    const safeData = Array.isArray(data) ? data : [];

    return res.status(200).json({
      answer: safeData,
      ok: true
    });

  } catch (err) {
    return res.status(200).json({
      answer: [],
      error: err.message
    });
  }
}
