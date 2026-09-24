import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOB_TIER_ORDER_DEFAULT, parseTierOrder } from './storageTiers.js';

test('default tier order uses r2 last', () => {
  assert.equal(BLOB_TIER_ORDER_DEFAULT[BLOB_TIER_ORDER_DEFAULT.length - 1], 'r2');
  assert.equal(BLOB_TIER_ORDER_DEFAULT[0], 'assets');
  assert.ok(BLOB_TIER_ORDER_DEFAULT.includes('oci'));
  assert.ok(BLOB_TIER_ORDER_DEFAULT.includes('aws'));
});

test('parseTierOrder respects env override', () => {
  assert.deepEqual(parseTierOrder({ BLOB_TIER_ORDER: 'aws,oci,r2' }), ['aws', 'oci', 'r2']);
});
