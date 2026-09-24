import { createLiveClient } from '../shared/liveClient.js';
import {
  computeVoxelMeshStats,
  createCharacterAsset,
  createSpriteAsset,
  createVoxelAsset,
  gfNewId,
  gfValidateAsset,
  seedVoxelStarter
} from '../shared/forgeCore.js';

const STORAGE_KEY = 'gameforge_assets_v1';
const live = createLiveClient();
let remote = false;
let dirty = false;
let seenRevision = -1;

function gfLoadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, assets: [] };
    const parsed = JSON.parse(raw);
    return parsed.assets ? parsed : { version: 1, assets: [] };
  } catch (e) {
    return { version: 1, assets: [] };
  }
}
function gfSaveLibrary(lib) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}
function gfUpsertAsset(asset) {
  const lib = gfLoadLibrary();
  const idx = lib.assets.findIndex(a => a.id === asset.id);
  if (idx >= 0) lib.assets[idx] = asset;
  else lib.assets.push(asset);
  gfSaveLibrary(lib);
  return lib;
}
function gfDeleteAsset(id) {
  const lib = gfLoadLibrary();
  lib.assets = lib.assets.filter(a => a.id !== id);
  gfSaveLibrary(lib);
  return lib;
}
function gfDownloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function gfReadFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(r.result)); }
      catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

function setStatus(text) {
  document.getElementById('syncStatus').textContent = text;
}
function markDirty() { dirty = true; }

let viewStats = null;

function formatMeshStats(asset) {
  if (asset && asset.kind === 'character') {
    const mesh = viewStats || (asset.character && asset.character.stats) || {};
    const pending = !viewStats;
    return {
      lines: [
        pending ? 'Loading skinned mesh…' : `<strong>${(mesh.vertices || 0).toLocaleString()}</strong> vertices`,
        `<strong>${(mesh.triangles || 0).toLocaleString()}</strong> triangles · <strong>${mesh.materials || 0}</strong> materials`,
        `<strong>${mesh.bones || 0}</strong> bones · ${asset.character.model || 'character'}`
      ],
      toolbar: pending ? 'Loading character…' : `${(mesh.triangles || 0).toLocaleString()} tris · ${mesh.bones || 0} bones`
    };
  }
  if (!asset || asset.kind !== 'voxel') {
    if (asset && asset.kind === 'sprite') {
      const opaque = asset.sprite.pixels.filter(Boolean).length;
      return { lines: [`<strong>${opaque}</strong> painted pixels`, `${asset.sprite.w}×${asset.sprite.h} sprite`], toolbar: `${opaque} px · ${asset.sprite.w}×${asset.sprite.h}` };
    }
    return { lines: ['No mesh yet'], toolbar: '' };
  }
  const mesh = computeVoxelMeshStats(asset);
  const [gx, gy, gz] = mesh.grid || asset.voxel.size;
  if (!mesh.voxelCount) {
    return {
      lines: [
        `<strong>0</strong> solid voxels`,
        `Grid <strong>${gx}×${gy}×${gz}</strong> (wireframe shown)`,
        '<span class="muted">Enable starter mesh or paint voxels / call <code>upsert_asset</code> or <code>paint_voxels</code>.</span>'
      ],
      toolbar: `0 voxels · grid ${gx}×${gy}×${gz}`
    };
  }
  return {
    lines: [
      `<strong>${mesh.voxelCount}</strong> solid voxels`,
      `<strong>${mesh.triangles.toLocaleString()}</strong> triangles · <strong>${mesh.vertices.toLocaleString()}</strong> quad corners`,
      `<strong>${mesh.faces.toLocaleString()}</strong> exposed faces · grid ${gx}×${gy}×${gz}`
    ],
    toolbar: `${mesh.voxelCount} voxels · ${mesh.triangles.toLocaleString()} tris`
  };
}

function updateMeshStatsUI() {
  const { lines, toolbar } = formatMeshStats(current);
  const panel = document.getElementById('meshStats');
  panel.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  document.getElementById('toolbarStats').textContent = toolbar;
}

const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161c);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(8, 8, 8);
const renderer = new THREE.WebGLRenderer({ antialias: true });
viewport.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x33363f, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 5);
scene.add(dir);

let previewGroup = null;
function setPreview(obj) {
  if (previewGroup) scene.remove(previewGroup);
  previewGroup = obj;
  if (obj) scene.add(obj);
}

function resize() {
  const w = Math.max(viewport.clientWidth, 320);
  const h = Math.max(viewport.clientHeight, 320);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(viewport);
resize();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

let current = createVoxelAsset({ name: '', size: [6, 6, 6], collidable: true });
let palette = ['#e05252', '#e0a852', '#6fbf6f', '#5c9fe0', '#c15cff', '#ffffff', '#333333'];
let activeColor = palette[0];
let layerY = 0;
let selectedLibId = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const voxelHelperGroup = new THREE.Group();
scene.add(voxelHelperGroup);

function renderPalette() {
  const el = document.getElementById('palette');
  el.innerHTML = '';
  palette.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (c === activeColor ? ' active' : '');
    sw.style.background = c;
    sw.onclick = () => { activeColor = c; renderPalette(); };
    el.appendChild(sw);
  });
}
document.getElementById('btnAddSwatch').onclick = () => {
  const c = document.getElementById('colorPick').value;
  if (!palette.includes(c)) palette.push(c);
  activeColor = c;
  renderPalette();
};
renderPalette();

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function addBoundsWireframe(sx, sy, sz, cell) {
  const boxGeo = new THREE.BoxGeometry(sx * cell, sy * cell, sz * cell);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.55 })
  );
  edges.position.set(sx * cell / 2, sy * cell / 2, sz * cell / 2);
  voxelHelperGroup.add(edges);
  boxGeo.dispose();
}

function rebuildVoxelPreview() {
  clearGroup(voxelHelperGroup);
  const [sx, sy, sz] = current.voxel.size;
  const cell = current.voxel.cellSize || 1;
  const group = gfBuildVoxelMesh(current, { recenter: false });
  group.position.set(-sx * cell / 2, 0, -sz * cell / 2);
  setPreview(group);
  if (!current.voxel.voxels.length) addBoundsWireframe(sx, sy, sz, cell);
  updateMeshStatsUI();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(sx * cell, sz * cell),
    new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = layerY * cell + 0.02;
  plane.userData.isLayerPlane = true;
  voxelHelperGroup.add(plane);

  const grid = new THREE.GridHelper(Math.max(sx, sz) * cell, Math.max(sx, sz), 0x5cc8ff, 0x3a4458);
  grid.position.y = plane.position.y;
  voxelHelperGroup.add(grid);
}

function rebuildSpritePreview() {
  setPreview(gfBuildSpriteMesh(current));
  updateMeshStatsUI();
}

function paintVoxelAt(gridX, gridZ, erase) {
  const { size, voxels } = current.voxel;
  if (gridX < 0 || gridX >= size[0] || gridZ < 0 || gridZ >= size[2]) return;
  const idx = voxels.findIndex(v => v.x === gridX && v.y === layerY && v.z === gridZ);
  if (erase) {
    if (idx >= 0) voxels.splice(idx, 1);
  } else if (idx >= 0) voxels[idx].c = activeColor;
  else voxels.push({ x: gridX, y: layerY, z: gridZ, c: activeColor });
  markDirty();
  rebuildVoxelPreview();
}

function paintAtPointer(e, erase) {
  if (current.kind !== 'voxel') return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const plane = voxelHelperGroup.children.find(c => c.userData.isLayerPlane);
  if (!plane) return;
  const hits = raycaster.intersectObject(plane);
  if (!hits.length) return;
  const [sx, , sz] = current.voxel.size;
  const cell = current.voxel.cellSize || 1;
  const localX = hits[0].point.x + (sx * cell) / 2;
  const localZ = hits[0].point.z + (sz * cell) / 2;
  const gridX = Math.min(sx - 1, Math.max(0, Math.floor(localX / cell)));
  const gridZ = Math.min(sz - 1, Math.max(0, Math.floor(localZ / cell)));
  paintVoxelAt(gridX, gridZ, erase);
}

let pointerDown = null;
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, button: e.button };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pointerDown || pointerDown.button !== e.button) return;
  const dist = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
  const button = pointerDown.button;
  pointerDown = null;
  if (dist > 5) return;
  paintAtPointer(e, button === 2);
});

function rebuildSpriteGrid() {
  const { w, h, pixels } = current.sprite;
  const el = document.getElementById('spriteGrid');
  el.style.gridTemplateColumns = 'repeat(' + w + ', 16px)';
  el.replaceChildren();
  let painting = false;
  let erasing = false;
  for (let i = 0; i < w * h; i++) {
    const cell = document.createElement('div');
    cell.className = 'pixel-cell';
    cell.style.background = pixels[i] || 'repeating-conic-gradient(#2a2e38 0% 25%, #1a1d24 0% 50%) 50%/8px 8px';
    cell.addEventListener('pointerdown', (e) => {
      painting = true;
      erasing = e.button === 2;
      paintPixel(i, erasing);
    });
    cell.addEventListener('pointerenter', () => { if (painting) paintPixel(i, erasing); });
    el.appendChild(cell);
  }
  window.onpointerup = () => { painting = false; };
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function paintPixel(i, erase) {
  current.sprite.pixels[i] = erase ? '' : activeColor;
  markDirty();
  rebuildSpriteGrid();
  rebuildSpritePreview();
}

function loadAsset(asset) {
  selectedLibId = asset.id;
  viewStats = asset.kind === 'character' ? null : viewStats;
  current = JSON.parse(JSON.stringify(asset));
  document.getElementById('assetName').value = current.name || '';
  document.getElementById('assetCollidable').checked = !!current.collidable;
  document.getElementById('assetKind').value = current.kind;
  showScanStill(current.scan && current.scan.image);
  dirty = false;
  refreshModeUI();
  refreshLibraryList();
  updateMeshStatsUI();
}

let characterToken = 0;

function inspectCharacter(root) {
  let vertices = 0;
  let triangles = 0;
  let bones = 0;
  const materials = new Set();
  root.traverse(obj => {
    if (obj.isBone) bones++;
    if (!obj.isMesh) return;
    const pos = obj.geometry && obj.geometry.getAttribute('position');
    if (pos) vertices += pos.count;
    if (obj.geometry && obj.geometry.index) triangles += obj.geometry.index.count / 3;
    else if (pos) triangles += pos.count / 3;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => { if (mat) materials.add(mat.name || mat.uuid); });
  });
  return { vertices, triangles, materials: materials.size, bones };
}

function rebuildCharacterPreview() {
  const token = ++characterToken;
  const group = new THREE.Group();
  setPreview(group);
  viewStats = null;
  updateMeshStatsUI();
  clearGroup(voxelHelperGroup);
  const src = (current.character && current.character.src) || '/assets/female-hero.gltf';
  if (!THREE.GLTFLoader) {
    viewStats = { vertices: 0, triangles: 0, materials: 0, bones: 0 };
    updateMeshStatsUI();
    return;
  }
  new THREE.GLTFLoader().load(src, (gltf) => {
    if (token !== characterToken) return;
    gltf.scene.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    group.add(gltf.scene);
    viewStats = inspectCharacter(gltf.scene);
    controls.target.set(0, 0.95, 0);
    camera.position.set(1.35, 1.25, 1.9);
    updateMeshStatsUI();
  }, undefined, () => {
    if (token !== characterToken) return;
    viewStats = current.character.stats;
    updateMeshStatsUI();
  });
}

function readFormNewAsset() {
  const name = document.getElementById('assetName').value.trim() || 'unnamed';
  const kind = document.getElementById('assetKind').value;
  const collidable = document.getElementById('assetCollidable').checked;
  const useStarter = document.getElementById('seedStarter').checked;
  if (kind === 'character') {
    return createCharacterAsset({
      name,
      model: document.getElementById('characterModel').value,
      collidable
    });
  }
  if (kind === 'voxel') {
    const x = +document.getElementById('vx').value;
    const y = +document.getElementById('vy').value;
    const z = +document.getElementById('vz').value;
    const asset = createVoxelAsset({ name, size: [x, y, z], collidable });
    if (useStarter) seedVoxelStarter(asset, { hint: name });
    return asset;
  }
  const w = +document.getElementById('sw').value;
  const h = +document.getElementById('sh').value;
  return createSpriteAsset({ name, w, h, collidable });
}

function refreshModeUI() {
  const isVoxel = current.kind === 'voxel';
  const isCharacter = current.kind === 'character';
  document.getElementById('voxelSizeCtl').style.display = isVoxel ? '' : 'none';
  document.getElementById('spriteSizeCtl').style.display = isVoxel || isCharacter ? 'none' : '';
  document.getElementById('characterCtl').style.display = isCharacter ? '' : 'none';
  document.getElementById('layerCtl').style.display = isVoxel ? '' : 'none';
  document.getElementById('spriteEditorWrap').style.display = isVoxel || isCharacter ? 'none' : '';
  document.getElementById('btnReseed').style.display = isCharacter ? 'none' : '';
  document.getElementById('seedStarter').parentElement.style.display = isCharacter ? 'none' : '';
  if (isCharacter && current.character) document.getElementById('characterModel').value = current.character.model || 'female-hero';
  if (isCharacter) {
    rebuildCharacterPreview();
  } else if (isVoxel) {
    document.getElementById('layerSlider').max = current.voxel.size[1] - 1;
    document.getElementById('vx').value = current.voxel.size[0];
    document.getElementById('vy').value = current.voxel.size[1];
    document.getElementById('vz').value = current.voxel.size[2];
    rebuildVoxelPreview();
  } else {
    rebuildSpriteGrid();
    rebuildSpritePreview();
  }
}

document.getElementById('assetKind').onchange = (e) => {
  const name = document.getElementById('assetName').value.trim();
  if (e.target.value === 'voxel') current = createVoxelAsset({ name, size: [6, 6, 6], collidable: true });
  else if (e.target.value === 'character') current = createCharacterAsset({ name, model: document.getElementById('characterModel').value });
  else current = createSpriteAsset({ name });
  selectedLibId = null;
  markDirty();
  refreshModeUI();
};
document.getElementById('assetName').oninput = (e) => {
  current.name = e.target.value.trim();
};
document.getElementById('assetCollidable').onchange = (e) => {
  current.collidable = e.target.checked;
};

document.getElementById('btnNewAsset').onclick = () => {
  current = readFormNewAsset();
  selectedLibId = null;
  dirty = true;
  layerY = 0;
  document.getElementById('layerSlider').value = 0;
  document.getElementById('layerVal').textContent = '0';
  refreshModeUI();
};

document.getElementById('characterModel').onchange = () => {
  if (current.kind !== 'character') return;
  const next = createCharacterAsset({
    id: current.id,
    name: document.getElementById('assetName').value.trim() || current.name,
    model: document.getElementById('characterModel').value,
    collidable: document.getElementById('assetCollidable').checked
  });
  next.createdAt = current.createdAt;
  current = next;
  viewStats = null;
  dirty = true;
  rebuildCharacterPreview();
};

document.getElementById('btnReseed').onclick = () => {
  if (current.kind !== 'voxel') return;
  current.name = document.getElementById('assetName').value.trim() || current.name || 'unnamed';
  seedVoxelStarter(current, { hint: current.name, force: true });
  dirty = true;
  refreshModeUI();
};

document.getElementById('btnResizeVoxel').onclick = () => {
  const x = +document.getElementById('vx').value;
  const y = +document.getElementById('vy').value;
  const z = +document.getElementById('vz').value;
  current.voxel.size = [x, y, z];
  current.voxel.voxels = current.voxel.voxels.filter(v => v.x < x && v.y < y && v.z < z);
  document.getElementById('layerSlider').max = y - 1;
  layerY = Math.min(layerY, y - 1);
  document.getElementById('layerVal').textContent = layerY;
  markDirty();
  rebuildVoxelPreview();
};
document.getElementById('btnResizeSprite').onclick = () => {
  const w = +document.getElementById('sw').value;
  const h = +document.getElementById('sh').value;
  const old = current.sprite;
  const px = new Array(w * h).fill('');
  for (let y = 0; y < Math.min(h, old.h); y++) {
    for (let x = 0; x < Math.min(w, old.w); x++) px[y * w + x] = old.pixels[y * old.w + x] || '';
  }
  current.sprite = { w, h, pixels: px };
  markDirty();
  rebuildSpriteGrid();
  rebuildSpritePreview();
};
document.getElementById('layerSlider').oninput = (e) => {
  layerY = +e.target.value;
  document.getElementById('layerVal').textContent = layerY;
  rebuildVoxelPreview();
};

function refreshLibraryList() {
  const lib = gfLoadLibrary();
  document.getElementById('libCount').textContent = lib.assets.length;
  const el = document.getElementById('assetList');
  el.replaceChildren();
  lib.assets.forEach(a => {
    const item = document.createElement('div');
    item.className = 'asset-item' + (a.id === selectedLibId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = a.name || '(unnamed)';
    const kind = document.createElement('span');
    kind.className = 'kind-tag';
    kind.textContent = a.kind;
    item.append(name, kind);
    item.onclick = () => loadAsset(a);
    el.appendChild(item);
  });
}

async function pushAsset(asset) {
  gfUpsertAsset(asset);
  if (!remote) return;
  const data = await live.saveAsset(asset);
  live.noteRevision(data.revision);
}

let scanStream = null;
const scanVideo = document.getElementById('scanVideo');
const scanPreview = document.getElementById('scanPreview');

function showScanStill(dataUrl) {
  if (!dataUrl) {
    scanPreview.style.display = 'none';
    scanPreview.removeAttribute('src');
    return;
  }
  scanPreview.src = dataUrl;
  scanPreview.style.display = 'block';
}

document.getElementById('btnCamera').onclick = async () => {
  const button = document.getElementById('btnCamera');
  const hint = document.getElementById('scanHint');
  if (scanStream) {
    scanStream.getTracks().forEach(track => track.stop());
    scanStream = null;
    scanVideo.srcObject = null;
    scanVideo.style.display = 'none';
    button.textContent = 'Start webcam';
    document.getElementById('btnCapture').disabled = true;
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    hint.textContent = 'This browser has no webcam API. Open the site in Chrome or Safari over HTTPS.';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    scanVideo.srcObject = scanStream;
    scanVideo.style.display = 'block';
    button.textContent = 'Stop webcam';
    document.getElementById('btnCapture').disabled = false;
    hint.textContent = 'Webcam is live. Capture saves a reference photo on this asset.';
  } catch (err) {
    hint.textContent = 'Camera permission was blocked. Allow the camera for this site and try again. ' + (err && err.message ? err.message : '');
  }
};

document.getElementById('btnCapture').onclick = () => {
  if (!scanVideo.videoWidth) return;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 960 / scanVideo.videoWidth);
  canvas.width = Math.round(scanVideo.videoWidth * scale);
  canvas.height = Math.round(scanVideo.videoHeight * scale);
  canvas.getContext('2d').drawImage(scanVideo, 0, 0, canvas.width, canvas.height);
  current.scan = { image: canvas.toDataURL('image/jpeg', 0.82), capturedAt: Date.now(), width: canvas.width, height: canvas.height };
  showScanStill(current.scan.image);
  markDirty();
  document.getElementById('scanHint').textContent = 'Captured ' + canvas.width + '×' + canvas.height + '. Save to library keeps this reference on the asset.';
};

document.getElementById('btnSave').onclick = async () => {
  current.name = document.getElementById('assetName').value.trim() || 'unnamed';
  current.collidable = document.getElementById('assetCollidable').checked;
  const errs = gfValidateAsset(current);
  if (errs.length) { alert('Cannot save: ' + errs.join(', ')); return; }
  try {
    await pushAsset(current);
    dirty = false;
    selectedLibId = current.id;
    refreshLibraryList();
    setStatus(remote ? 'Live' : 'Local only');
  } catch (err) {
    alert('Saved locally. Server rejected it: ' + err.message);
    setStatus('Local only');
    remote = false;
  }
};

document.getElementById('btnDelete').onclick = async () => {
  if (!selectedLibId) { alert('Select an asset from the library first.'); return; }
  gfDeleteAsset(selectedLibId);
  if (remote) {
    try { await live.deleteAsset(selectedLibId); }
    catch (err) { remote = false; setStatus('Local only'); }
  }
  selectedLibId = null;
  refreshLibraryList();
};

document.getElementById('btnDuplicate').onclick = async () => {
  if (!selectedLibId) { alert('Select an asset from the library first.'); return; }
  const clone = JSON.parse(JSON.stringify(current));
  clone.id = gfNewId();
  clone.name = clone.name + ' copy';
  clone.createdAt = Date.now();
  await pushAsset(clone);
  refreshLibraryList();
};

document.getElementById('btnExportAll').onclick = () => {
  gfDownloadJSON(gfLoadLibrary(), 'gameforge-library.json');
};
document.getElementById('btnImport').onclick = () => document.getElementById('fileImport').click();
document.getElementById('fileImport').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await gfReadFileAsJSON(file);
  const lib = gfLoadLibrary();
  const incoming = data.assets ? data.assets : [data];
  incoming.forEach(a => {
    if (!a.id) a.id = gfNewId();
    const idx = lib.assets.findIndex(x => x.id === a.id);
    if (idx >= 0) lib.assets[idx] = a;
    else lib.assets.push(a);
  });
  gfSaveLibrary(lib);
  if (remote) {
    try { await live.putLibrary(lib); }
    catch (err) { remote = false; setStatus('Local only'); }
  }
  refreshLibraryList();
  e.target.value = '';
};

function applyRemoteLibrary(library) {
  const previous = gfLoadLibrary();
  const prevJson = new Map(previous.assets.map(a => [a.id, JSON.stringify(a)]));
  gfSaveLibrary(library);
  const changed = library.assets.filter(a => prevJson.get(a.id) !== JSON.stringify(a));
  const added = library.assets.filter(a => !prevJson.has(a.id));
  refreshLibraryList();

  const nameInField = document.getElementById('assetName').value.trim();
  const localPaint = current.kind === 'character'
    ? false
    : current.kind === 'voxel'
      ? current.voxel.voxels.length > 0
      : current.sprite.pixels.some(Boolean);

  if (selectedLibId) {
    const updated = library.assets.find(a => a.id === selectedLibId);
    if (updated && prevJson.get(updated.id) !== JSON.stringify(updated)) {
      loadAsset(updated);
      return;
    }
  }

  const byName = nameInField && changed.find(a => a.name === nameInField);
  if (byName && (!dirty || !localPaint)) {
    loadAsset(byName);
    return;
  }

  if (dirty && localPaint) return;

  const candidates = [...added, ...changed].filter(a => {
    if (a.kind === 'character') return true;
    if (a.kind === 'voxel') return a.voxel.voxels.length > 0;
    return a.sprite && a.sprite.pixels.some(Boolean);
  });
  if (candidates.length) loadAsset(candidates[candidates.length - 1]);
}

async function poll() {
  if (!remote) return;
  try {
    const data = await live.state();
    if (data.revision == null || data.revision === seenRevision) return;
    seenRevision = data.revision;
    if (data.library) applyRemoteLibrary(data.library);
  } catch (err) {
    remote = false;
    setStatus('Local only');
  }
}

async function boot() {
  updateMeshStatsUI();
  refreshModeUI();
  refreshLibraryList();
  try {
    const data = await live.state();
    remote = true;
    setStatus('Live');
    seenRevision = data.revision;
    if (data.library) applyRemoteLibrary(data.library);
    const untouched = current.kind === 'voxel' && !dirty && !document.getElementById('assetName').value.trim() && current.voxel.voxels.length === 0;
    if (untouched && data.library && data.library.assets.length) loadAsset(data.library.assets[data.library.assets.length - 1]);
    setInterval(poll, 1000);
  } catch (err) {
    remote = false;
    setStatus('Local only');
  }
}
boot();

window.gameforge = {
  get current() { return current; },
  get library() { return gfLoadLibrary(); },
  paintVoxelAt,
  save: () => document.getElementById('btnSave').click()
};
