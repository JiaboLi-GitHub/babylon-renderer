import {
  Color3,
  Constants,
  DynamicTexture,
  PBRMaterial,
  RawCubeTexture,
  Scene,
  Texture,
} from '@babylonjs/core';

interface CamMaterialPreset {
  label: string;
  albedoColor: readonly [number, number, number];
  metallic: number;
  roughness: number;
  environmentIntensity?: number;
  directIntensity?: number;
  specularIntensity?: number;
  clearCoatIntensity?: number;
  clearCoatRoughness?: number;
}

export const CAM_MATERIAL_PRESETS = {
  matteGray: {
    label: '哑光灰',
    albedoColor: [0.56, 0.6, 0.66],
    metallic: 0,
    roughness: 0.72,
    environmentIntensity: 0.5,
    directIntensity: 1.05,
    specularIntensity: 0.22,
  },
  aluminum: {
    label: '铝',
    albedoColor: [0.76, 0.78, 0.8],
    metallic: 0.68,
    roughness: 0.38,
    environmentIntensity: 0.72,
    directIntensity: 1.1,
    specularIntensity: 0.62,
  },
  steel: {
    label: '钢',
    albedoColor: [0.58, 0.6, 0.62],
    metallic: 1,
    roughness: 0.2,
    environmentIntensity: 1.18,
    directIntensity: 0.92,
    specularIntensity: 0.95,
  },
  graphite: {
    label: '石墨',
    albedoColor: [0.075, 0.085, 0.1],
    metallic: 0,
    roughness: 0.58,
    environmentIntensity: 0.46,
    directIntensity: 1.18,
    specularIntensity: 0.28,
    clearCoatIntensity: 0.14,
    clearCoatRoughness: 0.46,
  },
  brass: {
    label: '黄铜',
    albedoColor: [0.78, 0.56, 0.25],
    metallic: 0.62,
    roughness: 0.42,
    environmentIntensity: 0.66,
    directIntensity: 1.05,
    specularIntensity: 0.58,
  },
} as const satisfies Record<string, CamMaterialPreset>;

export type CamMaterialPresetKey = keyof typeof CAM_MATERIAL_PRESETS;

export const CAM_MATERIAL_PRESET_KEYS = Object.keys(CAM_MATERIAL_PRESETS) as CamMaterialPresetKey[];

export function getCamMaterialPresetLabel(key: CamMaterialPresetKey) {
  return CAM_MATERIAL_PRESETS[key].label;
}

function toColor3(color: readonly [number, number, number]) {
  return new Color3(color[0], color[1], color[2]);
}

interface SteelTextureSet {
  normal: DynamicTexture;
  orm: DynamicTexture;
}

const steelTextureCache = new WeakMap<Scene, SteelTextureSet>();
const camReflectionEnvironmentScenes = new WeakSet<Scene>();

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hash2d(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function softBox(u: number, v: number, cx: number, cy: number, wx: number, wy: number) {
  const dx = (u - cx) / wx;
  const dy = (v - cy) / wy;
  return Math.exp(-(dx * dx + dy * dy));
}

function createReflectionFace(
  size: number,
  top: readonly [number, number, number],
  bottom: readonly [number, number, number],
  accent: readonly [number, number, number],
) {
  const data = new Uint8Array(size * size * 3);

  for (let y = 0; y < size; y += 1) {
    const v = size === 1 ? 0 : y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = size === 1 ? 0 : x / (size - 1);
      const horizon = 0.12 * Math.exp(-((v - 0.55) ** 2) / 0.01);
      const broadSoftbox = softBox(u, v, 0.28, 0.24, 0.22, 0.12) * 0.58;
      const stripSoftbox = softBox(u, v, 0.72, 0.42, 0.12, 0.48) * 0.34;
      const shade = 0.84 + horizon + broadSoftbox + stripSoftbox;
      const offset = (y * size + x) * 3;

      for (let channel = 0; channel < 3; channel += 1) {
        const gradient = top[channel] * (1 - v) + bottom[channel] * v;
        const color = gradient * shade + accent[channel] * (broadSoftbox * 0.45 + stripSoftbox * 0.25);
        data[offset + channel] = Math.round(clamp01(color) * 255);
      }
    }
  }

  return data;
}

function ensureCamReflectionEnvironment(scene: Scene) {
  if (scene.environmentTexture || camReflectionEnvironmentScenes.has(scene)) {
    return;
  }

  const size = 32;
  const faceData = [
    createReflectionFace(size, [0.9, 0.94, 1], [0.36, 0.38, 0.4], [1, 1, 0.92]),
    createReflectionFace(size, [0.78, 0.82, 0.88], [0.28, 0.3, 0.33], [0.9, 0.96, 1]),
    createReflectionFace(size, [0.96, 0.98, 1], [0.46, 0.48, 0.52], [1, 1, 1]),
    createReflectionFace(size, [0.42, 0.43, 0.45], [0.18, 0.18, 0.2], [0.82, 0.86, 0.9]),
    createReflectionFace(size, [0.86, 0.9, 0.96], [0.34, 0.36, 0.4], [0.95, 0.98, 1]),
    createReflectionFace(size, [0.82, 0.82, 0.8], [0.3, 0.31, 0.34], [1, 0.94, 0.84]),
  ];
  const texture = new RawCubeTexture(
    scene,
    faceData,
    size,
    Constants.TEXTUREFORMAT_RGB,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );

  texture.name = 'camStudioReflectionEnvironment';
  texture.gammaSpace = true;
  texture.level = 0.82;
  scene.environmentTexture = texture;
  camReflectionEnvironmentScenes.add(scene);
}

function steelHeightAt(x: number, y: number) {
  const rowNoise = hash2d(0, y * 0.39) - 0.5;
  const fineGroove = Math.sin(y * 0.92 + rowNoise * 2.6) * 0.022;
  const broadGroove = Math.sin(y * 0.13 + hash2d(7, Math.floor(y / 6)) * 3.14) * 0.018;
  const scratch = hash2d(Math.floor(x * 0.22), Math.floor(y * 1.7)) > 0.985
    ? 0.04 * Math.sin(x * 0.65)
    : 0;
  const grain = (hash2d(x * 1.9, y * 0.27) - 0.5) * 0.012;

  return fineGroove + broadGroove + scratch + grain;
}

function createDynamicPixelTexture(
  scene: Scene,
  name: string,
  size: number,
  fillPixel: (x: number, y: number, data: Uint8ClampedArray, offset: number) => void,
) {
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const imageData = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      fillPixel(x, y, imageData.data, offset);
    }
  }

  context.putImageData(imageData, 0, 0);
  texture.update(false);
  texture.gammaSpace = false;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 8;
  texture.vScale = 18;

  return texture;
}

function getSteelTextures(scene: Scene) {
  const cachedTextures = steelTextureCache.get(scene);
  if (cachedTextures) {
    return cachedTextures;
  }

  const size = 256;
  const normal = createDynamicPixelTexture(scene, 'brushedSteelNormal', size, (x, y, data, offset) => {
    const strengthX = 1.8;
    const strengthY = 7.2;
    const dx = (steelHeightAt(x + 1, y) - steelHeightAt(x - 1, y)) * strengthX;
    const dy = (steelHeightAt(x, y + 1) - steelHeightAt(x, y - 1)) * strengthY;
    const length = Math.hypot(dx, dy, 1);
    const nx = -dx / length;
    const ny = -dy / length;
    const nz = 1 / length;

    data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
    data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    data[offset + 3] = 255;
  });

  const orm = createDynamicPixelTexture(scene, 'brushedSteelOrm', size, (x, y, data, offset) => {
    const groove = Math.abs(steelHeightAt(x, y));
    const fingerprint = softBox(x / size, y / size, 0.64, 0.56, 0.22, 0.16) * 0.035;
    const roughness = clamp01(0.17 + groove * 1.75 + fingerprint + (hash2d(x * 0.31, y * 0.47) - 0.5) * 0.025);
    const occlusion = clamp01(0.94 - groove * 0.85 - fingerprint * 1.8);

    data[offset] = Math.round(occlusion * 255);
    data[offset + 1] = Math.round(roughness * 255);
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  });

  normal.level = 0.07;

  const textures = { normal, orm };
  steelTextureCache.set(scene, textures);
  return textures;
}

function applySteelFinish(scene: Scene, material: PBRMaterial) {
  ensureCamReflectionEnvironment(scene);

  const textures = getSteelTextures(scene);
  material.bumpTexture = textures.normal;
  material.metallicTexture = textures.orm;
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.enableSpecularAntiAliasing = true;
  material.useHorizonOcclusion = true;
}

export function createCamMaterialPreset(
  scene: Scene,
  key: CamMaterialPresetKey,
  options: { name?: string } = {},
) {
  const preset: CamMaterialPreset = CAM_MATERIAL_PRESETS[key];
  const material = new PBRMaterial(options.name ?? `${key}Pbr`, scene);

  material.albedoColor = toColor3(preset.albedoColor);
  material.metallic = preset.metallic;
  material.roughness = preset.roughness;
  material.environmentIntensity = preset.environmentIntensity ?? 0.55;
  material.directIntensity = preset.directIntensity ?? 1;
  material.specularIntensity = preset.specularIntensity ?? 0.35;
  material.forceIrradianceInFragment = true;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;

  if (key === 'steel') {
    applySteelFinish(scene, material);
  }

  if (preset.clearCoatIntensity != null) {
    material.clearCoat.isEnabled = true;
    material.clearCoat.intensity = preset.clearCoatIntensity;
    material.clearCoat.roughness = preset.clearCoatRoughness ?? 0.35;
  }

  return material;
}
