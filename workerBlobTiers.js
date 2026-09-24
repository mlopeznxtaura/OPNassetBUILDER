import { AwsClient } from 'aws4fetch';
import { parseTierOrder } from './shared/storageTiers.js';

const META_PREFIX = '__meta/';
export const UPLOAD_URL_EXPIRES_SEC = 900;

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

async function presignS3Put(client, putUrl, contentType) {
  const headers = contentType ? { 'content-type': contentType } : undefined;
  const signed = await client.sign(new Request(putUrl, { method: 'PUT', headers }), {
    aws: { signQuery: true, expires: UPLOAD_URL_EXPIRES_SEC }
  });
  return {
    mode: 'direct',
    method: 'PUT',
    uploadUrl: signed.url,
    headers: contentType ? { 'content-type': contentType } : {},
    expiresIn: UPLOAD_URL_EXPIRES_SEC
  };
}

async function presignSupabase(env, key, contentType) {
  const base = env.SUPABASE_URL;
  const token = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_BUCKET || 'opn-meshes';
  if (!base || !token) return null;
  const path = key.replace(/\//g, '_');
  const res = await fetch(`${base.replace(/\/$/, '')}/storage/v1/object/upload/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: UPLOAD_URL_EXPIRES_SEC })
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.url) return null;
  await saveMeta(env, key, { backend: 'supabase', bucket, path, contentType });
  const headers = { 'x-upsert': 'true' };
  if (data.token) headers.authorization = `Bearer ${data.token}`;
  return {
    backend: 'supabase',
    mode: 'direct',
    method: 'PUT',
    uploadUrl: data.url,
    headers,
    expiresIn: UPLOAD_URL_EXPIRES_SEC
  };
}

async function presignAws(env, key, contentType) {
  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION || 'us-east-1';
  const client = awsClient(env, region);
  if (!bucket || !client) return null;
  const objectKey = `opnassetbuilder/${key}`;
  const custom = env.AWS_S3_ENDPOINT;
  const putUrl = custom
    ? `${custom.replace(/\/$/, '')}/${bucket}/${objectKey}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
  const presigned = await presignS3Put(client, putUrl, contentType);
  await saveMeta(env, key, { backend: 'aws', bucket, objectKey, region, custom: custom || null, contentType });
  return { backend: 'aws', ...presigned };
}

async function presignOci(env, key, contentType) {
  const endpoint = env.OCI_S3_ENDPOINT;
  const bucket = env.OCI_S3_BUCKET;
  const region = env.OCI_S3_REGION || 'us-phoenix-1';
  const client = ociClient(env, region);
  if (!endpoint || !bucket || !client) return null;
  const host = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const objectKey = `opnassetbuilder/${key}`;
  const putUrl = `https://${host}/${bucket}/${objectKey}`;
  const presigned = await presignS3Put(client, putUrl, contentType);
  await saveMeta(env, key, { backend: 'oci', host, bucket, objectKey, region, contentType });
  return { backend: 'oci', ...presigned };
}

function presignWorkerPut(origin, sessionId, filename, contentType) {
  const safe = filename.split('/').pop();
  return {
    backend: 'worker',
    mode: 'worker',
    method: 'PUT',
    uploadUrl: `${origin}/api/blobs/${sessionId}/${encodeURIComponent(safe)}`,
    headers: { 'content-type': contentType || 'model/gltf-binary' },
    expiresIn: UPLOAD_URL_EXPIRES_SEC,
    sessionHeader: 'X-GameForge-Session'
  };
}

/** Per-session upload URL (~15m). Direct presign when tier supports it; else Worker PUT. */
export async function issueUploadUrl(env, key, sessionId, filename, contentType, requestUrl) {
  const ct = contentType || 'model/gltf-binary';
  const origin = new URL(requestUrl).origin;
  const baseName = filename.split('/').pop();
  const direct = {
    supabase: () => presignSupabase(env, key, ct),
    aws: () => presignAws(env, key, ct),
    oci: () => presignOci(env, key, ct)
  };
  for (const tier of parseTierOrder(env)) {
    if (tier === 'assets' || tier === 'mongo' || tier === 'vercel' || tier === 'r2') continue;
    const run = direct[tier];
    if (!run) continue;
    const out = await run();
    if (out) {
      return { ok: true, ...out, src: `/api/blobs/${sessionId}/${baseName}` };
    }
  }
  const worker = presignWorkerPut(origin, sessionId, filename, ct);
  return {
    ok: true,
    ...worker,
    src: `/api/blobs/${sessionId}/${baseName}`,
    note: 'Upload with X-GameForge-Session matching sessionId; uses normal tier order on PUT.'
  };
}
