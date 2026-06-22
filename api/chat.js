import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

    let body = {};
    try {
      body = typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});
    } catch (e) {
      body = {};
    }

    const q = (body.question || "").trim();

    // 1. generiši embedding (ako već imaš OpenAI helper, ubaci ga ovde)
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
    const query_embedding = embeddingData.data[0].embedding;

    // 2. pretraga Supabase-a
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding,
      match_threshold: 0,
      match_count: 50
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      answer: data,
      ok: true
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server crashed",
      detail: err.message
    });
  }
}
