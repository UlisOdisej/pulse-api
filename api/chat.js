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
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({ answer: "", sources: [] });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // 1. EMBEDDING (SAFE)
    const embeddingRes = await fetch(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: q
        })
      }
    );

    const embeddingText = await embeddingRes.text();

    let embeddingData;
    try {
      embeddingData = JSON.parse(embeddingText);
    } catch {
      return res.status(500).json({
        error: "Embedding parse error",
        raw: embeddingText
      });
    }

    const query_embedding = embeddingData?.data?.[0]?.embedding;

    if (!query_embedding) {
      return res.status(500).json({
        error: "No embedding returned",
        detail: embeddingData
      });
    }

    // 2. SUPABASE SAFE CALL
    const { data, error } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .limit(20);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    const filtered = (data || []).filter(d => {
      const text = ((d.title || "") + " " + (d.content || "")).toLowerCase();
      return text.includes(q.toLowerCase().split(" ")[0]);
    });

    // 3. CONTEXT
    const context = filtered
      .slice(0, 8)
      .map(d => `${d.title}\n${(d.content || "").slice(0, 800)}`)
      .join("\n\n");

    // 4. OPENAI CHAT
    const aiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Ti si kustos P.U.L.S.E biblioteke. Odgovaraš samo na osnovu teksta."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nTekstovi:\n${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer:
        aiData?.choices?.[0]?.message?.content ||
        "Nema odgovora.",
      sources: filtered,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
}
