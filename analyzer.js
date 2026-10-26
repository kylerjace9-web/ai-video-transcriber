import OpenAI from "openai";

export async function analyzeStory({ transcript, apiKey }) {
  if (!transcript || !transcript.trim()) {
    throw new Error("Walang transcript na susuriin.");
  }

  if (!apiKey) {
    throw new Error("Hindi makita ang GROQ_API_KEY sa Render.");
  }

  const groq = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });

  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: `Ikaw ay story analyst para sa Filipino drama.
Suriin ang ibinigay na transcript at gumawa ng malinaw na report sa Tagalog.
Ihiwalay ang mga kumpirmadong detalye sa mga posibleng interpretasyon.
Huwag mag-imbento ng pangyayari na wala sa transcript.`
      },
      {
        role: "user",
        content: `Suriin ang transcript na ito gamit ang mga seksyon:

1. BUOD NG KUWENTO
2. PANGUNAHING TEMA AT MENSAHE
3. MGA CHARACTER AT RELASYON
4. PANGUNAHING CONFLICT
5. EMOTIONAL BEATS
6. MAHAHALAGANG PANGYAYARI AT TWISTS
7. SCENE-BY-SCENE BREAKDOWN
8. MGA TANONG NA HINDI PA NASASAGOT
9. MGA IDEYA PARA SA BAGONG ORIGINAL NA KUWENTO

Para sa huling seksyon, gumamit ng bagong plot, bagong characters, at bagong dialogue. Huwag kopyahin ang orihinal na dialogue.

TRANSCRIPT:
${transcript.slice(0, 45000)}`
      }
    ]
  });

  return response.choices[0]?.message?.content || "Walang analysis na nabuo.";
}
