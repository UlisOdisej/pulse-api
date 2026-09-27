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

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const q = (body.question || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = 5;
    const offset = (page - 1) * limit;

    if (!q) return res.status(200).json({ answer: "", sources: [], hasMore: false, ok: true });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // 1. Prvo tražimo direktan tekstualni pogodak u naslovu ili sadržaju (Exact Keyword Match)
    const { data: exactDocs } = await supabase
      .from("pulse_documents")
      .select("id, title, content, permalink")
      .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
      .limit(30);

    let matchedDocs = exactDocs || [];

    // 2. Ako direktna pretraga vrati manje od 5 tekstova, dopunjujemo strožijom vektorskom pretragom
    if (matchedDocs.length < 5) {
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

      const embData = await embRes.json();
      const queryEmbedding = embData?.data?.[0]?.embedding;

      if (queryEmbedding) {
        // Podignut match_threshold na 0.45 da ne meša nebitne teme
        const { data: vectorDocs } = await supabase.rpc("match_pulse_documents", {
          query_embedding: queryEmbedding,
          match_threshold: 0.45,
          match_count: 30
        });

        if (vectorDocs && vectorDocs.length > 0) {
          const existingIds = new Set(matchedDocs.map(d => d.id));
          vectorDocs.forEach(doc => {
            if (!existingIds.has(doc.id)) {
              matchedDocs.push(doc);
            }
          });
        }
      }
    }

    if (matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke nema pronađenih tekstova za pojam "${q}".`,
        sources: [],
        hasMore: false,
        ok: true
      });
    }

    // Paginacija
    const paginatedDocs = matchedDocs.slice(offset, offset + limit);
    const hasMore = matchedDocs.length > offset + limit;

    const context = paginatedDocs
      .map(d => `Naslov: ${d.title}\nLink: ${d.permalink}\nSadržaj: ${(d.content || "").slice(0, 800)}`)
      .join("\n\n---\n\n");

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: "Ti si kustos P.U.L.S.E biblioteke. Odgovori na pitanje isključivo na osnovu navedenih tekstova. Nemoj mešati teme koje nisu u vezi sa upitom."
          },
          {
            role: "user",
            content: `Pitanje: ${q}\n\nTekstovi iz baze:\n${context}`
          }
        ]
      })
    });

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer: aiData?.choices?.[0]?.message?.content || "Nisam uspeo da generišem odgovor.",
      sources: paginatedDocs,
      page: page,
      hasMore: hasMore,
      ok: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
