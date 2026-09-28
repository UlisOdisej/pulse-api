import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const query = (body.query || body.question || body.message || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Upit je prazan." });
    }

    // 1. Generisanje vektorskog otiska (embedding)
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
      throw new Error("Greška pri generisanju embeddinga.");
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // 2. Pretraga Supabase baze (podešeno na tačno 5 najrelevantnijih tekstova)
    const { data: documents, error: supabaseError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: 5
    });

    if (supabaseError) {
      console.error("Supabase RPC error:", supabaseError);
    }

    const docsList = documents || [];
    
    // Priprema konteksta za model
    const contextText = docsList
      .map(doc => `Naslov: ${doc.title || 'Bez naslova'}\nSadržaj: ${(doc.content || '').slice(0, 1000)}`)
      .join("\n\n---\n\n");

    // 3. Urednički prompt magazina P.U.L.S.E
    const systemPrompt = `Ti si digitalni bibliotekar i urednik magazina P.U.L.S.E.
Tvoj zadatak je da pružiš sadržajan, analitičan i sintetičan odgovor na korisnikovo pitanje isključivo na osnovu priloženih odlomaka iz baze.

Pravila:
- Odgovaraj u duhu esejistike i humanistike magazina P.U.L.S.E.
- Poveži ideje, teze i autore iz ponuđenih tekstova u jasnu i smislenu celinu.
- Nemoj analizirati autore ili teme kojih nema u priloženoj građi.
- Ako građa u kontekstu ne sadrži dovoljne podatke, navedi da biblioteka trenutno nema detaljnije tekstove o tom upitu.`;

    // 4. Generisanje odgovora preko GPT-4o-mini
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
          { role: "user", content: `Pitanje: "${query}"\n\nDostupna građa:\n${contextText || "Nema direktnih pogodaka."}` }
        ],
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!chatResponse.ok) {
      throw new Error("Greška pri pozivu OpenAI API-ja.");
    }

    const chatData = await chatResponse.json();
    const answer = chatData.choices[0].message.content;

    return res.status(200).json({
      answer: answer,
      sources: docsList.map(d => ({ title: d.title, permalink: d.permalink }))
    });

  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
