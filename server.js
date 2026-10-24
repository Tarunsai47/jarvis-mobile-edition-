import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map(value => value.trim()).filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    // Permit server-to-server/local health checks without an Origin header.
    if (!origin || FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by J.A.R.V.I.S backend CORS policy."));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "12mb" }));
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "J.A.R.V.I.S request limit reached. Please wait a little and try again." }
}));

app.get("/", (_req, res) => {
  res.json({ service: "J.A.R.V.I.S AI backend", status: "online" });
});
app.get("/health", (_req, res) => {
  res.json({
    status: "online",
    geminiConfigured: Boolean(GEMINI_API_KEY),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    fallbackEnabled: Boolean(GEMINI_API_KEY && OPENAI_API_KEY) || Boolean(OPENAI_API_KEY)
  });
});

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-12).map(message => ({
    role: message?.role === "assistant" || message?.role === "model" ? "assistant" : "user",
    content: String(message?.content || message?.text || "").slice(0, 6000)
  })).filter(message => message.content.trim());
}

function geminiContents(messages) {
  return messages.map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
}

async function requestGemini(messages, image) {
  if (!GEMINI_API_KEY) throw new Error("Gemini is not configured on the backend.");
  const contents = geminiContents(messages);
  if (image) {
    contents.push({
      role: "user",
      parts: [
        { text: image.prompt || "Describe this image briefly." },
        { inline_data: { mime_type: image.mimeType, data: image.imageBase64 } }
      ]
    });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 500 }
      }),
      signal: AbortSignal.timeout(25000)
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Gemini request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  const reply = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "").filter(Boolean).join("\n").trim();
  if (!reply) throw new Error("Gemini returned no text.");
  return reply;
}

async function requestOpenAI(messages, image) {
  if (!OPENAI_API_KEY) throw new Error("OpenAI fallback is not configured. Add OPENAI_API_KEY to the backend environment.");
  const openAIMessages = [
    { role: "system", content: "You are J.A.R.V.I.S, a concise, helpful, confident AI assistant. Reply clearly and naturally." },
    ...messages.map(message => ({ role: message.role, content: message.content }))
  ];
  if (image) {
    openAIMessages.push({
      role: "user",
      content: [
        { type: "text", text: image.prompt || "Describe this image briefly." },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.imageBase64}` } }
      ]
    });
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: openAIMessages,
      max_tokens: 500,
      temperature: 0.5
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `OpenAI fallback failed (HTTP ${response.status}).`);
  }
  const reply = data.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("OpenAI returned no text.");
  return reply.trim();
}

async function answerWithFallback(messages, image) {
  let geminiError;
  if (GEMINI_API_KEY) {
    try {
      return { reply: await requestGemini(messages, image), provider: "gemini" };
    } catch (error) {
      geminiError = error;
      console.error("Gemini request failed; trying fallback:", error.status || "", error.message);
    }
  }

  if (OPENAI_API_KEY) {
    try {
      return { reply: await requestOpenAI(messages, image), provider: "openai" };
    } catch (openAIError) {
      console.error("OpenAI fallback failed:", openAIError.message);
      if (geminiError) {
        throw new Error("Gemini failed and the OpenAI fallback also failed. Check both providers' API keys, quotas, and billing settings.");
      }
      throw new Error("OpenAI request failed. Check the backend key, quota, and billing settings.");
    }
  }

  if (geminiError && /quota|rate|resource_exhausted|limit/i.test(geminiError.message)) {
    throw new Error("Gemini quota is exhausted and no OpenAI fallback key is configured on the backend.");
  }
  if (geminiError) throw new Error("Gemini request failed and no OpenAI fallback key is configured. Check the backend logs.");
  throw new Error("No AI provider is configured. Add GEMINI_API_KEY and/or OPENAI_API_KEY to the backend environment.");
}

app.post("/api/chat", async (req, res) => {
  try {
    const messages = cleanMessages(req.body?.messages);
    if (!messages.length) return res.status(400).json({ error: "Please send a message first." });
    const result = await answerWithFallback(messages, null);
    return res.json(result);
  } catch (error) {
    console.error("Chat request failed:", error.message);
    return res.status(502).json({ error: error.message || "AI request failed." });
  }
});

app.post("/api/vision", async (req, res) => {
  try {
    const imageBase64 = String(req.body?.imageBase64 || "");
    const mimeType = String(req.body?.mimeType || "image/jpeg");
    if (!imageBase64) return res.status(400).json({ error: "Please choose an image first." });
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) {
      return res.status(400).json({ error: "Supported image types are JPEG, PNG, WEBP, and GIF." });
    }
    if (imageBase64.length > 10_000_000) return res.status(413).json({ error: "Image is too large. Please choose a smaller image." });
    const history = cleanMessages(req.body?.history);
    const prompt = String(req.body?.prompt || "Describe this image briefly.").slice(0, 2000);
    const result = await answerWithFallback(history, { prompt, imageBase64, mimeType });
    return res.json(result);
  } catch (error) {
    console.error("Vision request failed:", error.message);
    return res.status(502).json({ error: error.message || "Image analysis failed." });
  }
});

app.listen(PORT, () => {
  console.log(`J.A.R.V.I.S backend listening on port ${PORT}`);
  console.log(`Gemini configured: ${Boolean(GEMINI_API_KEY)}; OpenAI fallback configured: ${Boolean(OPENAI_API_KEY)}`);
});
