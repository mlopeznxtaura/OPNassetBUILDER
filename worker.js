import { ForgeRoom } from './forgeRoom.js';

export { ForgeRoom };

function isControlPath(pathname) {
  return pathname === '/mcp'
    || pathname === '/agent.json'
    || pathname === '/agent.txt'
    || pathname === '/.well-known/agent.json'
    || pathname.startsWith('/api/');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isControlPath(url.pathname)) {
      const id = env.FORGE.idFromName('gameforge');
      return env.FORGE.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
