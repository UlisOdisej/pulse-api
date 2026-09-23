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
    const limit = 5; // Prikazuje po 5 tekstova po stranici
    const offset = (page - 1) * limit;

    if (!q) return res.status(200).json({ answer: "", sources: [], hasMore: false });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // 1. Generisanje vektora za pitanje
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

    if (!queryEmbedding) {
      throw new Error("Greška pri generisanju vektora.");
    }

    // 2. Vektorska pretraga – povlačimo 15 tekstova da proverimo ima li još stranica
    const { data: matchedDocs, error } = await supabase.rpc("match_pulse_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: 50 // Maksimalan opseg za pretragu
    });

    if (error || !matchedDocs || matchedDocs.length === 0) {
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        hasMore: false,
        ok: true
      });
    }

    // Paginacija na nivou rezultata
    const paginatedDocs = matchedDocs.slice(offset, offset + limit);
    const hasMore = matchedDocs.length > offset + limit;

    // 3. Generisanje odgovora samo za prvu stranicu ili opšti kontekst
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
            content:
              "Ti si kustos P.U.L.S.E biblioteke. Kratko analiziraj i predstavi priložene tekstove iz zbirke u odnosu na postavljeno pitanje."
          },
          {
            role: "user",
            content: `Pitanje: ${q}\n\nTekstovi (Stranica ${page}):\n${context}`
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
