function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function project(point, angle, width, height) {
  const dist = 2.5;
  const targetY = 0.95;
  const cam = [Math.sin(angle) * dist, targetY, Math.cos(angle) * dist];
  const forward = [-cam[0], targetY - cam[1], -cam[2]];
  const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  forward[0] /= fl; forward[1] /= fl; forward[2] /= fl;
  const up = [0, 1, 0];
  let right = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0]
  ];
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right = right.map(v => v / rl);
  const camUp = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  const rel = [point[0] - cam[0], point[1] - cam[1], point[2] - cam[2]];
  const z = rel[0] * forward[0] + rel[1] * forward[1] + rel[2] * forward[2];
  if (z < 0.2) return null;
  const x = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
  const y = rel[0] * camUp[0] + rel[1] * camUp[1] + rel[2] * camUp[2];
  const focal = (height * 0.5) / Math.tan(0.45);
  return {
    u: width * 0.5 + (x / z) * focal,
    v: height * 0.5 - (y / z) * focal,
    facing: z
  };
}

export function visualHull(frames, { size = [24, 40, 24] } = {}) {
  const [nx, ny, nz] = size;
  const voxels = [];
  if (!frames.length) return { size, voxels };
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const point = [
          (x + 0.5) / nx * 0.9 - 0.45,
          (y + 0.5) / ny * 1.9,
          (z + 0.5) / nz * 0.9 - 0.45
        ];
        let seen = 0;
        let carved = false;
        let best = null;
        for (const frame of frames) {
          const hit = project(point, frame.angle, frame.width, frame.height);
          if (!hit || hit.u < 1 || hit.v < 1 || hit.u >= frame.width - 1 || hit.v >= frame.height - 1) continue;
          const px = Math.floor(hit.u);
          const py = Math.floor(hit.v);
          const person = frame.mask[py * frame.width + px] > 128;
          seen++;
          if (!person) {
            carved = true;
            break;
          }
          if (!best || hit.facing < best.facing) {
            const i = (py * frame.width + px) * 4;
            best = { facing: hit.facing, r: frame.color[i], g: frame.color[i + 1], b: frame.color[i + 2] };
          }
        }
        if (!carved && seen >= Math.min(3, frames.length) && best) {
          const hex = '#' + [best.r, best.g, best.b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
          voxels.push({ x, y, z, c: hex });
        }
      }
    }
  }
  return { size, voxels };
}
