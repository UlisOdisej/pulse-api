import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    // Postavljanje CORS zaglavlja
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const query = (body.query || body.message || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Upit je prazan." });
    }

    // 1. Generisanje vektorskog otiska (embedding) za korisničko pitanje
    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query
      })
    });

    if (!embeddingResponse.ok) {
      throw new Error("Greška pri generisanju vektorskog otiska.");
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // 2. Pretraga Supabase baze (širi prag 0.30 i više odlomaka za kompleksna pitanja)
    const { data: documents, error: supabaseError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.30, // Spušten prag da hvata šire kontekste i složena pitanja
      match_count: 6         // Uzima 6 najrelevantnijih odlomaka za bogatiju analizu
    });

    if (supabaseError) {
      console.error("Supabase RPC error:", supabaseError);
    }

    const contextText = (documents || [])
      .map(doc => `Naslov: ${doc.title || 'Nevoljeno'}\nSadržaj: ${doc.content || ''}`)
      .join("\n\n---\n\n");

    // 3. Sistemske instrukcije za bogat, urednički odgovor
    const systemPrompt = `Ti si stručni bibliotekar i urednik digitalnog magazina P.U.L.S.E (pulse.rs). 
Tvoj zadatak je da pružiš dubok, analitičan i sadržajan odgovor na korisnikovo pitanje, oslanjajući se primarno na priloženi kontekst iz baze članaka.

Pravila za pisanje odgovora:
- Odgovor mora biti bogat, strukturiran i stilski uduglan, u duhu esejistike i humanistike magazina P.U.L.S.E.
- Ako je pitanje kompleksno, raščlani ga i poveži ključne teze, autore, citate i ideje iz priloženih odlomaka.
- Nemoj skraćivati odgovor na jednu ili dve rečenice — ponudi temeljnu analizu i uvid.
- Ako kontekst pruža samo delimične informacije, iskoristi ih na najbolji način i uobliči smislen odgovor.
- Ako u kontekstu nema apsolutno nikakvih dodirnih tačaka sa pitanjem, dostojanstveno navedi da biblioteka P.U.L.S.E trenutno ne sadrži građu o toj specifičnoj temi.`;

    // 4. Poziv OpenAI GPT-4o-mini modelu za generisanje odgovora
    const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Pitanje korisnika: "${query}"\n\nDostupna građa iz baze:\n${contextText || "Nema direktnih pogodaka."}` }
        ],
        temperature: 0.4,
        max_tokens: 800
      })
    });

    if (!chatResponse.ok) {
      throw new Error("Greška pri generisanju odgovora preko OpenAI API-ja.");
    }

    const chatData = await chatResponse.json();
    const answer = chatData.choices[0].message.content;

    return res.status(200).json({
      answer: answer,
      sources: documents || []
    });

  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
