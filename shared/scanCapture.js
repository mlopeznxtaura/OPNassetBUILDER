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

export async function downloadScanZip(assetName, frames) {
  const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
  const zip = new JSZip();
  const safeName = String(assetName || 'scan').replace(/[^\w.-]+/g, '_').slice(0, 48);
  const manifest = {
    app: 'app14',
    assetName: assetName || 'scan',
    exportedAt: new Date().toISOString(),
    frameCount: frames.length,
    frames: frames.map((f, i) => ({
      index: i + 1,
      t: f.t,
      capturedAt: f.capturedAt,
      width: f.width,
      height: f.height,
      yaw: f.yaw == null ? null : f.yaw,
      valid: f.valid !== false
    }))
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
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
