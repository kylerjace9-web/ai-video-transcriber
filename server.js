import { analyzeStory } from "./analyzer.js";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);

const upload = multer({
  dest: path.join(__dirname, "tmp"),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "video/mp4", "video/quicktime", "video/webm",
      "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav",
      "audio/webm", "audio/ogg", "audio/mpga", "audio/flac",
      "audio/m4a", "audio/x-m4a"
    ]);
    cb(allowed.has(file.mimetype) ? null : new Error("Unsupported file type."), allowed.has(file.mimetype));
  }
});

fs.mkdirSync(path.join(__dirname, "tmp"), { recursive: true });
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.GROQ_API_KEY) });
});
app.post("/api/analyze", async (req, res) => {
  try {
    const { transcript } = req.body;
    const analysis = await analyzeStory({
      transcript,
      apiKey: process.env.GROQ_API_KEY
    });
    res.json({ analysis });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Hindi nagawa ang story analysis."
    });
  }
});
app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: "Please upload an audio or video file." });
  if (!process.env.GROQ_API_KEY) {
    fs.unlink(uploaded.path, () => {});
    return res.status(503).json({ error: "Backend is missing GROQ_API_KEY. Add it in Render Environment settings." });
  }

  try {
    const groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const result = await groq.audio.transcriptions.create({
      file: await toFile(fs.createReadStream(uploaded.path), uploaded.originalname),
      model: process.env.TRANSCRIPTION_MODEL || "whisper-large-v3",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]
    });

    const segments = (result.segments || []).map((s, i) => ({
      id: s.id ?? `seg-${i + 1}`,
      start: Number(s.start || 0),
      end: Number(s.end || 0),
      speaker: s.speaker || "Speaker",
      text: s.text || ""
    }));

    res.json({
      text: result.text || segments.map(s => s.text).join(" "),
      duration: Number(result.duration || 0),
      segments,
      note: "Groq Whisper provides timestamps but does not reliably identify different speakers. Speaker labels may be placeholders; review them before publishing."
    });
  } catch (err) {
    console.error("Transcription error:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({
      error: err?.message || "Transcription failed. Check the Groq API key, file size, and supported file format."
    });
  } finally {
    fs.unlink(uploaded.path, () => {});
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large. Maximum upload size is ${MAX_MB} MB.` });
  }
  res.status(400).json({ error: err?.message || "Upload error." });
});

app.listen(PORT, () => console.log(`AI Video Transcriber running on port ${PORT}`));
