# Trimmer-yt

A production-ready full-stack YouTube clipper built for Render.

## Features

- Paste a YouTube URL
- Fetch title and thumbnail automatically
- Set clip start/end times using seconds or HH:MM:SS
- Generate and preview the clipped segment
- Download the finished clip as MP4

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` after running.

## Deployment

Render will install dependencies and run `npm start` from the project root.

## Notes

- Frontend: React with Vite
- Backend: Express, `ytdl-core`, `ffmpeg-static`, `fluent-ffmpeg`
- The client is built into `server/public`
