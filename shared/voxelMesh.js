/**
 * Builds three.js Object3D from a GameForge asset.
 * Requires THREE to be loaded globally before importing this module.
 */

import { normalizeSpriteAsset } from './forgeCore.js';

export function gfBuildVoxelMesh(asset, opts) {
  const recenter = !opts || opts.recenter !== false;
  const { cellSize, voxels } = asset.voxel;
  const group = new THREE.Group();
  group.name = asset.name;

  // Merge same-color voxels into InstancedMesh per color for perf.
  const byColor = {};
  for (const v of voxels) {
    (byColor[v.c] = byColor[v.c] || []).push(v);
  }

  const geo = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
  for (const color in byColor) {
    const list = byColor[color];
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((v, i) => {
      m.makeTranslation(v.x * cellSize, v.y * cellSize, v.z * cellSize);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (!recenter || !group.children.length) return group;
  // Recenter group so origin sits at the model's horizontal center, base on floor.
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.children.forEach(c => {
    c.position.x -= center.x;
    c.position.z -= center.z;
    c.position.y -= box.min.y;
  });

  return group;
}

function gfAlignObjectToGround(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
}

function gfLoadCharacterIntoGroup(group, src) {
  if (!THREE.GLTFLoader) return;
  group.userData.loadToken = (group.userData.loadToken || 0) + 1;
  const token = group.userData.loadToken;
  new THREE.GLTFLoader().load(src, (gltf) => {
    if (group.userData.loadToken !== token) return;
    while (group.children.length) group.remove(group.children[0]);
    gltf.scene.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    gfAlignObjectToGround(gltf.scene);
    group.add(gltf.scene);
  }, undefined, () => {});
}

export function gfBuildSpriteMesh(asset) {
  normalizeSpriteAsset(asset);
  const { w, h, pixels } = asset.sprite;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixels[y * w + x];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;

  const hasPixels = pixels.some(Boolean);
  const aspect = w / h || 1;
  const planeH = 2;
  const planeW = aspect * planeH;
  const geo = new THREE.PlaneGeometry(planeW, planeH);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: hasPixels,
    opacity: hasPixels ? 1 : 0
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = planeH / 2;

  const group = new THREE.Group();
  group.name = asset.name;
  group.add(mesh);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.5 })
  );
  frame.position.copy(mesh.position);
  group.add(frame);

  return group;
}

export function gfBuildAssetMesh(asset) {
  if (asset.kind === 'voxel') return gfBuildVoxelMesh(asset);
  if (asset.kind === 'sprite') return gfBuildSpriteMesh(asset);
  if (asset.kind === 'character') {
    const group = new THREE.Group();
    group.name = asset.name || 'character';
    const src = (asset.character && asset.character.src) || '/assets/female-hero.gltf';
    gfLoadCharacterIntoGroup(group, src);
    return group;
  }
  if (asset.kind === 'kit') {
    const group = new THREE.Group();
    group.name = asset.name || 'kit';
    const preview =
      (asset.kit && asset.kit.derivatives && asset.kit.derivatives.web && asset.kit.derivatives.web.src) ||
      ((asset.kit && asset.kit.parts) || []).map(p => p && p.src).find(s => s && /\.(glb|gltf)$/i.test(s));
    if (preview) gfLoadCharacterIntoGroup(group, preview);
    return group;
  }
  throw new Error('unknown asset kind: ' + asset.kind);
}
