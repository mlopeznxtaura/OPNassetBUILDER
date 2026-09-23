export function createLiveClient() {
  let revision = 0;

  async function req(path, options = {}) {
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: options.body == null ? undefined : JSON.stringify(options.body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    if (typeof data.revision === 'number') revision = data.revision;
    return data;
  }

  return {
    revision: () => revision,
    noteRevision(n) { if (typeof n === 'number') revision = n; },
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
