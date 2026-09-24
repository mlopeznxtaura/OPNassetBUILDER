import { storeBlob, loadBlob, issueUploadUrl } from './workerBlobTiers.js';
import { blobTierConfigured, blobTierImplementation, parseTierOrder } from './shared/storageTiers.js';

const GLB_MAX = 25 * 1024 * 1024;

export function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,x-gameforge-session',
    'access-control-max-age': '86400'
  };
}

export function parseSessionId(request) {
  const header = request.headers.get('x-gameforge-session');
  if (header && /^s_[a-zA-Z0-9_-]{8,64}$/.test(header)) return header;
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)gf_session=([^;]+)/);
  if (match && /^s_[a-zA-Z0-9_-]{8,64}$/.test(match[1])) return match[1];
  return null;
}

export function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 's_' + hex;
}

export async function handleStorageStatus(env) {
  const configured = blobTierConfigured(env);
  const order = parseTierOrder(env);
  const firstUploadTier = order.find(t => {
    if (t === 'assets' || t === 'mongo') return false;
    return configured[t] === true;
  }) || null;
  return json({
    ok: true,
    tier_order: order,
    configured,
    implementation: blobTierImplementation(),
    first_upload_tier: firstUploadTier,
    note:
      'OAuth on Supabase/Vercel/AWS does not wire the Worker. Run wrangler secret put (npm run setup:storage -SecretsOnly). Upload response field backend shows which tier stored the file.'
  });
}

export async function handleSessions(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'POST') return json({ ok: false, error: 'POST to create a session' }, 405);
  const sessionId = newSessionId();
  return json(
    { ok: true, sessionId, expiresInDays: 7 },
    200,
    { 'set-cookie': `gf_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` }
  );
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(), ...extraHeaders }
  });
}

export async function handleBlobs(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const uploadUrlMatch = url.pathname.match(/^\/api\/blobs\/(s_[a-zA-Z0-9_-]+)\/([^/]+)\/upload-url$/);
  if (uploadUrlMatch && request.method === 'POST') {
    const sessionId = uploadUrlMatch[1];
    const caller = parseSessionId(request);
    if (!caller || caller !== sessionId) {
      return json({ ok: false, error: 'session required; use POST /api/sessions then X-GameForge-Session header' }, 401);
    }
    const filename = decodeURIComponent(uploadUrlMatch[2]);
    if (!/\.(glb|gltf)$/i.test(filename) || filename.includes('..')) {
      return json({ ok: false, error: 'filename must end with .glb or .gltf' }, 400);
    }
    let contentType = 'model/gltf-binary';
    try {
      const body = await request.json();
      if (body && body.contentType) contentType = String(body.contentType);
    } catch {
      /* empty body ok */
    }
    const key = sessionId + '/' + filename;
    const issued = await issueUploadUrl(env, key, sessionId, filename, contentType, request.url);
    return json(issued);
  }

  const match = url.pathname.match(/^\/api\/blobs\/(s_[a-zA-Z0-9_-]+)\/([^/]+)$/);
  if (!match) return json({ ok: false, error: 'path must be /api/blobs/{sessionId}/{filename}.glb' }, 400);

  const sessionId = match[1];
  const filename = decodeURIComponent(match[2]);
  if (!/\.(glb|gltf)$/i.test(filename) || filename.includes('..')) {
    return json({ ok: false, error: 'filename must end with .glb or .gltf' }, 400);
  }

  const key = sessionId + '/' + filename;

  if (request.method === 'GET') {
    const obj = await loadBlob(env, key);
    if (!obj) return new Response('not found', { status: 404, headers: corsHeaders() });
    return new Response(obj.body, {
      status: 200,
      headers: {
        ...corsHeaders(),
        'content-type': obj.contentType,
        'cache-control': 'public, max-age=3600'
      }
    });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const caller = parseSessionId(request);
    if (!caller || caller !== sessionId) {
      return json({ ok: false, error: 'session required; use POST /api/sessions then X-GameForge-Session header' }, 401);
    }
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ ok: false, error: 'empty body' }, 400);
    if (body.byteLength > GLB_MAX) return json({ ok: false, error: 'file exceeds 25MB limit' }, 413);
    const contentType = request.headers.get('content-type') || 'model/gltf-binary';
    const backend = await storeBlob(env, key, body, contentType);
    if (!backend) {
      return json({
        ok: false,
        error: 'no blob backend available — set Supabase/Vercel/OCI/AWS secrets or enable R2 (see docs/STORAGE_TIERS.md)'
      }, 503);
    }
    return json({
      ok: true,
      backend,
      src: '/api/blobs/' + sessionId + '/' + filename,
      bytes: body.byteLength
    });
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}
