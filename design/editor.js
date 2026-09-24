import { createLiveClient } from '../shared/liveClient.js';
import { bodyFit, bodyYawFromLandmarks, guidePolylines, skeletonSegments } from '../shared/bodyGuide.js';
import { captureJpegFromVideo, downloadScanZip, pickBestScanFrame } from '../shared/scanCapture.js';
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
let characterLoadError = '';

function updateCharacterMeshInfo() {
  const el = document.getElementById('characterMeshInfo');
  if (!el) return;
  if (current.kind !== 'character') {
    el.textContent = '';
    return;
  }
  const src = (current.character && current.character.src) || '—';
  const preset = (current.character && current.character.model) || '—';
  const err = characterLoadError ? ' · load error' : '';
  el.textContent = 'Preset: ' + preset + ' · Mesh: ' + src + err;
}

function formatMeshStats(asset) {
  if (asset && asset.kind === 'character') {
    const mesh = viewStats || (asset.character && asset.character.stats) || {};
    const pending = !viewStats && !characterLoadError;
    const src = (asset.character && asset.character.src) || '—';
    const lines = [
      'Mesh ' + src + ' · preset ' + (asset.character.model || 'character')
    ];
    if (characterLoadError) lines.push(characterLoadError);
    else if (pending) lines.push('Loading skinned mesh…');
    else {
      lines.push((mesh.vertices || 0).toLocaleString() + ' vertices');
      lines.push((mesh.triangles || 0).toLocaleString() + ' triangles · ' + (mesh.materials || 0) + ' materials · ' + (mesh.bones || 0) + ' bones');
    }
    if (asset.scan && asset.scan.frameCount) {
      lines.push('Scan reference · ' + asset.scan.frameCount + ' frames captured (ZIP export on device)');
    }
    return {
      lines,
      toolbar: characterLoadError ? 'Mesh load failed' : pending ? 'Loading character…' : `${(mesh.triangles || 0).toLocaleString()} tris · ${mesh.bones || 0} bones`
    };
  }
  if (!asset || asset.kind !== 'voxel') {
    if (asset && asset.kind === 'sprite') {
      const opaque = asset.sprite.pixels.filter(Boolean).length;
      return { lines: [opaque + ' painted pixels', asset.sprite.w + '×' + asset.sprite.h + ' sprite'], toolbar: `${opaque} px · ${asset.sprite.w}×${asset.sprite.h}` };
    }
    return { lines: ['No mesh yet'], toolbar: '' };
  }
  const mesh = computeVoxelMeshStats(asset);
  const [gx, gy, gz] = mesh.grid || asset.voxel.size;
  if (!mesh.voxelCount) {
    return {
      lines: [
        '0 solid voxels',
        'Grid ' + gx + '×' + gy + '×' + gz + ' (wireframe shown)',
        'Enable starter mesh or paint voxels / upsert_asset or paint_voxels.'
      ],
      toolbar: `0 voxels · grid ${gx}×${gy}×${gz}`
    };
  }
  return {
    lines: [
      mesh.voxelCount + ' solid voxels',
      mesh.triangles.toLocaleString() + ' triangles · ' + mesh.vertices.toLocaleString() + ' quad corners',
      mesh.faces.toLocaleString() + ' exposed faces · grid ' + gx + '×' + gy + '×' + gz
    ],
    toolbar: `${mesh.voxelCount} voxels · ${mesh.triangles.toLocaleString()} tris`
  };
}

function updateMeshStatsUI() {
  const { lines, toolbar } = formatMeshStats(current);
  const panel = document.getElementById('meshStats');
  panel.replaceChildren();
  lines.forEach(l => {
    const row = document.createElement('div');
    row.textContent = l;
    panel.appendChild(row);
  });
  document.getElementById('toolbarStats').textContent = toolbar;
  updateCharacterMeshInfo();
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
  characterLoadError = '';
  updateMeshStatsUI();
  clearGroup(voxelHelperGroup);
  const src = (current.character && current.character.src) || '/assets/female-hero.gltf';
  if (!THREE.GLTFLoader) {
    characterLoadError = 'GLTFLoader unavailable';
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
    if (typeof gfAlignObjectToGround === 'function') gfAlignObjectToGround(gltf.scene);
    group.add(gltf.scene);
    viewStats = inspectCharacter(gltf.scene);
    controls.target.set(0, 0.95, 0);
    camera.position.set(1.35, 1.25, 1.9);
    updateMeshStatsUI();
  }, undefined, () => {
    if (token !== characterToken) return;
    characterLoadError = 'Could not load ' + src;
    viewStats = current.character && current.character.stats ? current.character.stats : null;
    updateMeshStatsUI();
  });
}

function modelForName(name) {
  const n = String(name || '').toLowerCase();
  if (/\bmale\b|\bman\b|\bboy\b/.test(n) && !/female|woman|girl/.test(n)) return 'male-hero';
  if (/female|woman|girl|heroine/.test(n)) return 'female-hero';
  return document.getElementById('characterModel').value || 'female-hero';
}

function readFormNewAsset() {
  const name = document.getElementById('assetName').value.trim() || 'unnamed';
  const kind = document.getElementById('assetKind').value;
  const collidable = document.getElementById('assetCollidable').checked;
  const useStarter = document.getElementById('seedStarter').checked;
  if (kind === 'character') {
    const model = modelForName(name);
    document.getElementById('characterModel').value = model;
    return createCharacterAsset({ name, model, collidable });
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
  else if (e.target.value === 'character') {
    const model = modelForName(name);
    document.getElementById('characterModel').value = model;
    current = createCharacterAsset({ name, model });
  }
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
    const row = document.createElement('div');
    row.className = 'asset-item-row';
    const name = document.createElement('span');
    name.textContent = a.name || '(unnamed)';
    const kind = document.createElement('span');
    kind.className = 'kind-tag';
    kind.textContent = a.kind;
    row.append(name, kind);
    item.appendChild(row);
    if (a.kind === 'character' && a.character && a.character.src) {
      const sub = document.createElement('div');
      sub.className = 'mesh-src';
      sub.textContent = a.character.src;
      item.appendChild(sub);
    }
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
let poseLoop = 0;
let poseBusy = false;
let bodyReady = false;
let lastPoseLandmarks = null;
let scan360Timer = null;
let scan360CaptureTimer = null;
/** @type {{ frames: object[], active: boolean }} */
const scanSession = { frames: [], active: false };
const SCAN_DEVICE_KEY = 'opn_scan_camera_device';
const scanVideo = document.getElementById('scanVideo');
const scanPreview = document.getElementById('scanPreview');
const scanStage = document.getElementById('scanStage');
const scanGuide = document.getElementById('scanGuide');
const guideCtx = scanGuide.getContext('2d');

function drawPolyline(points, color, width) {
  if (!points.length) return;
  guideCtx.beginPath();
  guideCtx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) guideCtx.lineTo(points[i][0], points[i][1]);
  guideCtx.strokeStyle = color;
  guideCtx.lineWidth = width;
  guideCtx.stroke();
}

function paintGuide(landmarks) {
  const width = scanGuide.width;
  const height = scanGuide.height;
  guideCtx.clearRect(0, 0, width, height);
  const fit = bodyFit(landmarks);
  bodyReady = fit.ready;
  const color = fit.ready ? '#3dde7a' : '#e0b15c';
  guideCtx.lineCap = 'round';
  guideCtx.lineJoin = 'round';
  for (const line of guidePolylines(width, height)) drawPolyline(line, color, 3);
  guideCtx.setLineDash([5, 6]);
  drawPolyline([[width * 0.16, height * 0.03], [width * 0.84, height * 0.03], [width * 0.84, height * 0.97], [width * 0.16, height * 0.97], [width * 0.16, height * 0.03]], color, 2);
  guideCtx.setLineDash([]);
  for (const segment of skeletonSegments(landmarks, width, height)) drawPolyline(segment, fit.ready ? '#7dffb0' : '#ffd27a', 4);
  document.getElementById('btnScan360').disabled = !fit.ready;
  const hint = document.getElementById('scanHint');
  if (fit.ready) hint.textContent = 'Whole body is in the green guide. Hold still, then turn slowly for Scan 360.';
  else if (fit.found) hint.textContent = 'Step back until head, hands, and both feet sit inside the guide. Still outside: ' + fit.missing.slice(0, 3).join(', ') + '.';
  else hint.textContent = 'Stand in view so the guide can see your whole body.';
}

let poseDetector = null;
function ensurePose() {
  if (poseDetector || !window.Pose) return poseDetector;
  poseDetector = new window.Pose({
    locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + file
  });
  poseDetector.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  poseDetector.onResults((results) => {
    lastPoseLandmarks = results.poseLandmarks || null;
    paintGuide(lastPoseLandmarks);
  });
  return poseDetector;
}

function stopScan360Timers() {
  if (scan360Timer) {
    clearInterval(scan360Timer);
    scan360Timer = null;
  }
  if (scan360CaptureTimer) {
    clearInterval(scan360CaptureTimer);
    scan360CaptureTimer = null;
  }
  scanSession.active = false;
  document.getElementById('btnScan360').disabled = !bodyReady;
}

function updateExportScanButton() {
  const btn = document.getElementById('btnExportScan');
  if (!btn) return;
  btn.disabled = scanSession.frames.length === 0;
}

function applyScanSessionToAsset() {
  if (!scanSession.frames.length) return;
  const best = pickBestScanFrame(scanSession.frames);
  if (!best) return;
  current.scan = {
    image: best.image,
    capturedAt: best.capturedAt || Date.now(),
    width: best.width,
    height: best.height,
    frameCount: scanSession.frames.filter(f => f.valid !== false).length
  };
  showScanStill(current.scan.image);
  markDirty();
  updateMeshStatsUI();
}

async function refreshCameraDeviceList() {
  const select = document.getElementById('scanCamera');
  if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter(d => d.kind === 'videoinput');
  const saved = sessionStorage.getItem(SCAN_DEVICE_KEY) || '';
  select.replaceChildren();
  const def = document.createElement('option');
  def.value = '';
  def.textContent = videos.length ? 'Default camera' : 'No camera found';
  select.appendChild(def);
  videos.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || ('Camera ' + (i + 1));
    select.appendChild(opt);
  });
  select.disabled = !videos.length;
  if (saved && videos.some(d => d.deviceId === saved)) select.value = saved;
}

function videoConstraints() {
  const select = document.getElementById('scanCamera');
  const deviceId = select && select.value;
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  return { audio: false, video };
}

async function startScanStream() {
  const hint = document.getElementById('scanHint');
  scanStream = await navigator.mediaDevices.getUserMedia(videoConstraints());
  scanVideo.srcObject = scanStream;
  scanStage.classList.add('live');
  document.getElementById('btnCamera').textContent = 'Stop webcam';
  document.getElementById('btnCapture').disabled = false;
  await refreshCameraDeviceList();
  hint.textContent = 'Finding your body. Step back until the guide turns green.';
  const tick = () => {
    trackBody();
    poseLoop = requestAnimationFrame(tick);
  };
  poseLoop = requestAnimationFrame(tick);
}

async function trackBody() {
  if (!scanStream || poseBusy) return;
  if (!scanVideo.videoWidth) return;
  const pose = ensurePose();
  if (!pose) {
    paintGuide(null);
    return;
  }
  if (scanGuide.width !== scanVideo.videoWidth) {
    scanGuide.width = scanVideo.videoWidth;
    scanGuide.height = scanVideo.videoHeight;
  }
  poseBusy = true;
  try { await pose.send({ image: scanVideo }); }
  catch (err) { paintGuide(null); }
  poseBusy = false;
}

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
    stopScan360Timers();
    scanStream.getTracks().forEach(track => track.stop());
    scanStream = null;
    scanVideo.srcObject = null;
    cancelAnimationFrame(poseLoop);
    poseLoop = 0;
    scanStage.classList.remove('live');
    guideCtx.clearRect(0, 0, scanGuide.width, scanGuide.height);
    button.textContent = 'Start webcam';
    document.getElementById('btnCapture').disabled = true;
    document.getElementById('btnScan360').disabled = true;
    document.getElementById('scanCamera').disabled = true;
    bodyReady = false;
    lastPoseLandmarks = null;
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    hint.textContent = 'This browser has no webcam API. Open the site in Chrome or Safari over HTTPS.';
    return;
  }
  try {
    await startScanStream();
  } catch (err) {
    hint.textContent = 'Camera permission was blocked. Allow the camera for this site and try again. ' + (err && err.message ? err.message : '');
  }
};

document.getElementById('scanCamera').onchange = async () => {
  const select = document.getElementById('scanCamera');
  if (!select || !scanStream) return;
  sessionStorage.setItem(SCAN_DEVICE_KEY, select.value || '');
  const hint = document.getElementById('scanHint');
  stopScan360Timers();
  scanStream.getTracks().forEach(track => track.stop());
  scanStream = null;
  cancelAnimationFrame(poseLoop);
  poseLoop = 0;
  try {
    await startScanStream();
  } catch (err) {
    hint.textContent = 'Could not switch camera. ' + (err && err.message ? err.message : '');
  }
};

document.getElementById('btnScan360').onclick = () => {
  if (!bodyReady || !scanStream || scanSession.active) return;
  const hint = document.getElementById('scanHint');
  const btn = document.getElementById('btnScan360');
  scanSession.frames = [];
  scanSession.active = true;
  updateExportScanButton();
  btn.disabled = true;
  let left = 12;
  const targetFrames = 16;
  const captureFrame = () => {
    if (!scanStream || !scanSession.active) return;
    const ready = bodyReady;
    const shot = captureJpegFromVideo(scanVideo);
    if (!shot) return;
    const yaw = bodyYawFromLandmarks(lastPoseLandmarks);
    scanSession.frames.push({
      ...shot,
      t: Date.now(),
      yaw,
      valid: ready
    });
    const validCount = scanSession.frames.filter(f => f.valid !== false).length;
    hint.textContent = 'Turn slowly. Frames ' + validCount + '/' + targetFrames + ' · ' + left + 's left' + (ready ? '' : ' (paused — stay in guide)');
    updateExportScanButton();
  };
  captureFrame();
  scan360CaptureTimer = setInterval(captureFrame, 750);
  hint.textContent = 'Turn slowly through one full circle. Stay inside the green guide. ' + left + 's';
  scan360Timer = setInterval(() => {
    left -= 1;
    if (!scanStream || left <= 0) {
      stopScan360Timers();
      const validCount = scanSession.frames.filter(f => f.valid !== false).length;
      if (scanStream) {
        if (validCount >= 4) {
          applyScanSessionToAsset();
          hint.textContent = 'Captured ' + validCount + ' frames. Save stores a reference image + count. Export scan ZIP for photogrammetry tools.';
        } else {
          hint.textContent = 'Only ' + validCount + ' good frames. Step back, stay green, and try Scan 360 again.';
        }
      }
      document.getElementById('btnScan360').disabled = !bodyReady;
      updateExportScanButton();
      return;
    }
    const validCount = scanSession.frames.filter(f => f.valid !== false).length;
    hint.textContent = 'Turn slowly. Frames ' + validCount + '/' + targetFrames + ' · ' + left + 's';
  }, 1000);
};

document.getElementById('btnExportScan').onclick = async () => {
  if (!scanSession.frames.length) return;
  const name = document.getElementById('assetName').value.trim() || current.name || 'scan';
  try {
    await downloadScanZip(name, scanSession.frames);
    document.getElementById('scanHint').textContent = 'Downloaded ZIP with ' + scanSession.frames.length + ' frames + manifest.json.';
  } catch (err) {
    document.getElementById('scanHint').textContent = 'ZIP export failed. ' + (err && err.message ? err.message : '');
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

function scanForPersistence(scan) {
  if (!scan || typeof scan !== 'object') return scan;
  const { image, capturedAt, width, height, frameCount } = scan;
  if (!image) return undefined;
  return { image, capturedAt, width, height, frameCount: frameCount || 0 };
}

document.getElementById('btnSave').onclick = async () => {
  current.name = document.getElementById('assetName').value.trim() || 'unnamed';
  current.collidable = document.getElementById('assetCollidable').checked;
  if (current.scan) current.scan = scanForPersistence(current.scan);
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
