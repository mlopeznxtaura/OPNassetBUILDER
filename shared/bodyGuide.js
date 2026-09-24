const NAMES = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28
};

const REQUIRED = Object.keys(NAMES);

export const GUIDE_BOX = { x: 0.16, y: 0.03, w: 0.68, h: 0.94 };

export function bodyFit(landmarks, box = GUIDE_BOX) {
  if (!landmarks || !landmarks.length) return { ready: false, found: 0, missing: REQUIRED.slice() };
  const missing = [];
  let found = 0;
  for (const name of REQUIRED) {
    const point = landmarks[NAMES[name]];
    const visible = point && (point.visibility == null || point.visibility > 0.45);
    const inside = visible && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    if (!inside) missing.push(name);
    else found++;
  }
  return { ready: missing.length === 0, found, missing };
}

export function guidePolylines(width, height, box = GUIDE_BOX) {
  const x = box.x * width;
  const y = box.y * height;
  const w = box.w * width;
  const h = box.h * height;
  const cx = x + w / 2;
  const headR = w * 0.16;
  const headY = y + headR + h * 0.02;
  const shoulderY = headY + headR + h * 0.06;
  const hipY = y + h * 0.58;
  const footY = y + h * 0.96;
  return [
    ellipsePoints(cx, headY, headR, headR * 1.15, 20),
    [[cx - w * 0.28, shoulderY], [cx + w * 0.28, shoulderY]],
    [[cx - w * 0.22, shoulderY], [cx - w * 0.16, hipY], [cx + w * 0.16, hipY], [cx + w * 0.22, shoulderY]],
    [[cx - w * 0.1, hipY], [cx - w * 0.14, footY]],
    [[cx + w * 0.1, hipY], [cx + w * 0.14, footY]],
    [[cx - w * 0.28, shoulderY], [cx - w * 0.42, shoulderY + h * 0.22]],
    [[cx + w * 0.28, shoulderY], [cx + w * 0.42, shoulderY + h * 0.22]]
  ];
}

function ellipsePoints(cx, cy, rx, ry, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
];

/** Approximate facing angle from shoulder line (radians, image-normalized x/z). */
export function bodyYawFromLandmarks(landmarks) {
  if (!landmarks || landmarks.length < 13) return null;
  const left = landmarks[NAMES.leftShoulder];
  const right = landmarks[NAMES.rightShoulder];
  if (!left || !right) return null;
  const dx = right.x - left.x;
  const dz = (right.z || 0) - (left.z || 0);
  if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return null;
  return Math.atan2(dz, dx);
}

export function skeletonSegments(landmarks, width, height) {
  if (!landmarks) return [];
  return BONES.map(([a, b]) => {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q) return null;
    return [[p.x * width, p.y * height], [q.x * width, q.y * height]];
  }).filter(Boolean);
}
