import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

export default async function handler(req, res) {
  try {
    const { data: docs, error } = await supabase
      .from("pulse_documents")
      .select("id, title, content")
      .is("embedding", null)
      .limit(50); // Obrađuje 50 po 50 tekstova

    if (error) return res.status(500).json({ error: error.message });

    if (!docs || docs.length === 0) {
      return res.status(200).json({ message: "Svi tekstovi već imaju vektore!" });
    }

    let processed = 0;

    for (const doc of docs) {
      const textToEmbed = `Naslov: ${doc.title}\nSadržaj: ${(doc.content || "").slice(0, 1500)}`;

      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: textToEmbed
        })
      });

      const resData = await response.json();
      const embedding = resData?.data?.[0]?.embedding;

      if (embedding) {
        await supabase
          .from("pulse_documents")
          .update({ embedding })
          .eq("id", doc.id);
        processed++;
      }
    }

    return res.status(200).json({
      status: "Uspešno",
      obradjenoTekstova: processed,
      preostalo: docs.length === 50 ? "Ima još tekstova, osveži stranicu ponovo." : "Završeno sve!"
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
