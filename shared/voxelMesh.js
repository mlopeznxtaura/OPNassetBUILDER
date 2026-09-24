/**
 * Builds three.js Object3D from a GameForge asset.
 * Requires THREE to be loaded globally before this script.
 */

function gfBuildVoxelMesh(asset, opts) {
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

function gfBuildSpriteMesh(asset) {
  const { w, h, pixels } = asset.sprite;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixels[y * w + x];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = w / h;
  sprite.scale.set(aspect * 2, 2, 1);
  sprite.position.y = 1;
  const group = new THREE.Group();
  group.name = asset.name;
  group.add(sprite);
  return group;
}

function gfBuildAssetMesh(asset) {
  if (asset.kind === 'voxel') return gfBuildVoxelMesh(asset);
  if (asset.kind === 'sprite') return gfBuildSpriteMesh(asset);
  if (asset.kind === 'character') {
    const group = new THREE.Group();
    group.name = asset.name || 'character';
    const src = (asset.character && asset.character.src) || '/assets/female-hero.gltf';
    if (THREE.GLTFLoader) {
      new THREE.GLTFLoader().load(src, (gltf) => {
        gltf.scene.traverse(obj => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        group.add(gltf.scene);
      });
    }
    return group;
  }
  throw new Error('unknown asset kind: ' + asset.kind);
}
