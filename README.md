# AI Video Transcriber — starter project

Mobile-friendly web app with:
- Video/audio upload and in-page playback
- Transcript with clickable start/end timestamps
- Speaker labels (AI-generated; rename them in the UI)
- SRT and VTT subtitle export
- Scene breakdown grouped from transcript gaps (heuristic, editable concept)
- TXT transcript export

## Requirements
- Node.js 20+
- An OpenAI API key with API billing enabled
- Internet access from the backend

## Run locally
1. Unzip this folder.
2. In the project directory, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your secret key in `.env` as `OPENAI_API_KEY=...`.
5. Run `npm start`.
6. Open `http://localhost:3000` in a browser.

Never put your API key in `public/app.js` or any browser code. Keep it only in the backend `.env` file.

## Important API and file limits
The included starter route demonstrates speaker-diarized transcription with segment timestamps. The OpenAI API's available models and supported response formats change; verify the current official docs before production deployment. This starter defaults to `gpt-4o-transcribe-diarize` because it returns speaker-labelled segments, but OpenAI documents it as a legacy/deprecated integration scheduled for shutdown on February 26, 2027. A production build should select the current supported model/workflow that meets both diarization and timestamp needs.
The documented audio upload limit is 25 MB for the file-transcription API. This demo's web upload limit is 100 MB only to allow upload to the server; that does NOT mean the API accepts a 100 MB media file. For bigger videos, extract audio with FFmpeg, compress it, and split into chunks under the API limit; offset timestamps when joining chunks.
For long videos, add job queue, progress polling, temporary object storage, chunk stitching, authentication, rate limiting, deletion policy, and cost controls.
Scene breakdown in this starter groups dialogue segments by time gaps. It does not detect visual cuts or understand scene changes from video frames.
