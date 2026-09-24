const SESSION_KEY = 'gf_session_id';

function sessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || '';
  } catch (e) {
    return '';
  }
}

export async function ensureForgeSession() {
  let id = sessionId();
  if (id) return id;
  const res = await fetch('/api/sessions', { method: 'POST', credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.sessionId) throw new Error(data.error || 'Could not start session');
  try {
    sessionStorage.setItem(SESSION_KEY, data.sessionId);
  } catch (e) { /* private mode */ }
  return data.sessionId;
}

export function clearForgeSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* ignore */ }
}

export function createLiveClient() {
  let revision = 0;

  async function req(path, options = {}) {
    await ensureForgeSession();
    const sid = sessionId();
    const headers = {
      'content-type': 'application/json',
      ...(options.headers || {})
    };
    if (sid) headers['x-gameforge-session'] = sid;
    const res = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'include',
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    if (typeof data.revision === 'number') revision = data.revision;
    return data;
  }

  async function requestUploadUrl(filename, contentType = 'model/gltf-binary') {
    await ensureForgeSession();
    const sid = sessionId();
    if (!sid) throw new Error('no session');
    const safe = String(filename || 'mesh.glb').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const res = await fetch('/api/blobs/' + sid + '/' + safe + '/upload-url', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-gameforge-session': sid
      },
      body: JSON.stringify({ contentType })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.uploadUrl) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function uploadBlob(filename, bytes, contentType = 'model/gltf-binary') {
    await ensureForgeSession();
    const sid = sessionId();
    if (!sid) throw new Error('no session');
    const safe = String(filename || 'mesh.glb').replace(/[^\w.-]+/g, '_').slice(0, 80);
    let issued;
    try {
      issued = await requestUploadUrl(safe, contentType);
    } catch {
      issued = null;
    }
    if (issued && issued.mode === 'direct') {
      const putRes = await fetch(issued.uploadUrl, {
        method: issued.method || 'PUT',
        headers: issued.headers || { 'content-type': contentType },
        body: bytes
      });
      if (!putRes.ok) throw new Error('direct upload failed HTTP ' + putRes.status);
      return {
        ok: true,
        backend: issued.backend,
        src: issued.src,
        bytes: bytes.byteLength
      };
    }
    const uploadUrl = issued && issued.uploadUrl ? issued.uploadUrl : '/api/blobs/' + sid + '/' + safe;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'content-type': contentType,
        'x-gameforge-session': sid
      },
      body: bytes
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.src) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  return {
    revision: () => revision,
    noteRevision(n) { if (typeof n === 'number') revision = n; },
    sessionId: () => sessionId(),
    ensureSession: ensureForgeSession,
    requestUploadUrl,
    uploadBlob,
    state: () => req('/api/state'),
    saveAsset: (asset) => req('/api/assets', { method: 'POST', body: asset }),
    deleteAsset: (id) => req('/api/assets/' + encodeURIComponent(id), { method: 'DELETE' }),
    putLibrary: (library) => req('/api/library', { method: 'PUT', body: library }),
    putLevel: (level) => req('/api/level', { method: 'PUT', body: level }),
    place: (placement) => req('/api/level/placements', { method: 'POST', body: placement }),
    removePlacement: (id) => req('/api/level/placements', { method: 'POST', body: { op: 'remove', id } }),
    clearPlacements: () => req('/api/level/placements', { method: 'POST', body: { op: 'clear' } })
  };
}
