import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collidesAt,
  createVoxelAsset,
  gfValidateAsset,
  memoryStore,
  paintVoxelCells
} from './forgeCore.js';
import { callTool, handleMcpMessage } from './mcpTools.js';

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
