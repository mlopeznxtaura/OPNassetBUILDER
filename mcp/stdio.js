const origin =
  process.env.OPNASSETBUILDER_ORIGIN ||
  process.env.GAMEFORGE_ORIGIN ||
  'https://app14.nextaura.us';
const session = process.env.OPNASSETBUILDER_SESSION || process.env.GAMEFORGE_SESSION || '';

function send(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  process.stdout.write('Content-Length: ' + payload.length + '\r\n\r\n');
  process.stdout.write(payload);
}

async function forward(text) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (session) headers['x-gameforge-session'] = session;
  const res = await fetch(origin + '/mcp', {
    method: 'POST',
    headers,
    body: text
  });
  if (res.status === 202) return;
  const data = await res.json();
  send(data);
}

let buf = Buffer.alloc(0);

function takeMessages() {
  const out = [];
  while (buf.length) {
    if (buf[0] === 0x7b) {
      const nl = buf.indexOf(0x0a);
      if (nl === -1) break;
      const line = buf.slice(0, nl).toString('utf8').trim();
      buf = buf.slice(nl + 1);
      if (line) out.push(line);
      continue;
    }
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buf.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    out.push(buf.slice(start, start + len).toString('utf8'));
    buf = buf.slice(start + len);
  }
  return out;
}

process.stdin.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  for (const message of takeMessages()) {
    forward(message).catch(err => {
      send({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(err.message || err) } });
    });
  }
});
