const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');

process.env.YTDL_NO_UPDATE = '1';
const { spawn, exec } = require('child_process');
const ytdl = require('@distube/ytdl-core');
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
  console.log('✅ /api/health hit');
  res.json({ status: 'ok', port: Number(process.env.PORT) || port });
});

app.get('/test', (req, res) => {
  console.log('✅ /test route hit');
  res.send('Server working');
});

app.post('/clip', (req, res) => {
  console.log('🔥 /clip endpoint hit');
  console.log('BODY:', req.body);

  const { url, start, end } = req.body;

  if (!url || !start || !end) {
    console.log('❌ Missing data', { url, start, end });
    return res.status(400).send('Missing fields');
  }

  const id = Date.now();
  const video = path.join(os.tmpdir(), `video-${id}.mp4`);
  const clip = path.join(os.tmpdir(), `clip-${id}.mp4`);

  const downloadCmd = `yt-dlp -f "best[ext=mp4]" -o "${video}" "${url}"`;
  const clipCmd = `ffmpeg -ss ${start} -to ${end} -i "${video}" -c:v libx264 -c:a aac "${clip}"`;

  console.log('📥 Download CMD:', downloadCmd);

  exec(downloadCmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
    console.log('DOWNLOAD STDOUT:', stdout);
    console.log('DOWNLOAD STDERR:', stderr);

    if (err) {
      console.log('❌ Download error:', err);
      return res.status(500).send('Download failed');
    }

    console.log('✂️ Clip CMD:', clipCmd);

    exec(clipCmd, { maxBuffer: 1024 * 1024 * 20 }, (err2, stdout2, stderr2) => {
      console.log('CLIP STDOUT:', stdout2);
      console.log('CLIP STDERR:', stderr2);

      if (err2) {
        console.log('❌ Clip error:', err2);
        return res.status(500).send('Clip failed');
      }

      res.download(clip, (downloadErr) => {
        if (downloadErr) {
          console.log('❌ Download send error:', downloadErr);
        }

        try {
          fs.unlinkSync(video);
          fs.unlinkSync(clip);
          console.log('🧹 Cleaned up temporary files');
        } catch (cleanupError) {
          console.log('Cleanup error:', cleanupError);
        }
      });
    });
  });
});

const cleanYouTubeUrl = (url) => {
  if (typeof url !== 'string') return '';
  return url.trim().replace(/\s+/g, '');
};

const extractYouTubeId = (url) => {
  try {
    const cleaned = cleanYouTubeUrl(url);
    const parsed = new URL(cleaned);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }

    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'shorts' || pathParts[0] === 'embed') {
      return pathParts[1] || null;
    }

    return null;
  } catch {
    const fallback = url.match(/(?:v=|\/)([A-Za-z0-9_-]{11})/);
    return fallback ? fallback[1] : null;
  }
};

const normalizeYouTubeUrl = (url) => {
  const videoId = extractYouTubeId(url);
  if (!videoId) return cleanYouTubeUrl(url);

  const normalized = new URL('https://www.youtube.com/watch');
  normalized.searchParams.set('v', videoId);
  return normalized.toString();
};

const isValidYouTubeUrl = (url) => {
  try {
    const cleaned = cleanYouTubeUrl(url);
    const parsed = new URL(cleaned);
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
    return Boolean(extractYouTubeId(url));
  }
};

const YTDL_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const parseYouTubeTimestamp = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(':').map((segment) => Number(segment));
  if (parts.some((segment) => Number.isNaN(segment) || segment < 0)) {
    return null;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return null;
};

const CLIP_DURATION_LIMIT_SECONDS = 30;

const fetchYouTubeOEmbed = async (videoId, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': YTDL_HEADERS['User-Agent'],
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`oEmbed fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      authorName: data.author_name,
      authorUrl: data.author_url
    };
  } finally {
    clearTimeout(timeout);
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
    const videoId = extractYouTubeId(url);
    console.log('[metadata] normalized URL', normalizedUrl);

    const info = await ytdl.getBasicInfo(normalizedUrl, {
      requestOptions: {
        headers: YTDL_HEADERS
      }
    });
    const title = info.videoDetails.title || 'YouTube clip';
    const thumbnail = info.videoDetails.thumbnails?.slice(-1)[0]?.url || info.videoDetails.thumbnails?.[0]?.url || '';
    return res.json({ source: 'ytdl', title, thumbnail });
  } catch (error) {
    console.error('[metadata] ytdl error', error);

    const message = error?.message || String(error);
    const statusCode = error?.statusCode || error?.status || null;
    const normalizedUrl = normalizeYouTubeUrl(url);
    const videoId = extractYouTubeId(url);

    if (videoId) {
      try {
        console.log('[metadata] attempting oEmbed fallback', { videoId });
        const fallback = await fetchYouTubeOEmbed(videoId);
        return res.json({ source: 'oembed', title: fallback.title, thumbnail: fallback.thumbnail, authorName: fallback.authorName, authorUrl: fallback.authorUrl });
      } catch (fallbackError) {
        console.error('[metadata] oEmbed fallback failed', fallbackError);
      }
    }

    const response = {
      error: 'Unable to fetch video metadata. Ensure the link is public and valid.',
      details: message
    };
    if (statusCode) response.status = statusCode;
    if (message.includes('410')) {
      response.details = 'YouTube returned a 410 response; the video may be restricted, blocked, or the scraper is outdated.';
    } else if (message.includes('429')) {
      response.details = 'YouTube rate limited the request; try again later or use a different IP/proxy.';
    }

    return res.status(500).json(response);
  }
});

app.post('/api/process', async (req, res) => {
  console.log('🔥 /api/process endpoint hit');
  console.log('BODY:', req.body);

  const { url, start, end } = req.body;

  if (!url || typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    console.log('❌ Invalid URL in /api/process', url);
    return res.status(400).json({ error: 'Please provide a valid YouTube video URL.' });
  }

  const startSeconds = parseYouTubeTimestamp(start);
  const endSeconds = parseYouTubeTimestamp(end);

  if (startSeconds === null || endSeconds === null || startSeconds < 0 || endSeconds <= startSeconds) {
    return res.status(400).json({ error: 'Please provide valid start and end times.' });
  }

  const duration = endSeconds - startSeconds;
  if (duration > CLIP_DURATION_LIMIT_SECONDS) {
    return res.status(400).json({ error: `Clip duration must not exceed ${CLIP_DURATION_LIMIT_SECONDS} seconds.` });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  const outputPath = path.join(tempDir, `clip-${Date.now()}.mp4`);
  const normalizedUrl = normalizeYouTubeUrl(url);
  console.log('[process] normalized URL', normalizedUrl);

  try {
    const ytdlp = spawn('yt-dlp', ['-f', 'mp4', '-o', '-', normalizedUrl], {
      stdio: ['ignore', 'pipe', 'inherit']
    });

    const ffmpegProcess = spawn(
      'ffmpeg',
      [
        '-ss',
        `${startSeconds}`,
        '-to',
        `${endSeconds}`,
        '-i',
        'pipe:0',
        '-c',
        'copy',
        '-movflags',
        'frag_keyframe+empty_moov',
        outputPath
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );

    ytdlp.stdout.pipe(ffmpegProcess.stdin);

    await new Promise((resolve, reject) => {
      let ytdlpError = null;

      ytdlp.on('error', reject);
      ffmpegProcess.on('error', reject);

      ytdlp.on('close', (code) => {
        if (code !== 0) {
          ytdlpError = new Error(`yt-dlp exited with code ${code}`);
        }
      });

      ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg exited with code ${code}`));
        }
        if (ytdlpError) {
          return reject(ytdlpError);
        }
        resolve();
      });
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
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch (cleanupError) {
      console.error('Cleanup error', cleanupError);
    }
    res.status(500).json({ error: 'Clip processing failed. Please try a shorter segment or validate the URL.' });
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
