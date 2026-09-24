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
  if (!env.BLOBS) return json({ ok: false, error: 'R2 bucket not configured (run wrangler r2 bucket create opnassetbuilder-blobs)' }, 503);

  const match = url.pathname.match(/^\/api\/blobs\/(s_[a-zA-Z0-9_-]+)\/([^/]+)$/);
  if (!match) return json({ ok: false, error: 'path must be /api/blobs/{sessionId}/{filename}.glb' }, 400);

  const sessionId = match[1];
  const filename = decodeURIComponent(match[2]);
  if (!/\.(glb|gltf)$/i.test(filename) || filename.includes('..')) {
    return json({ ok: false, error: 'filename must end with .glb or .gltf' }, 400);
  }

  const key = sessionId + '/' + filename;

  if (request.method === 'GET') {
    const obj = await env.BLOBS.get(key);
    if (!obj) return new Response('not found', { status: 404, headers: corsHeaders() });
    const headers = {
      ...corsHeaders(),
      'content-type': obj.httpMetadata?.contentType || 'model/gltf-binary',
      'cache-control': 'public, max-age=3600'
    };
    return new Response(obj.body, { status: 200, headers });
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
    await env.BLOBS.put(key, body, { httpMetadata: { contentType } });
    return json({ ok: true, src: '/api/blobs/' + sessionId + '/' + filename, bytes: body.byteLength });
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}
