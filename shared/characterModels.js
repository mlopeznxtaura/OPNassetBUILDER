export const CHARACTER_MODELS = {
  "female-hero": {
    "id": "female-hero",
    "label": "Female hero base",
    "src": "/assets/female-hero.gltf",
    "stats": {
      "vertices": 924,
      "triangles": 1256,
      "materials": 4,
      "bones": 17
    }
  },
  "male-hero": {
    "id": "male-hero",
    "label": "Male hero base",
    "src": "/assets/male-hero.gltf",
    "stats": {
      "vertices": 924,
      "triangles": 1256,
      "materials": 4,
      "bones": 17
    }
  }
};

export function characterModel(id) {
  return CHARACTER_MODELS[id] || CHARACTER_MODELS['female-hero'];
}
