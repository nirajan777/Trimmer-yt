const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const port = process.env.PORT || 3001;

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', port: Number(process.env.PORT) || port });
});

const isValidYouTubeUrl = (url) => {
  try {
    const parsed = new URL(url);
    return /^(www\.)?(youtube\.com|youtu\.be)$/.test(parsed.hostname);
  } catch {
    return false;
  }
};

app.post('/api/metadata', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
  }

  try {
    const info = await ytdl.getBasicInfo(url);
    const title = info.videoDetails.title || 'YouTube clip';
    const thumbnail = info.videoDetails.thumbnails?.slice(-1)[0]?.url || info.videoDetails.thumbnails?.[0]?.url || '';
    return res.json({ title, thumbnail });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to fetch video metadata. Ensure the link is public and valid.' });
  }
});

app.post('/api/process', async (req, res) => {
  const { url, start, end } = req.body;

  if (!url || typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
  }

  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
    return res.status(400).json({ error: 'Please provide valid start and end times in seconds.' });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  const outputPath = path.join(tempDir, 'clip.mp4');

  try {
    const stream = ytdl(url, { quality: 'highestvideo' });
    const ffmpegStream = ffmpeg(stream)
      .format('mp4')
      .outputOptions(['-movflags frag_keyframe+empty_moov'])
      .setStartTime(start)
      .setDuration(end - start)
      .videoCodec('libx264')
      .audioCodec('aac')
      .output(outputPath)
      .on('error', (err) => {
        console.error('FFmpeg error', err.message);
      });

    await new Promise((resolve, reject) => {
      ffmpegStream.on('end', resolve).on('error', reject).run();
    });

    const stat = fs.statSync(outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="clip.mp4"');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('close', () => {
      try {
        fs.unlinkSync(outputPath);
        fs.rmdirSync(tempDir);
      } catch (cleanupError) {
        console.error('Cleanup error', cleanupError);
      }
    });
  } catch (error) {
    console.error('Processing error', error);
    res.status(500).json({ error: 'Clip processing failed. Please try again with a shorter range.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Unexpected server error. Please try again.' });
});

const activePort = process.env.PORT || port;

app.listen(activePort, () => {
  console.log(`Server listening on port ${activePort}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
