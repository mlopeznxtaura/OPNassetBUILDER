import assert from 'node:assert/strict';
import test from 'node:test';
import { assignOrbitAngles, buildScanManifest } from './scanCapture.js';
import { visualHull } from './visualHull.js';

function solidFrame(angle, width, height) {
  const mask = new Uint8Array(width * height).fill(255);
  const color = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    color[i * 4] = 180;
    color[i * 4 + 1] = 90;
    color[i * 4 + 2] = 40;
    color[i * 4 + 3] = 255;
  }
  return { angle, width, height, mask, color, yaw: angle, valid: true };
}

test('orbit angles follow shoulder yaw instead of frame index', () => {
  const frames = assignOrbitAngles([
    { yaw: 0.2 },
    { yaw: 1.0 },
    { yaw: -0.4 }
  ]);
  assert.equal(frames[0].angle, 0);
  assert.ok(frames[1].angle < 0);
  assert.ok(frames[2].angle > 0);
});

test('scan manifest keeps yaw, angle, and guide validity', () => {
  const manifest = buildScanManifest('hero', [
    { t: 1, capturedAt: 2, width: 8, height: 8, yaw: 0.5, angle: -0.5, valid: false }
  ]);
  assert.equal(manifest.frameCount, 1);
  assert.equal(manifest.frames[0].yaw, 0.5);
  assert.equal(manifest.frames[0].valid, false);
});

test('visual hull keeps volume seen as a person from several angles', () => {
  const frames = [0, 1, 2, 3].map(i => solidFrame((i * Math.PI) / 2, 48, 72));
  const hull = visualHull(frames, { size: [8, 12, 8] });
  assert.ok(hull.voxels.length > 10);
  assert.equal(hull.voxels[0].c[0], '#');
});

test('visual hull carves voxels outside an empty mask', () => {
  const empty = solidFrame(0, 32, 48);
  empty.mask.fill(0);
  const hull = visualHull([empty, { ...empty, angle: 1.2 }, { ...empty, angle: 2.4 }], { size: [6, 8, 6] });
  assert.equal(hull.voxels.length, 0);
});
