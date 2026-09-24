import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const bones = [
  { name: 'hips', parent: -1, local: [0, 0.9, 0] },
  { name: 'spine', parent: 0, local: [0, 0.14, 0] },
  { name: 'chest', parent: 1, local: [0, 0.16, 0] },
  { name: 'neck', parent: 2, local: [0, 0.18, 0] },
  { name: 'head', parent: 3, local: [0, 0.1, 0] },
  { name: 'shoulder.L', parent: 2, local: [-0.16, 0.1, 0] },
  { name: 'elbow.L', parent: 5, local: [-0.04, -0.24, 0.02] },
  { name: 'hand.L', parent: 6, local: [0.02, -0.22, 0.02] },
  { name: 'shoulder.R', parent: 2, local: [0.16, 0.1, 0] },
  { name: 'elbow.R', parent: 8, local: [0.04, -0.24, 0.02] },
  { name: 'hand.R', parent: 9, local: [-0.02, -0.22, 0.02] },
  { name: 'thigh.L', parent: 0, local: [-0.09, -0.06, 0] },
  { name: 'knee.L', parent: 11, local: [0, -0.38, 0.02] },
  { name: 'ankle.L', parent: 12, local: [0, -0.36, -0.02] },
  { name: 'thigh.R', parent: 0, local: [0.09, -0.06, 0] },
  { name: 'knee.R', parent: 14, local: [0, -0.38, 0.02] },
  { name: 'ankle.R', parent: 15, local: [0, -0.36, -0.02] }
];

function worldOf(i) {
  if (bones[i].world) return bones[i].world;
  const [x, y, z] = bones[i].local;
  if (bones[i].parent < 0) bones[i].world = [x, y, z];
  else {
    const p = worldOf(bones[i].parent);
    bones[i].world = [p[0] + x, p[1] + y, p[2] + z];
  }
  return bones[i].world;
}
bones.forEach((_, i) => worldOf(i));

const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));
const partBones = {
  head: ['neck', 'head'],
  hair: ['head'],
  face: ['head'],
  torso: ['hips', 'spine', 'chest'],
  cloth: ['hips', 'spine'],
  armL: ['shoulder.L', 'elbow.L', 'hand.L'],
  armR: ['shoulder.R', 'elbow.R', 'hand.R'],
  legL: ['thigh.L', 'knee.L', 'ankle.L'],
  legR: ['thigh.R', 'knee.R', 'ankle.R']
};

const buckets = {
  skin: { pos: [], nrm: [], joints: [], weights: [], idx: [] },
  hair: { pos: [], nrm: [], joints: [], weights: [], idx: [] },
  cloth: { pos: [], nrm: [], joints: [], weights: [], idx: [] },
  eyes: { pos: [], nrm: [], joints: [], weights: [], idx: [] }
};

function weight(part, x, y, z) {
  const scored = partBones[part].map(name => {
    const i = boneIndex[name];
    const w = worldOf(i);
    const d = Math.hypot(x - w[0], y - w[1], z - w[2]) + 0.025;
    return { i, w: 1 / d };
  }).sort((a, b) => b.w - a.w).slice(0, 4);
  const sum = scored.reduce((s, t) => s + t.w, 0);
  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  scored.forEach((t, k) => {
    joints[k] = t.i;
    weights[k] = t.w / sum;
  });
  return { joints, weights };
}

function basis(axis) {
  const a = axis;
  const helper = Math.abs(a[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
  const tx = a[1] * helper[2] - a[2] * helper[1];
  const ty = a[2] * helper[0] - a[0] * helper[2];
  const tz = a[0] * helper[1] - a[1] * helper[0];
  const tl = Math.hypot(tx, ty, tz) || 1;
  const bx = ty * a[2] - tz * a[1];
  const by = tz * a[0] - tx * a[2];
  const bz = tx * a[1] - ty * a[0];
  const bl = Math.hypot(bx, by, bz) || 1;
  return [
    [tx / tl, ty / tl, tz / tl],
    a,
    [bx / bl, by / bl, bz / bl]
  ];
}

function addSurface(material, part, slices, stacks, sample) {
  const bucket = buckets[material];
  const start = bucket.pos.length / 3;
  const grid = [];
  for (let iy = 0; iy <= stacks; iy++) {
    const row = [];
    for (let ix = 0; ix <= slices; ix++) {
      const p = sample(ix / slices, iy / stacks);
      const nlen = Math.hypot(p.nx, p.ny, p.nz) || 1;
      const w = weight(part, p.x, p.y, p.z);
      bucket.pos.push(p.x, p.y, p.z);
      bucket.nrm.push(p.nx / nlen, p.ny / nlen, p.nz / nlen);
      bucket.joints.push(...w.joints);
      bucket.weights.push(...w.weights);
      row.push(start + iy * (slices + 1) + ix);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < stacks; iy++) {
    for (let ix = 0; ix < slices; ix++) {
      const a = grid[iy][ix];
      const b = grid[iy + 1][ix];
      const c = grid[iy][ix + 1];
      const d = grid[iy + 1][ix + 1];
      bucket.idx.push(a, b, c, b, d, c);
    }
  }
}

function addEllipsoid(material, part, cx, cy, cz, rx, ry, rz, slices = 16, stacks = 12) {
  addSurface(material, part, slices, stacks, (u, v) => {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;
    const sr = Math.sin(phi);
    const x = cx + rx * sr * Math.cos(theta);
    const y = cy + ry * Math.cos(phi);
    const z = cz + rz * sr * Math.sin(theta);
    return {
      x, y, z,
      nx: (x - cx) / (rx * rx),
      ny: (y - cy) / (ry * ry),
      nz: (z - cz) / (rz * rz)
    };
  });
}

function addTube(material, part, from, to, r0, r1, slices = 12) {
  const a = worldOf(boneIndex[from]);
  const b = worldOf(boneIndex[to]);
  const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...dir) || 1;
  const axis = dir.map(v => v / len);
  const [tx, , bz] = basis(axis);
  addSurface(material, part, slices, 1, (u, v) => {
    const theta = u * Math.PI * 2;
    const radius = r0 + (r1 - r0) * v;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const ox = tx[0] * c * radius + bz[0] * s * radius;
    const oy = tx[1] * c * radius + bz[1] * s * radius;
    const oz = tx[2] * c * radius + bz[2] * s * radius;
    return {
      x: a[0] + axis[0] * len * v + ox,
      y: a[1] + axis[1] * len * v + oy,
      z: a[2] + axis[2] * len * v + oz,
      nx: ox, ny: oy, nz: oz
    };
  });
}

function clearMesh() {
  for (const bucket of Object.values(buckets)) {
    bucket.pos.length = 0;
    bucket.nrm.length = 0;
    bucket.joints.length = 0;
    bucket.weights.length = 0;
    bucket.idx.length = 0;
  }
}

function sculpt(profile) {
  clearMesh();
  const female = profile === 'female';
  const head = worldOf(boneIndex.head);
  addEllipsoid('skin', 'head', head[0], head[1], head[2], 0.09, 0.11, 0.095, 16, 12);
  addSurface('hair', 'hair', 14, 6, (u, v) => {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI * 0.55;
    const sr = Math.sin(phi);
    return {
      x: head[0] + 0.098 * sr * Math.cos(theta),
      y: head[1] + 0.02 + 0.12 * Math.cos(phi),
      z: head[2] - 0.01 + 0.1 * sr * Math.sin(theta),
      nx: sr * Math.cos(theta),
      ny: Math.cos(phi),
      nz: sr * Math.sin(theta)
    };
  });
  addEllipsoid('eyes', 'face', head[0] - 0.032, head[1] + 0.015, head[2] + 0.082, 0.012, 0.012, 0.008, 6, 4);
  addEllipsoid('eyes', 'face', head[0] + 0.032, head[1] + 0.015, head[2] + 0.082, 0.012, 0.012, 0.008, 6, 4);
  addTube('skin', 'head', 'neck', 'head', 0.04, 0.045, 8);
  const chestR = female ? 0.13 : 0.16;
  const waistR = female ? 0.09 : 0.12;
  const hipR = female ? 0.13 : 0.12;
  addTube('skin', 'torso', 'hips', 'chest', hipR, chestR, 14);
  addTube('cloth', 'cloth', 'spine', 'chest', waistR + 0.012, chestR + 0.012, 14);
  addTube('cloth', 'cloth', 'hips', 'spine', hipR + 0.01, waistR + 0.01, 12);
  addTube('skin', 'armL', 'shoulder.L', 'elbow.L', 0.045, 0.038);
  addTube('skin', 'armL', 'elbow.L', 'hand.L', 0.036, 0.03);
  addEllipsoid('skin', 'armL', ...worldOf(boneIndex['hand.L']), 0.032, 0.04, 0.02, 8, 6);
  addTube('skin', 'armR', 'shoulder.R', 'elbow.R', 0.045, 0.038);
  addTube('skin', 'armR', 'elbow.R', 'hand.R', 0.036, 0.03);
  addEllipsoid('skin', 'armR', ...worldOf(boneIndex['hand.R']), 0.032, 0.04, 0.02, 8, 6);
  addTube('skin', 'legL', 'thigh.L', 'knee.L', 0.07, 0.05);
  addTube('skin', 'legL', 'knee.L', 'ankle.L', 0.048, 0.038);
  addEllipsoid('skin', 'legL', ...worldOf(boneIndex['ankle.L']), 0.04, 0.028, 0.07, 8, 4);
  addTube('skin', 'legR', 'thigh.R', 'knee.R', 0.07, 0.05);
  addTube('skin', 'legR', 'knee.R', 'ankle.R', 0.048, 0.038);
  addEllipsoid('skin', 'legR', ...worldOf(boneIndex['ankle.R']), 0.04, 0.028, 0.07, 8, 4);
}

const materialNames = ['skin', 'hair', 'cloth', 'eyes'];
let chunks = [];
let accessors = [];
let bufferViews = [];
function pushF32(arr) {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], i * 4);
  const offset = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(buf);
  return { offset, length: buf.length, count: arr.length };
}
function pushU8(arr) {
  const buf = Buffer.from(arr);
  const offset = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(buf);
  return { offset, length: buf.length, count: arr.length };
}
function pushU16(arr) {
  const buf = Buffer.alloc(arr.length * 2);
  for (let i = 0; i < arr.length; i++) buf.writeUInt16LE(arr[i], i * 2);
  const offset = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(buf);
  return { offset, length: buf.length, count: arr.length };
}

function view(bin, target) {
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: bin.offset, byteLength: bin.length, target });
  return index;
}
function accessor(viewIndex, count, type, componentType, extra = {}) {
  const index = accessors.length;
  accessors.push({ bufferView: viewIndex, componentType, count, type, ...extra });
  return index;
}

function emit(id, cloth) {
  chunks = [];
  accessors = [];
  bufferViews = [];
  const primitives = [];
  let vertices = 0;
  let triangles = 0;
  for (const name of materialNames) {
    const bucket = buckets[name];
    const vcount = bucket.pos.length / 3;
    if (!vcount) continue;
    vertices += vcount;
    triangles += bucket.idx.length / 3;
    const pos = pushF32(bucket.pos);
    const nrm = pushF32(bucket.nrm);
    const jnt = pushU8(bucket.joints);
    const wgt = pushF32(bucket.weights);
    const ind = pushU16(bucket.idx);
    primitives.push({
      attributes: {
        POSITION: accessor(view(pos, 34962), vcount, 'VEC3', 5126, { min: min3(bucket.pos), max: max3(bucket.pos) }),
        NORMAL: accessor(view(nrm, 34962), vcount, 'VEC3', 5126),
        JOINTS_0: accessor(view(jnt, 34962), vcount, 'VEC4', 5121),
        WEIGHTS_0: accessor(view(wgt, 34962), vcount, 'VEC4', 5126)
      },
      indices: accessor(view(ind, 34963), bucket.idx.length, 'SCALAR', 5123),
      material: materialNames.indexOf(name),
      mode: 4
    });
  }

const ibms = [];
for (const bone of bones) {
  const [x, y, z] = bone.world;
  ibms.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1);
}
const ibm = pushF32(ibms);
const ibmAccessor = accessor(view(ibm), bones.length, 'MAT4', 5126);

const bin = Buffer.concat(chunks);
const colors = {
  skin: [0.79, 0.58, 0.48, 1],
  hair: [0.18, 0.09, 0.06, 1],
  cloth,
  eyes: [0.08, 0.09, 0.12, 1]
};

const nodes = bones.map(bone => ({
  name: bone.name,
  translation: bone.local,
  children: bones.map((child, i) => child.parent === bones.indexOf(bone) ? i : -1).filter(i => i >= 0)
}));
nodes.forEach(node => { if (!node.children.length) delete node.children; });
const meshNode = nodes.length;
nodes.push({ name: id, mesh: 0, skin: 0 });

const stats = {
  vertices,
  triangles,
  materials: materialNames.length,
  bones: bones.length
};

const gltf = {
  asset: { version: '2.0', generator: 'OPNassetBUILDER ' + id, extras: { meshStats: stats } },
  scene: 0,
  scenes: [{ name: id, nodes: [0, meshNode] }],
  nodes,
  skins: [{ name: 'humanoid', joints: bones.map((_, i) => i), inverseBindMatrices: ibmAccessor, skeleton: 0 }],
  meshes: [{ name: id, primitives }],
  materials: materialNames.map(name => ({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: colors[name],
      metallicFactor: 0,
      roughnessFactor: name === 'eyes' ? 0.2 : 0.62
    }
  })),
  buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  bufferViews,
  accessors
};
  return {
    gltf,
    model: {
      id,
      label: id === 'male-hero' ? 'Male hero base' : 'Female hero base',
      src: '/assets/' + id + '.gltf',
      stats
    }
  };
}

function min3(arr) {
  let x = Infinity, y = Infinity, z = Infinity;
  for (let i = 0; i < arr.length; i += 3) {
    x = Math.min(x, arr[i]); y = Math.min(y, arr[i + 1]); z = Math.min(z, arr[i + 2]);
  }
  return [x, y, z];
}
function max3(arr) {
  let x = -Infinity, y = -Infinity, z = -Infinity;
  for (let i = 0; i < arr.length; i += 3) {
    x = Math.max(x, arr[i]); y = Math.max(y, arr[i + 1]); z = Math.max(z, arr[i + 2]);
  }
  return [x, y, z];
}

mkdirSync(join(root, 'assets'), { recursive: true });
const written = [];
for (const [profile, id, cloth] of [
  ['female', 'female-hero', [0.72, 0.29, 0.48, 1]],
  ['male', 'male-hero', [0.2, 0.32, 0.55, 1]]
]) {
  sculpt(profile);
  const { gltf, model } = emit(id, cloth);
  writeFileSync(join(root, 'assets', id + '.gltf'), JSON.stringify(gltf));
  written.push(model);
  console.log(id, model.stats);
}

const catalog = Object.fromEntries(written.map(model => [model.id, model]));
writeFileSync(join(root, 'shared', 'characterModels.js'), `export const CHARACTER_MODELS = ${JSON.stringify(catalog, null, 2)};

export function characterModel(id) {
  return CHARACTER_MODELS[id] || CHARACTER_MODELS['female-hero'];
}
`);
