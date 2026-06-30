const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');

process.env.YTDL_NO_UPDATE = '1';
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const port = process.env.PORT || 3001;

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[api] ${req.method} ${req.path}`, req.body && Object.keys(req.body).length ? req.body : 'no body');
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', port: Number(process.env.PORT) || port });
});

const extractYouTubeId = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }

    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }

    return null;
  } catch {
    return null;
  }
};

const normalizeYouTubeUrl = (url) => {
  const videoId = extractYouTubeId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
};

const isValidYouTubeUrl = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return [
      'youtube.com',
      'youtu.be',
      'm.youtube.com',
      'music.youtube.com',
      'www.youtube.com',
      'www.youtu.be',
      'youtube-nocookie.com'
    ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
};

app.post('/api/metadata', async (req, res) => {
  const { url } = req.body;
  console.log('[metadata] request received', { url });

  if (!url || typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    console.warn('[metadata] invalid URL', { url });
    return res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
  }

  try {
    const normalizedUrl = normalizeYouTubeUrl(url);
    console.log('[metadata] normalized URL', { normalizedUrl });

    const info = await ytdl.getBasicInfo(normalizedUrl, {
      requestOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });
    const title = info.videoDetails.title || 'YouTube clip';
    const thumbnail = info.videoDetails.thumbnails?.slice(-1)[0]?.url || info.videoDetails.thumbnails?.[0]?.url || '';
    return res.json({ title, thumbnail });
  } catch (error) {
    console.error('[metadata] error fetching info', error);
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
