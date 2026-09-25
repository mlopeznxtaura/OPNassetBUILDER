import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedBlobFilename,
  isAllowedKitSrc,
  isPreviewableMeshSrc
} from './engineBlob.js';

test('blob filenames allow engine interchange types', () => {
  assert.equal(isAllowedBlobFilename('hero.glb'), true);
  assert.equal(isAllowedBlobFilename('hero.fbx'), true);
  assert.equal(isAllowedBlobFilename('kit.zip'), true);
  assert.equal(isAllowedBlobFilename('evil.exe'), false);
  assert.equal(isAllowedBlobFilename('../x.glb'), false);
});

test('kit src allowlist', () => {
  assert.equal(isAllowedKitSrc('/assets/belize.fbx'), true);
  assert.equal(isAllowedKitSrc('/api/blobs/s_abc123/belize-kit.zip'), true);
  assert.equal(isAllowedKitSrc('https://evil.com/x.glb'), false);
});

test('previewable mesh is gltf only', () => {
  assert.equal(isPreviewableMeshSrc('/assets/x.glb'), true);
  assert.equal(isPreviewableMeshSrc('/assets/x.fbx'), false);
});
