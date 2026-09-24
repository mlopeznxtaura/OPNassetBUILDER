import { AwsClient } from 'aws4fetch';
import { parseTierOrder } from './shared/storageTiers.js';

const META_PREFIX = '__meta/';

function awsClient(env, region) {
  const access = env.AWS_ACCESS_KEY_ID;
  const secret = env.AWS_SECRET_ACCESS_KEY;
  if (!access || !secret) return null;
  return new AwsClient({ accessKeyId: access, secretAccessKey: secret, region });
}

function ociClient(env, region) {
  const access = env.OCI_S3_ACCESS_KEY_ID;
  const secret = env.OCI_S3_SECRET_ACCESS_KEY;
  if (!access || !secret) return null;
  return new AwsClient({ accessKeyId: access, secretAccessKey: secret, region });
}

async function saveMeta(env, key, meta) {
  if (!env.BLOBS) return;
  await env.BLOBS.put(META_PREFIX + key, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function readMeta(env, key) {
  if (!env.BLOBS) return null;
  const obj = await env.BLOBS.get(META_PREFIX + key);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

async function putR2(env, key, body, contentType) {
  if (!env.BLOBS) return null;
  await env.BLOBS.put(key, body, { httpMetadata: { contentType } });
  return 'r2';
}

async function putSupabase(env, key, body, contentType) {
  const url = env.SUPABASE_URL;
  const token = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_BUCKET || 'opn-meshes';
  if (!url || !token) return null;
  const path = key.replace(/\//g, '_');
  const res = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': contentType,
      'x-upsert': 'true'
    },
    body
  });
  if (!res.ok) return null;
  await saveMeta(env, key, { backend: 'supabase', bucket, path });
  return 'supabase';
}

async function putVercel(env, key, body, contentType) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const pathname = key.replace(/\//g, '-');
  const res = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(pathname)}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': contentType,
      'x-api-version': '7'
    },
    body
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.url) return null;
  await saveMeta(env, key, { backend: 'vercel', url: data.url });
  return 'vercel';
}

async function putOci(env, key, body, contentType) {
  const endpoint = env.OCI_S3_ENDPOINT;
  const bucket = env.OCI_S3_BUCKET;
  const region = env.OCI_S3_REGION || 'us-phoenix-1';
  const client = ociClient(env, region);
  if (!endpoint || !bucket || !client) return null;
  const host = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const objectKey = `opnassetbuilder/${key}`;
  const url = `https://${host}/${bucket}/${objectKey}`;
  const res = await client.fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } });
  if (!res.ok) return null;
  await saveMeta(env, key, { backend: 'oci', host, bucket, objectKey, region });
  return 'oci';
}

async function putAws(env, key, body, contentType) {
  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION || 'us-east-1';
  const client = awsClient(env, region);
  if (!bucket || !client) return null;
  const objectKey = `opnassetbuilder/${key}`;
  const custom = env.AWS_S3_ENDPOINT;
  const url = custom
    ? `${custom.replace(/\/$/, '')}/${bucket}/${objectKey}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
  const res = await client.fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } });
  if (!res.ok) return null;
  await saveMeta(env, key, { backend: 'aws', bucket, objectKey, region, custom: custom || null });
  return 'aws';
}

export async function storeBlob(env, key, body, contentType) {
  const handlers = {
    supabase: () => putSupabase(env, key, body, contentType),
    vercel: () => putVercel(env, key, body, contentType),
    oci: () => putOci(env, key, body, contentType),
    aws: () => putAws(env, key, body, contentType),
    r2: () => putR2(env, key, body, contentType)
  };
  for (const tier of parseTierOrder(env)) {
    if (tier === 'assets' || tier === 'mongo') continue;
    const run = handlers[tier];
    if (!run) continue;
    const backend = await run();
    if (backend) return backend;
  }
  return null;
}

export async function loadBlob(env, key) {
  const direct = env.BLOBS ? await env.BLOBS.get(key) : null;
  if (direct) {
    return {
      body: direct.body,
      contentType: direct.httpMetadata?.contentType || 'model/gltf-binary'
    };
  }

  const url = env.SUPABASE_URL;
  const token = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_BUCKET || 'opn-meshes';
  const meta = await readMeta(env, key);
  if (meta && meta.backend === 'supabase' && url && token) {
    const res = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${meta.path}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      return { body: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'model/gltf-binary' };
    }
  }

  if (!meta) return null;

  if (meta.backend === 'vercel' && meta.url && /^https:\/\/[^/]*vercel-storage\.com\//.test(meta.url)) {
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return { body: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'model/gltf-binary' };
  }

  if (meta.backend === 'oci') {
    const client = ociClient(env, meta.region);
    if (!client) return null;
    const url = `https://${meta.host}/${meta.bucket}/${meta.objectKey}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return { body: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'model/gltf-binary' };
  }

  if (meta.backend === 'aws') {
    const client = awsClient(env, meta.region);
    if (!client) return null;
    const url = meta.custom
      ? `${meta.custom.replace(/\/$/, '')}/${meta.bucket}/${meta.objectKey}`
      : `https://${meta.bucket}.s3.${meta.region}.amazonaws.com/${meta.objectKey}`;
    const res = await client.fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return { body: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'model/gltf-binary' };
  }

  return null;
}
