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

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const q = (body.question || "").trim();

    if (!q) {
      return res.status(200).json({
        answer: "",
        sources: []
      });
    }

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

    const embeddingData = await embeddingRes.json();
    const query_embedding = embeddingData?.data?.[0]?.embedding;

    if (!query_embedding) {
      return res.status(500).json({
        error: "Embedding failed",
        detail: embeddingData
      });
    }

    let data = [];
    let error = null;

    try {
      const rpcRes = await supabase.rpc("match_documents", {
        query_embedding,
        match_threshold: 0.75,
        match_count: 10
      });

      data = rpcRes.data;
      error = rpcRes.error;
    } catch (e) {
      error = e;
    }

    if (error) {
      const fallback = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .limit(20);

      data = (fallback.data || []).filter(d => {
        const t =
          ((d.title || "") + " " + (d.content || "")).toLowerCase();
        return t.includes(q.toLowerCase().split(" ")[0]);
      });
    }

    const context = (data || [])
      .slice(0, 10)
      .map(d => `${d.title}\n${(d.content || "").slice(0, 900)}`)
      .join("\n\n");

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
                "Ti si kustos P.U.L.S.E biblioteke. Odgovaraš samo na osnovu dostavljenih tekstova."
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
        "Nema dovoljno podataka.",
      sources: data || [],
      ok: true
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
