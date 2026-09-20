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

    const cleanWord = q.toLowerCase().replace(/[.,?!]/g, "").trim();
    const stem = cleanWord.length > 5 ? cleanWord.slice(0, 5) : cleanWord;

    // Pretraga po naslovu
    let { data: matchedDocs } = await supabase
      .from("pulse_documents")
      .select("id,title,content,permalink")
      .ilike("title", `%${stem}%`)
      .limit(10);

    // Ako nema direktnog pogotka po naslovu, uzimamo bilo kojih 10 članaka iz baze
    if (!matchedDocs || matchedDocs.length === 0) {
      const { data: fallback } = await supabase
        .from("pulse_documents")
        .select("id,title,content,permalink")
        .limit(10);
      matchedDocs = fallback || [];
    }

    const context = matchedDocs
      .map(d => `Naslov: ${d.title}\nSadržaj: ${(d.content || "").slice(0, 800)}`)
      .join("\n\n---\n\n");

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
                "Ti si digitalni kustos P.U.L.S.E biblioteke (portal za kulturu, umetnost, film i filozofiju). Tvoj zadatak je da pružiš sadržajan, analitički i dubok odgovor na postavljeno pitanje. Ako u priloženom kontekstu postoje direktni tekstovi o temi, upotrebi ih. Ako ne, upotrebi svoje obimno znanje iz oblasti estetike, filma i filozofije kako bi detaljno odgovorio na pitanje u prepoznatljivom tonu i stilu portala P.U.L.S.E. Strogo je zabranjeno da pišeš 'nemam pristup tekstovima' ili 'u zbirci nema pronađenih tekstova'."
            },
            {
              role: "user",
              content: `Pitanje: ${q}\n\nEvo nekih od članaka iz zbirke za uvid u kontekst:\n${context}`
            }
          ]
        })
      }
    );

    const aiData = await aiRes.json();

    return res.status(200).json({
      answer:
        aiData?.choices?.[0]?.message?.content ||
        "Nisam uspeo da generišem odgovor.",
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
