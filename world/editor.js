import { createLiveClient } from '../shared/liveClient.js';
import { collidesAt, gfNewId } from '../shared/forgeCore.js';

const STORAGE_KEY = 'gameforge_assets_v1';
const LEVEL_KEY = 'gameforge_level_v1';
const live = createLiveClient();
let remote = false;
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
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = text;
}

const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 30, 140);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(10, 6, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const orbit = new THREE.OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1, 0);
const flyControls = new THREE.PointerLockControls(camera, renderer.domElement);
let flyMode = false;

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x445533, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
sun.position.set(40, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

let groundSize = 60;
let groundMesh;
let groundGrid;
function buildGround() {
  if (groundMesh) scene.remove(groundMesh);
  if (groundGrid) scene.remove(groundGrid);
  const geo = new THREE.PlaneGeometry(groundSize, groundSize, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4c7a3c });
  groundMesh = new THREE.Mesh(geo, mat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  groundMesh.userData.isGround = true;
  scene.add(groundMesh);
  groundGrid = new THREE.GridHelper(groundSize, Math.max(2, groundSize / 2), 0x2c4a22, 0x2c4a22);
  groundGrid.material.opacity = 0.25;
  groundGrid.material.transparent = true;
  groundGrid.position.y = 0.01;
  scene.add(groundGrid);
}
buildGround();

function resize() {
  const w = viewport.clientWidth;
  const h = Math.max(viewport.clientHeight, 1);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(viewport);
resize();

let library = gfLoadLibrary();
let armedAssetId = null;
let placements = [];
let selectedPlacement = null;

function refreshAssetList() {
  const el = document.getElementById('assetList');
  el.replaceChildren();
  library.assets.forEach(a => {
    const item = document.createElement('div');
    item.className = 'asset-item' + (a.id === armedAssetId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = a.name || '(unnamed)';
    const kind = document.createElement('span');
    kind.className = 'kind-tag';
    kind.textContent = a.kind;
    item.append(name, kind);
    item.onclick = () => {
      armedAssetId = a.id;
      document.getElementById('armedLabel').textContent = a.name;
      refreshAssetList();
    };
    el.appendChild(item);
  });
}
refreshAssetList();

function levelSnapshot() {
  return {
    version: 1,
    ground: { size: groundSize },
    placements: placements.map(p => ({ assetId: p.assetId, x: p.x, y: p.y, z: p.z, ry: p.ry, scale: p.scale, id: p.id }))
  };
}

function addPlacement(assetId, x, z, ry = 0, scale = 1, id = gfNewId()) {
  const asset = library.assets.find(a => a.id === assetId);
  if (!asset) return null;
  const obj = gfBuildAssetMesh(asset);
  obj.position.set(x, 0, z);
  obj.rotation.y = ry;
  obj.scale.setScalar(scale);
  scene.add(obj);
  const p = { id, assetId, x, y: 0, z, ry, scale, object3d: obj, collidable: !!asset.collidable };
  placements.push(p);
  document.getElementById('placementCount').textContent = placements.length;
  return p;
}

function removePlacement(p) {
  scene.remove(p.object3d);
  placements = placements.filter(x => x !== p);
  document.getElementById('placementCount').textContent = placements.length;
}

function clearAllPlacements() {
  placements.forEach(p => scene.remove(p.object3d));
  placements = [];
  selectedPlacement = null;
  document.getElementById('placementCount').textContent = 0;
}

function applyLevel(level) {
  clearAllPlacements();
  groundSize = (level.ground && level.ground.size) || groundSize;
  document.getElementById('groundSize').value = groundSize;
  buildGround();
  (level.placements || []).forEach(p => addPlacement(p.assetId, p.x, p.z, p.ry, p.scale, p.id));
  localStorage.setItem(LEVEL_KEY, JSON.stringify(levelSnapshot()));
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', async (e) => {
  if (flyMode) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const objs = placements.map(p => p.object3d);
  const hits = raycaster.intersectObjects(objs, true);
  if (hits.length) {
    let root = hits[0].object;
    while (root.parent && !placements.find(p => p.object3d === root)) root = root.parent;
    selectedPlacement = placements.find(p => p.object3d === root) || null;
    return;
  }
  if (!armedAssetId) return;
  const groundHits = raycaster.intersectObject(groundMesh);
  if (!groundHits.length) return;
  const pt = groundHits[0].point;
  const placed = addPlacement(armedAssetId, pt.x, pt.z);
  if (placed && remote) {
    try {
      const data = await live.place({ id: placed.id, assetId: placed.assetId, x: placed.x, y: 0, z: placed.z, ry: 0, scale: 1 });
      seenRevision = data.revision;
    } catch (err) {
      remote = false;
      setStatus('Local only');
    }
  }
});

document.getElementById('btnDeleteSelected').onclick = async () => {
  if (!selectedPlacement) return;
  const id = selectedPlacement.id;
  removePlacement(selectedPlacement);
  selectedPlacement = null;
  if (remote) {
    try { seenRevision = (await live.removePlacement(id)).revision; }
    catch (err) { remote = false; setStatus('Local only'); }
  }
};
document.getElementById('btnClearAll').onclick = async () => {
  if (!confirm('Clear all placements?')) return;
  clearAllPlacements();
  if (remote) {
    try { seenRevision = (await live.clearPlacements()).revision; }
    catch (err) { remote = false; setStatus('Local only'); }
  }
};

document.getElementById('btnApplyGround').onclick = async () => {
  groundSize = +document.getElementById('groundSize').value;
  buildGround();
  if (remote) {
    try { seenRevision = (await live.putLevel(levelSnapshot())).revision; }
    catch (err) { remote = false; setStatus('Local only'); }
  }
};
document.getElementById('btnLoadLib').onclick = async () => {
  if (remote) {
    try {
      const data = await live.state();
      seenRevision = data.revision;
      library = data.library;
      gfSaveLibrary(library);
      applyLevel(data.level);
      refreshAssetList();
      return;
    } catch (err) {
      remote = false;
      setStatus('Local only');
    }
  }
  library = gfLoadLibrary();
  refreshAssetList();
};
document.getElementById('btnImportLib').onclick = () => document.getElementById('fileImportLib').click();
document.getElementById('fileImportLib').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await gfReadFileAsJSON(file);
  library = data.assets ? data : { version: 1, assets: [data] };
  gfSaveLibrary(library);
  if (remote) {
    try { seenRevision = (await live.putLibrary(library)).revision; }
    catch (err) { remote = false; setStatus('Local only'); }
  }
  refreshAssetList();
  e.target.value = '';
};

document.getElementById('btnSaveLevel').onclick = () => {
  gfDownloadJSON(levelSnapshot(), 'gameforge-level.json');
};
document.getElementById('btnLoadLevel').onclick = () => document.getElementById('fileImportLevel').click();
document.getElementById('fileImportLevel').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const level = await gfReadFileAsJSON(file);
  applyLevel(level);
  if (remote) {
    try { seenRevision = (await live.putLevel(levelSnapshot())).revision; }
    catch (err) { remote = false; setStatus('Local only'); }
  }
  e.target.value = '';
};

const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.getElementById('btnFly').onclick = () => flyControls.lock();
flyControls.addEventListener('lock', () => {
  flyMode = true;
  orbit.enabled = false;
  document.getElementById('modeLabel').textContent = 'Fly';
  document.getElementById('crosshair').style.display = 'block';
});
flyControls.addEventListener('unlock', () => {
  flyMode = false;
  orbit.enabled = true;
  document.getElementById('modeLabel').textContent = 'Orbit';
  document.getElementById('crosshair').style.display = 'none';
});

const moveSpeed = 12;
const playerRadius = 0.5;
let lastT = performance.now();

function updateFly(dt) {
  if (!flyMode) return;
  const dir = new THREE.Vector3();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  if (keys['KeyW']) dir.add(forward);
  if (keys['KeyS']) dir.sub(forward);
  if (keys['KeyD']) dir.add(right);
  if (keys['KeyA']) dir.sub(right);
  if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(moveSpeed * dt);
  const pos = flyControls.getObject().position;
  const nx = pos.x + dir.x;
  const nz = pos.z + dir.z;
  const half = groundSize / 2 - 0.5;
  const clampedX = Math.max(-half, Math.min(half, nx));
  const clampedZ = Math.max(-half, Math.min(half, nz));
  const level = { placements };
  if (!collidesAt(library, level, clampedX, pos.z, playerRadius).hit) pos.x = clampedX;
  if (!collidesAt(library, level, pos.x, clampedZ, playerRadius).hit) pos.z = clampedZ;
  pos.y = 1.7;
}

(function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (flyMode) updateFly(dt);
  else orbit.update();
  renderer.render(scene, camera);
})();

async function poll() {
  if (!remote) return;
  try {
    const data = await live.state();
    if (data.revision == null || data.revision === seenRevision) return;
    seenRevision = data.revision;
    library = data.library || library;
    gfSaveLibrary(library);
    refreshAssetList();
    if (data.level) applyLevel(data.level);
  } catch (err) {
    remote = false;
    setStatus('Local only');
  }
}

async function boot() {
  try {
    const saved = localStorage.getItem(LEVEL_KEY);
    if (saved) applyLevel(JSON.parse(saved));
  } catch (e) { /* ignore local level */ }
  try {
    const data = await live.state();
    remote = true;
    setStatus('Live');
    seenRevision = data.revision;
    library = data.library || library;
    gfSaveLibrary(library);
    refreshAssetList();
    if (data.level) applyLevel(data.level);
    setInterval(poll, 1000);
  } catch (err) {
    remote = false;
    setStatus('Local only');
  }
}
boot();
