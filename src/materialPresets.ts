import {
  Color3,
  PBRMaterial,
  Scene,
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
    albedoColor: [0.42, 0.45, 0.49],
    metallic: 0.72,
    roughness: 0.32,
    environmentIntensity: 0.68,
    directIntensity: 1.05,
    specularIntensity: 0.7,
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

  if (preset.clearCoatIntensity != null) {
    material.clearCoat.isEnabled = true;
    material.clearCoat.intensity = preset.clearCoatIntensity;
    material.clearCoat.roughness = preset.clearCoatRoughness ?? 0.35;
  }

  return material;
}
