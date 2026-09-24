import { ForgeRoom } from './forgeRoom.js';
import { handleBlobs, handleSessions, handleStorageStatus, parseSessionId } from './workerBlobs.js';

export { ForgeRoom };

function isControlPath(pathname) {
  return pathname === '/mcp'
    || pathname === '/agent.json'
    || pathname === '/agent.txt'
    || pathname === '/.well-known/agent.json'
    || pathname.startsWith('/api/');
}

function forgeId(env, request) {
  const sessionId = parseSessionId(request) || 'legacy-shared';
  return env.FORGE.idFromName(sessionId);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sessions') return handleSessions(request);
    if (url.pathname === '/api/storage' && request.method === 'GET') return handleStorageStatus(env);
    if (url.pathname.startsWith('/api/blobs/')) return handleBlobs(request, env, url);
    if (isControlPath(url.pathname)) {
      return env.FORGE.get(forgeId(env, request)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
