import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

const PAGE_SIZE = 5;          // tekstova po stranici ("nastavi sa novih pet")
const KEYWORD_LIMIT = 100;    // najviše pogodaka po pretrazi naslova / sadržaja
const VECTOR_THRESHOLD = 0.35;
const VECTOR_COUNT = 20;
const CONTENT_CHARS = 1000;

const keyOf = (d) => String(d.id ?? d.permalink ?? d.title);

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const q = (body.question || body.query || body.message || "").trim();
    const page = Math.max(1, parseInt(body.page || 1, 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    if (!q) return res.status(200).json({ answer: "", sources: [], page, hasMore: false, ok: true });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // Pretraga po reči: samo za kratke upite (do 4 reči)
    const pattern = q.replace(/[%_\\]/g, " ").trim();
    const words = pattern.split(/\s+/).filter(Boolean);
    const useKeyword = pattern.length > 0 && pattern.length <= 60 && words.length <= 4;

    const matched = [];
    const seen = new Set();
    const add = (d) => {
      const k = keyOf(d);
      if (!seen.has(k)) {
        seen.add(k);
        matched.push(d);
      }
    };
    let searchFailed = false;

    // 1. Pretraga po naslovu (prvi prioritet)
    if (useKeyword) {
      const t = await supabase
        .from("pulse_documents")
        .select("id, title, permalink")
        .ilike("title", `%${pattern}%`)
        .order("id")
        .limit(KEYWORD_LIMIT);
      if (t.error) {
        console.error("Title search error:", JSON.stringify(t.error));
        searchFailed = true;
      } else {
        (t.data || []).forEach(add);
      }

      // 2. Pretraga po sadržaju
      const c = await supabase
        .from("pulse_documents")
        .select("id, title, permalink")
        .ilike("content", `%${pattern}%`)
        .order("id")
        .limit(KEYWORD_LIMIT);
      if (c.error) {
        console.error("Content search error:", JSON.stringify(c.error));
        searchFailed = true;
      } else {
        (c.data || []).forEach(add);
      }
    }

    // 3. Vektorska pretraga kao rezerva, samo ako ima malo pogodaka
    if (matched.length < PAGE_SIZE) {
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
        const { data: vectorDocs, error: vectorError } = await supabase.rpc("match_documents", {
          query_embedding: queryEmbedding,
          match_threshold: VECTOR_THRESHOLD,
          match_count: VECTOR_COUNT
        });
        if (vectorError) {
          console.error("Vector search error:", JSON.stringify(vectorError));
          searchFailed = true;
        } else {
          (vectorDocs || []).forEach(add);
        }
      } else {
        searchFailed = true;
      }
    }

    console.log(JSON.stringify({ q, page, found: matched.length, searchFailed }));

    if (matched.length === 0) {
      if (searchFailed) {
        return res.status(502).json({
          error: "Pretraga biblioteke trenutno nije dostupna. Pokušajte ponovo za nekoliko trenutaka."
        });
      }
      return res.status(200).json({
        answer: `U zbirci P.U.L.S.E biblioteke trenutno nema pronađenih tekstova o pojmu "${q}".`,
        sources: [],
        page,
        hasMore: false,
        ok: true
      });
    }

    // Paginacija: po 5 tekstova
    const pageDocs = matched.slice(offset, offset + PAGE_SIZE);
    const hasMore = matched.length > offset + PAGE_SIZE;

    if (pageDocs.length === 0) {
      return res.status(200).json({ answer: "", sources: [], page, hasMore: false, ok: true });
    }

    // Sadržaj učitavamo samo za tekstove sa ove stranice
    const missingIds = pageDocs
      .filter((d) => d.content === undefined && d.id !== undefined)
      .map((d) => d.id);

    if (missingIds.length > 0) {
      const { data: contents, error: contentError } = await supabase
        .from("pulse_documents")
        .select("id, content")
        .in("id", missingIds);
      if (contentError) {
        console.error("Content load error:", JSON.stringify(contentError));
      } else {
        const byId = new Map((contents || []).map((r) => [String(r.id), r.content]));
        pageDocs.forEach((d) => {
          if (d.content === undefined) d.content = byId.get(String(d.id)) || "";
        });
      }
    }

    const contextText = pageDocs
      .map((d) => `Naslov: ${d.title || "Bez naslova"}\nSadržaj: ${(d.content || "").slice(0, CONTENT_CHARS)}`)
      .join("\n\n---\n\n");

    // Urednički prompt magazina P.U.L.S.E
    const systemPrompt = `Ti si digitalni bibliotekar i urednik magazina P.U.L.S.E.
Tvoj zadatak je da pružiš sadržajan, analitičan i sintetičan odgovor na korisnikovo pitanje isključivo na osnovu priloženih odlomaka iz baze.

Pravila:
- Odgovaraj u duhu esejistike i humanistike magazina P.U.L.S.E.
- Poveži ideje, teze i autore iz ponuđenih tekstova u jasnu i smislenu celinu.
- Nemoj analizirati autore ili teme kojih nema u priloženoj građi.
- Ako građa u kontekstu ne sadrži dovoljne podatke, navedi da biblioteka trenutno nema detaljnije tekstove o tom upitu.`;

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
          { role: "user", content: `Pitanje: "${q}"\n\nDostupna građa:\n${contextText}` }
        ],
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!chatResponse.ok) {
      throw new Error("Greška pri pozivu OpenAI API-ja.");
    }

    const chatData = await chatResponse.json();
    const answer = chatData?.choices?.[0]?.message?.content || "Nisam uspeo da generišem odgovor.";

    return res.status(200).json({
      answer,
      sources: pageDocs.map((d) => ({ id: d.id, title: d.title, permalink: d.permalink })),
      page,
      hasMore,
      ok: true
    });

  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
