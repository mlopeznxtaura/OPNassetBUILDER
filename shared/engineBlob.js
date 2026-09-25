/**
 * Engine interchange files served from /assets/ or /api/blobs/{session}/file.ext
 */

export const BLOB_ENGINE_EXTENSIONS = [
  'glb',
  'gltf',
  'fbx',
  'zip',
  'json',
  'png',
  'jpg',
  'jpeg',
  'wav',
  'unitypackage'
];

export const ENGINE_TARGETS = ['web', 'unreal', 'unity', 'zip'];

const EXT_RE = new RegExp('\\.(' + BLOB_ENGINE_EXTENSIONS.join('|') + ')$', 'i');

export function isAllowedBlobFilename(filename) {
  if (typeof filename !== 'string' || filename.includes('..') || filename.includes('/')) return false;
  return EXT_RE.test(filename);
}

export function isAllowedKitSrc(src) {
  if (typeof src !== 'string') return false;
  if (src.includes('..') || src.includes('//')) return false;
  if (src.startsWith('/assets/')) return EXT_RE.test(src);
  if (/^\/api\/blobs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/i.test(src)) {
    const file = src.split('/').pop();
    return isAllowedBlobFilename(file);
  }
  return false;
}

export function isPreviewableMeshSrc(src) {
  return typeof src === 'string' && /\.(gltf|glb)$/i.test(src);
}

export function contentTypeForBlobFilename(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    fbx: 'application/octet-stream',
    zip: 'application/zip',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    wav: 'audio/wav',
    unitypackage: 'application/octet-stream'
  };
  return map[ext] || 'application/octet-stream';
}
