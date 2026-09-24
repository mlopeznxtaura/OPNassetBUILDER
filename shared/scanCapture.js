/**
 * Browser-only scan frame capture and ZIP export for photogrammetry handoff.
 */

export function captureJpegFromVideo(video, maxWidth = 960, quality = 0.82) {
  if (!video || !video.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return {
    image: canvas.toDataURL('image/jpeg', quality),
    width: canvas.width,
    height: canvas.height,
    capturedAt: Date.now()
  };
}

export function pickBestScanFrame(frames) {
  const valid = frames.filter(f => f.valid !== false && f.image);
  return valid[0] || frames[0] || null;
}

export function recorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export function startScanRecorder(stream) {
  if (!stream || typeof MediaRecorder === 'undefined') return null;
  const mimeType = recorderMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  rec.start(200);
  return {
    stop() {
      return new Promise((resolve) => {
        const finish = () => resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' }));
        if (rec.state === 'inactive') {
          finish();
          return;
        }
        rec.onstop = finish;
        rec.stop();
      });
    }
  };
}

/** Fixed camera, subject turns: shoulder yaw maps to an orbit angle around the body. */
export function assignOrbitAngles(frames) {
  const yaws = frames.map(f => (typeof f.yaw === 'number' ? f.yaw : null)).filter(v => v != null);
  const base = yaws.length ? yaws[0] : 0;
  const step = frames.length > 1 ? (Math.PI * 2) / frames.length : 0;
  return frames.map((frame, index) => {
    let angle = index * step;
    if (typeof frame.yaw === 'number') {
      let delta = frame.yaw - base;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      angle = delta === 0 ? 0 : -delta;
    }
    return { ...frame, angle };
  });
}

export function buildScanManifest(assetName, frames) {
  return {
    app: 'app14',
    assetName: assetName || 'scan',
    exportedAt: new Date().toISOString(),
    frameCount: frames.length,
    frames: frames.map((frame, index) => ({
      index: index + 1,
      t: frame.t,
      capturedAt: frame.capturedAt,
      width: frame.width,
      height: frame.height,
      yaw: frame.yaw == null ? null : frame.yaw,
      angle: frame.angle == null ? null : frame.angle,
      valid: frame.valid !== false
    }))
  };
}

const STAMP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function rasterBodyMask(width, height, landmarks) {
  const mask = new Uint8Array(width * height);
  if (!landmarks) return mask;
  const stamp = (nx, ny, radius) => {
    const cx = Math.round(nx * width);
    const cy = Math.round(ny * height);
    const r = Math.max(2, Math.round(radius));
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= width) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) mask[y * width + x] = 255;
      }
    }
  };
  for (const id of STAMP) {
    const point = landmarks[id];
    if (!point) continue;
    stamp(point.x, point.y, width * (id === 0 ? 0.07 : 0.045));
  }
  return mask;
}

export function componentFromVideo(video, segmentationMask, landmarks, maxWidth = 160) {
  if (!video || !video.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(8, Math.round(video.videoWidth * scale));
  const height = Math.max(8, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  const color = ctx.getImageData(0, 0, width, height).data;
  let mask;
  if (segmentationMask) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(segmentationMask, 0, 0, width, height);
    const seg = ctx.getImageData(0, 0, width, height).data;
    mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) mask[i] = seg[i * 4];
  } else {
    mask = rasterBodyMask(width, height, landmarks);
  }
  return { width, height, color, mask };
}

export async function downloadScanZip(assetName, frames, videoBlob) {
  const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
  const zip = new JSZip();
  const safeName = String(assetName || 'scan').replace(/[^\w.-]+/g, '_').slice(0, 48);
  const manifest = buildScanManifest(assetName, frames);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  if (videoBlob && videoBlob.size) {
    const ext = (videoBlob.type || '').includes('mp4') ? 'mp4' : 'webm';
    zip.file('scan.' + ext, videoBlob);
  }
  frames.forEach((f, i) => {
    if (!f.image) return;
    const b64 = f.image.includes(',') ? f.image.split(',')[1] : f.image;
    zip.file('frame_' + String(i + 1).padStart(3, '0') + '.jpg', b64, { base64: true });
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName + '-scan360.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
