export const CHARACTER_MODELS = {
  'female-hero': {
    id: 'female-hero',
    label: 'Female hero base',
    src: '/assets/female-hero.gltf',
    stats: {"vertices":2885,"triangles":4800,"materials":4,"bones":17}
  }
};

export function characterModel(id) {
  return CHARACTER_MODELS[id] || CHARACTER_MODELS['female-hero'];
}
