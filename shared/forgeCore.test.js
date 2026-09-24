import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collidesAt,
  computeVoxelMeshStats,
  createVoxelAsset,
  gfValidateAsset,
  memoryStore,
  paintVoxelCells,
  seedVoxelStarter
} from './forgeCore.js';
import { callTool, handleMcpMessage } from './mcpTools.js';

test('seedVoxelStarter builds a humanoid from hero name', () => {
  const asset = createVoxelAsset({ name: 'female hero', size: [6, 6, 6] });
  const result = seedVoxelStarter(asset);
  assert.equal(result.seeded, true);
  assert.equal(result.template, 'humanoid');
  assert.ok(asset.voxel.voxels.length > 8);
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
