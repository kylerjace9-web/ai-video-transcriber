import { analyzeStory } from "./analyzer.js";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
ffmpeg.setFfmpegPath(ffmpegPath.path);

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
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

fs.mkdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "tmp"), { recursive: true });
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

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
  if (!uploaded) {
    return res.status(400).json({ error: "Please upload an audio or video file." });
  }

  if (!process.env.GROQ_API_KEY) {
    fs.unlink(uploaded.path, () => {});
    return res.status(503).json({ error: "Backend is missing GROQ_API_KEY." });
  }

  const chunks = [];
  const tempFiles = [];

  try {
    const groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const outputDir = path.join(__dirname, "tmp");
    const chunkDuration = 300;
const chunkPrefix = `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new Promise((resolve, reject) => {
      let command = ffmpeg(uploaded.path)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate("48k")
        .audioChannels(1)
        .audioFrequency(16000)
        .format("segment")
        .outputOptions([
          "-f", "segment",
          "-segment_time", String(chunkDuration),
          "-reset_timestamps", "1"
        ])
        .on("error", reject)
        .on("end", resolve);

      
const pattern = path.join(outputDir, `${chunkPrefix}-%03d.mp3`);
      command.save(pattern);
    });

    const files = fs.readdirSync(outputDir)
  .filter(name => name.startsWith(`${chunkPrefix}-`) && name.endsWith(".mp3"))
      .map(name => path.join(outputDir, name))
      .sort();

    tempFiles.push(...files);

    if (!files.length) {
      throw new Error("Hindi nagawa ang audio chunks.");
    }

    let allSegments = [];
    let fullText = "";
    let offset = 0;

    for (const file of files) {
      const result = await groq.audio.transcriptions.create({
        file: await toFile(fs.createReadStream(file), path.basename(file)),
        model: process.env.TRANSCRIPTION_MODEL || "whisper-large-v3",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"]
      });

      const segments = (result.segments || []).map((s, i) => ({
        id: `seg-${allSegments.length + i + 1}`,
        start: Number(s.start || 0) + offset,
        end: Number(s.end || 0) + offset,
        speaker: s.speaker || "Speaker",
        text: s.text || ""
      }));

      allSegments.push(...segments);
      fullText += (result.text || segments.map(s => s.text).join(" ")) + " ";
      offset += Number(result.duration || chunkDuration);
    }

    res.json({
      text: fullText.trim(),
      duration: offset,
      segments: allSegments,
      note: "Long media is split into audio chunks before transcription."
    });
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(err.status && Number.isInteger(err.status) ? err.status : 500).json({
      error: err.message || "Transcription failed."
    });
  } finally {
    fs.unlink(uploaded.path, () => {});
    tempFiles.forEach(file => fs.unlink(file, () => {}));
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large. Maximum upload size is ${MAX_MB} MB.` });
  }
  res.status(400).json({ error: err?.message || "Upload error." });
});
app.post("/api/generate-story", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Maglagay muna ng story idea."
      });
    }

    const groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1"
    });

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "Ikaw ay mahusay na Filipino drama writer. Gumawa ng orihinal na kuwento sa Tagalog na may bagong characters, plot, dialogue, emotional beats, at twists. Hatiin ang kuwento sa scenes na maximum 10 seconds bawat isa. Isulat ang lahat ng spoken numbers at pera sa natural na salitang Tagalog. Panatilihin ang continuity ng characters, wardrobe, props, locations, at voices. Bawat scene ay dapat may image prompt, eksaktong dialogue, video prompt, audio/SFX lock, voice identity lock, at continuity lock. Huwag kopyahin ang dialogue ng source material."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    res.json({
      story: response.choices[0]?.message?.content || "Walang story na nabuo."
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Hindi nakagawa ng story."
    });
  }
});
app.listen(PORT, () => console.log(`AI Video Transcriber running on port ${PORT}`));
