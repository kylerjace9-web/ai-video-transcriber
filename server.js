import express from "express";
import multer from "multer";
import OpenAI from "openai";
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
      "audio/webm", "audio/ogg", "audio/mp4"
    ]);
    cb(allowed.has(file.mimetype) ? null : new Error("Unsupported file type."), allowed.has(file.mimetype));
  }
});
fs.mkdirSync(path.join(__dirname, "tmp"), { recursive: true });

app.use(express.static(path.join(__dirname, "public")));
app.get("/api/health", (_req, res) => res.json({ ok: true, apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY) }));

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: "Please upload an audio or video file." });
  if (!process.env.OPENAI_API_KEY) {
    fs.unlink(uploaded.path, () => {});
    return res.status(503).json({ error: "Backend is missing OPENAI_API_KEY. Add it to .env and restart the server." });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // The audio transcription endpoint accepts audio/video container formats such as MP4.
    // The diarization model provides segment start/end timestamps and speaker labels.
    // For larger videos, extract/compress audio with FFmpeg first and split into API-sized chunks.
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(uploaded.path, { encoding: null }),
      model: process.env.TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
      response_format: "diarized_json",
      chunking_strategy: "auto"
    });

    const segments = (result.segments || []).map((s, i) => ({
      id: s.id || `seg-${i + 1}`,
      start: Number(s.start || 0),
      end: Number(s.end || 0),
      speaker: s.speaker || "Speaker",
      text: s.text || ""
    }));
    res.json({
      text: result.text || segments.map(s => s.text).join(" "),
      duration: Number(result.duration || 0),
      segments,
      note: "Speaker labels are AI estimates. Review names and timestamps before publishing."
    });
  } catch (err) {
    console.error("Transcription error:", err?.message || err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Transcription failed. Check the API key, file size, and supported format." });
  } finally {
    fs.unlink(uploaded.path, () => {});
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large. Maximum upload size is ${MAX_MB} MB in this starter project.` });
  }
  res.status(400).json({ error: err?.message || "Upload error." });
});

app.listen(PORT, () => console.log(`AI Video Transcriber running at http://localhost:${PORT}`));
