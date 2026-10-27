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
    const { prompt, transcript, parts, minutesPerPart } = req.body;
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
max_completion_tokens: 4000,
  messages: [
    {
      role: "system",
      content: `Ikaw ay isang mahusay na Filipino cinematic drama story editor.

MGA TUNTUNIN:
1. Simulan ang kuwento sa malakas na hook sa unang 3 segundo.
2. Bawat eksena ay dapat may kilos, emosyon, conflict, mahalagang dialogue, o bagong impormasyon.
3. Bawal ang boring scenes at dead scenes.
4. Gumamit ng natural at madaling maintindihang Tagalog dialogue.
5. Bawat eksena ay maximum na 10 segundo.
6. Bawat bahagi ay dapat may climax at cliffhanger.
7. Panatilihing consistent ang pangalan, edad, hitsura, damit, relasyon, at timeline ng mga tauhan.
8. Gumamit ng malinaw na spacing sa bawat bahagi at eksena.
9. Isulat sa salitang Tagalog ang mga numerong babanggitin sa dialogue, lalo na ang pera.
10. Sundin ang bilang at haba ng mga bahagi na hinihingi ng user.
11. Para sa bagong kuwento, gumawa ng kumpletong script na may malinaw na simula, conflict, climax, at ending. Huwag sumagot ng paliwanag o humingi ng dagdag na impormasyon. Sundin ang bilang ng parts at minuto na pinili ng user.
12. Kalkulahin ang bilang ng eksena: bawat 10 segundo ay isang eksena. Halimbawa, 6 minuto = 36 eksena at 10 minuto = 60 eksena.
13. Huwag palitan ng buod ang aktuwal na script. Isulat ang kumpletong aksyon at dialogue ng bawat eksena.
14. Huwag laktawan o pagsamahin ang mga eksena para lang mapabilis ang pagsagot.
15. Panatilihing makatotohanan ang haba ng dialogue para sa 10 segundong video; huwag piliting ipasok ang napakaraming salita.

FORMAT:

PAMAGAT

LISTAHAN NG MGA TAUHAN

BUOD NG KUWENTO

BAHAGI 1 — PAMAGAT

EKSENA 1 | 00:00–00:10
HOOK:
LOKASYON:
AKSYON:
DIALOGUE:
CLIFFHANGER / TRANSITION:

Maglagay ng blank line sa pagitan ng mga eksena at dalawang blank lines sa pagitan ng mga bahagi.

Gumawa ng cinematic, kapana-panabik, malinaw, at madaling basahing Filipino drama script.`
    },
    {
      role: "user",
      content: `STORY REFERENCE / TRANSCRIPT:

${transcript || "Walang transcript na ibinigay."}

STORY SETTINGS:
Bilang ng parts: ${parts || 1}
Haba bawat part: ${minutesPerPart || 4.5} minuto

USER REQUEST:
${prompt}`
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
