import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
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

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: "", sources: [] });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });
    }

    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: q
      })
    });

    if (!embRes.ok) {
      const errText = await embRes.text();
      return res.status(500).json({ error: "Embedding failed", detail: errText });
    }

    const embData = await embRes.json();
    const queryEmbedding = embData?.data?.[0]?.embedding;

    if (!queryEmbedding) {
      return res.status(500).json({ error: "No embedding returned" });
    }

    const vectorString = `[${queryEmbedding.join(",")}]`;

    let matchedDocs = [];
    let dbError = null;
    let rpcErrorFull = null;
    try {
      const { data, error } = await supabase.rpc("match_documents", {
        query_embedding: vectorString,
        match_threshold: -1,
        match_count: 5
      });
      if (error) {
        dbError = error.message;
        rpcErrorFull = JSON.stringify(error);
      }
      if (data) matchedDocs = data;
    } catch (e) {
      dbError = e.message;
      rpcErrorFull = JSON.stringify(e, Object.getOwnPropertyNames(e));
    }

    return res.status(200).json({
      debug: {
        embeddingLength: queryEmbedding.length,
        embeddingSample: queryEmbedding.slice(0, 3),
        vectorStringSample: vectorString.slice(0, 60),
        matchedCount: matchedDocs.length,
        dbError,
        rpcErrorFull
      },
      answer: "DEBUG MODE",
      sources: matchedDocs,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
