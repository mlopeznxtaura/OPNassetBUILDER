/**
 * TypeSafe Jev gate. Run this before a product iteration.
 *
 *   $env:TYPESAFE_API_KEY = "..."
 *   npm run jev:gate -- "Replace primitive kits with one deformable base mesh"
 *
 * Official API: POST https://api.typesafe.ai/v1/systemone
 * Exits 0 when Jev says proceed (noul >= 0.6) and focus is not pause.
 * Exits 1 when Jev says hold. Exits 2 when the key or request fails.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const PROCEED_MIN = 0.6;
const secretsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.secrets.local');

function loadLocalSecrets() {
  if (process.env.TYPESAFE_API_KEY || !fs.existsSync(secretsFile)) return;
  const text = fs.readFileSync(secretsFile, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name === 'TYPESAFE_API_KEY' && value) process.env.TYPESAFE_API_KEY = value;
  }
}

const questions = {
  proceed: {
    type: 'noul',
    instructions: 'Should we implement this proposal now, before any other product change?'
  },
  focus: {
    type: 'choice',
    instructions: 'What is the single next implementation focus if we proceed?',
    criteria: {
      deformable_base: 'One deformable base mesh with morphs, not more primitive parts',
      scan_partials: 'Live visual-hull partials in the Design viewport',
      draw_layer: 'Drawing animation layer, including 3D strokes',
      session_blobs: 'Session blob upload and storage only',
      layout: 'Design layout only, no mesh or scan logic',
      pause: 'Do not change product code'
    }
  },
  risk: {
    type: 'score',
    instructions: 'How risky is shipping this change to the live Design app?',
    criteria: ['safe and local', 'low', 'medium', 'likely to break scan or preview']
  }
};

function readState() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) return arg;
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
  });
}

async function main() {
  loadLocalSecrets();
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    console.error('TYPESAFE_API_KEY is not set. Create a key at https://console.typesafe.ai and set it in the shell. No product iteration until this gate can run.');
    process.exit(2);
  }
  const state = await readState();
  if (!state) {
    console.error('Pass the proposal as arguments or stdin.');
    process.exit(2);
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + key,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state,
      questions
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.answers) {
    console.error('Jev request failed', res.status, data.error || data);
    process.exit(2);
  }

  const proceed = data.answers.proceed;
  const focus = data.answers.focus;
  const risk = data.answers.risk;
  const noul = proceed && typeof proceed.noul === 'number' ? proceed.noul : 0;
  const choice = focus && focus.choice;
  const go = noul >= PROCEED_MIN && choice && choice !== 'pause';

  console.log(JSON.stringify({
    model: data.model,
    proceed: noul,
    focus: choice,
    focus_confidence: focus && focus.confidence,
    risk: risk && risk.score,
    go
  }, null, 2));

  process.exit(go ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(2);
});
