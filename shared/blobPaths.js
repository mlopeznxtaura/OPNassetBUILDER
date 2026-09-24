/** Same-origin mesh URLs served by the Worker from R2. */
export function isBlobCharacterSrc(src) {
  if (typeof src !== 'string') return false;
  return /^\/api\/blobs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.(glb|gltf)$/i.test(src);
}

export function blobSrc(sessionId, filename) {
  const safe = String(filename || 'mesh.glb').replace(/[^\w.-]+/g, '_').slice(0, 80);
  return '/api/blobs/' + sessionId + '/' + safe;
}
