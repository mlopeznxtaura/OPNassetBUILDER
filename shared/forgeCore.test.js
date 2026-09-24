import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collidesAt,
  computeVoxelMeshStats,
  createCharacterAsset,
  createVoxelAsset,
  gfValidateAsset,
  isAllowedCharacterSrc,
  memoryStore,
  paintVoxelCells,
  seedVoxelStarter
} from './forgeCore.js';
import { bodyFit, bodyYawFromLandmarks } from './bodyGuide.js';
import { callTool, handleMcpMessage } from './mcpTools.js';

test('body guide is ready only when the whole body is inside the frame', () => {
  const point = (x, y) => ({ x, y, visibility: 0.9 });
  const framed = Array.from({ length: 33 }, () => point(0.5, 0.5));
  framed[0] = point(0.5, 0.08);
  framed[27] = point(0.4, 0.92);
  framed[28] = point(0.6, 0.92);
  assert.equal(bodyFit(framed).ready, true);
  framed[28] = point(0.98, 0.92);
  assert.equal(bodyFit(framed).ready, false);
});

test('body yaw can be estimated from shoulders', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[11] = { x: 0.4, y: 0.3, z: 0.1 };
  landmarks[12] = { x: 0.6, y: 0.3, z: -0.1 };
  assert.ok(typeof bodyYawFromLandmarks(landmarks) === 'number');
});

test('character asset is a skinned mesh with bone and triangle counts', () => {
  const asset = createCharacterAsset({ name: 'female hero' });
  assert.deepEqual(gfValidateAsset(asset), []);
  assert.equal(asset.character.src, '/assets/female-hero.gltf');
  assert.ok(asset.character.stats.triangles > 1000);
  assert.ok(asset.character.stats.bones >= 15);
  assert.ok(asset.character.stats.materials >= 4);
});

test('character.src must be same-origin under /assets/', () => {
  assert.equal(isAllowedCharacterSrc('/assets/hero.glb'), true);
  assert.equal(isAllowedCharacterSrc('https://evil.com/x.glb'), false);
  assert.equal(isAllowedCharacterSrc('/assets/../etc/passwd'), false);
  const custom = createCharacterAsset({ name: 'rig', src: '/assets/custom.glb' });
  assert.equal(custom.character.src, '/assets/custom.glb');
  assert.equal(custom.character.model, 'custom');
  const bad = createCharacterAsset({ name: 'rig', src: 'http://x/a.glb' });
  assert.equal(bad.character.src, '/assets/female-hero.gltf');
});

test('mcp upsert_asset accepts character src override', async () => {
  const store = memoryStore();
  const created = await callTool('upsert_asset', {
    name: 'belize rig',
    kind: 'character',
    model: 'male-hero',
    src: '/assets/male-belizean.glb'
  }, store);
  assert.equal(created.asset.characterSrc, '/assets/male-belizean.glb');
});

test('seedVoxelStarter builds a humanoid from hero name', () => {
  const asset = createVoxelAsset({ name: 'female hero', size: [6, 6, 6] });
  const result = seedVoxelStarter(asset);
  assert.equal(result.seeded, true);
  assert.equal(result.template, 'humanoid');
  assert.deepEqual(asset.voxel.size, [8, 14, 6]);
  const xs = asset.voxel.voxels.map(v => v.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 4);
  assert.ok(asset.voxel.voxels.length > 40);
  assert.ok(computeVoxelMeshStats(asset).triangles > 0);
});

test('mesh stats count exposed faces on a single voxel', () => {
  const asset = createVoxelAsset({ name: 'cube', size: [2, 2, 2] });
  paintVoxelCells(asset, [{ x: 0, y: 0, z: 0, c: '#fff' }]);
  const mesh = computeVoxelMeshStats(asset);
  assert.equal(mesh.voxelCount, 1);
  assert.equal(mesh.faces, 6);
  assert.equal(mesh.triangles, 12);
});

test('paint and erase stay inside the grid', () => {
  const asset = createVoxelAsset({ name: 'crate', size: [2, 2, 2] });
  const errors = paintVoxelCells(asset, [
    { x: 0, y: 0, z: 0, c: '#e05252' },
    { x: 9, y: 0, z: 0, c: '#fff' },
    { x: 0, y: 0, z: 0, erase: true }
  ]);
  assert.deepEqual(errors, ['out of bounds 9,0,0']);
  assert.equal(asset.voxel.voxels.length, 0);
  assert.deepEqual(gfValidateAsset(asset), []);
});

test('collision hits a collidable placement and misses beside it', () => {
  const asset = createVoxelAsset({ id: 'box', name: 'box', size: [2, 2, 2], collidable: true });
  const library = { version: 1, assets: [asset] };
  const level = { version: 1, ground: { size: 60 }, placements: [{ id: 'p1', assetId: 'box', x: 0, y: 0, z: 0, ry: 0, scale: 1 }] };
  assert.equal(collidesAt(library, level, 0, 0).hit, true);
  assert.equal(collidesAt(library, level, 10, 10).hit, false);
});

test('mcp upsert_asset seeds humanoid mesh without cells', async () => {
  const store = memoryStore();
  const created = await callTool('upsert_asset', { name: 'female hero', kind: 'voxel', size: [6, 6, 6] }, store);
  assert.ok(created.asset.voxelCount > 0);
  assert.ok(created.asset.mesh.triangles > 0);
});

test('mcp paint_voxels then test_level', async () => {
  const store = memoryStore();
  const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, store);
  assert.ok(listed.result.tools.some(tool => tool.name === 'paint_voxels'));
  const painted = await callTool('paint_voxels', {
    name: 'female',
    size: [6, 6, 6],
    cells: [{ x: 1, y: 0, z: 1, c: '#e05252' }]
  }, store);
  assert.equal(painted.asset.voxelCount, 1);
  await callTool('place', { name: 'female', x: 0, z: 0 }, store);
  const report = await callTool('test_level', { probes: [{ x: 0, z: 0 }, { x: 8, z: 8 }] }, store);
  assert.equal(report.ok, true);
  assert.equal(report.probes[0].hit, true);
  assert.equal(report.probes[1].hit, false);
});
