import { useMemo, useState } from 'react';

type VideoMeta = {
  thumbnail: string;
  title: string;
};

type ProcessStatus = 'idle' | 'fetching' | 'ready' | 'error' | 'processing';

const parseTime = (input: string) => {
  if (!input) return null;
  const parts = input.split(':').map((part) => Number(part.trim()));
  if (parts.some((value) => Number.isNaN(value))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
};

const formatSeconds = (value: number) => {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, '0'))
    .join(':');
};

const App = () => {
  const [videoUrl, setVideoUrl] = useState('');
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [startTime, setStartTime] = useState('0');
  const [endTime, setEndTime] = useState('10');
  const [clipUrl, setClipUrl] = useState('');
  const [status, setStatus] = useState<ProcessStatus>('idle');
  const [error, setError] = useState('');

  const disableProcess = useMemo(() => {
    return !videoUrl || status === 'fetching' || status === 'processing';
  }, [videoUrl, status]);

  const handleFetchMeta = async () => {
    setError('');
    setStatus('fetching');
    setMeta(null);
    setClipUrl('');

    try {
      const response = await fetch('/api/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to fetch metadata');
      setMeta(data);
      setStatus('ready');
      setStartTime('0');
      setEndTime('10');
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to fetch video information');
    }
  };

  const handleProcessClip = async () => {
    setError('');
    setStatus('processing');
    setClipUrl('');

    const start = parseTime(startTime);
    const end = parseTime(endTime);

    if (start === null || end === null || end <= start) {
      setStatus('error');
      setError('Please enter a valid start/end time where end is after start.');
      return;
    }

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl, start, end })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Clip processing failed');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setClipUrl(objectUrl);
      setStatus('ready');
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to generate clip');
    }
  };

  const downloadFileName = useMemo(() => {
    if (!meta) return 'clip.mp4';
    const sanitized = meta.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 40);
    return `${sanitized}-clip.mp4`;
  }, [meta]);

  return (
    <div className="page-shell">
      <div className="card">
        <header className="hero">
          <div>
            <p className="eyebrow">YouTube clipper</p>
            <h1>Trim any public YouTube video in seconds.</h1>
            <p className="subtitle">Paste a URL, set start/end, then download the MP4 clip.</p>
          </div>
        </header>

        <section className="field-group">
          <label htmlFor="videoUrl">YouTube video URL</label>
          <div className="input-row">
            <input
              id="videoUrl"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              autoComplete="off"
            />
            <button onClick={handleFetchMeta} disabled={!videoUrl || status === 'fetching'}>
              {status === 'fetching' ? 'Fetching…' : 'Load'}
            </button>
          </div>
        </section>

        {meta && (
          <section className="preview-card">
            <img src={meta.thumbnail} alt="Video thumbnail" />
            <div>
              <p className="video-title">{meta.title}</p>
            </div>
          </section>
        )}

        {status === 'error' && (
          <div className="status-banner error">
            <p>{error}</p>
          </div>
        )}

        {meta && (
          <section className="field-grid">
            <div className="field-card">
              <label htmlFor="startTime">Start time</label>
              <input
                id="startTime"
                type="text"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                placeholder="0 or 00:00:00"
              />
            </div>
            <div className="field-card">
              <label htmlFor="endTime">End time</label>
              <input
                id="endTime"
                type="text"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                placeholder="10 or 00:00:10"
              />
            </div>
          </section>
        )}

        {meta && (
          <div className="action-row">
            <button className="primary" disabled={disableProcess} onClick={handleProcessClip}>
              {status === 'processing' ? 'Processing…' : 'Generate Clip'}
            </button>
          </div>
        )}

        {status === 'processing' && (
          <div className="status-banner info">
            <p>Rendering clip. This may take a few seconds.</p>
          </div>
        )}

        {clipUrl && (
          <section className="preview-card video-card">
            <video controls src={clipUrl} preload="metadata" />
            <div className="download-row">
              <a href={clipUrl} download={downloadFileName} className="download-button">
                Download Clip
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default App;
