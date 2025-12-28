import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, numQuestions } = req.body;

    if (!prompt || !numQuestions) {
      return res.status(400).json({ error: "Missing prompt or numQuestions" });
    }

 const model = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview",
});


    const result = await model.generateContent(`
Create exactly ${numQuestions} MCQ questions on "${prompt}".

Return ONLY valid JSON in this format:

{
  "title": "Quiz title",
  "questions": [
    {
      "text": "Question?",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0
    }
  ]
}
    `);

    const text = result.response.text();
    const data = JSON.parse(text);

    return res.status(200).json(data);
  } catch (err: any) {
    console.error("Gemini error:", err);
    return res.status(500).json({
      error: err.message || "Gemini generation failed",
    });
  }
}
