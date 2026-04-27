import {
  AbstractMesh,
  Color3,
  DynamicTexture,
  Mesh,
  PBRMaterial,
  Scene,
  Texture,
  VertexBuffer,
} from '@babylonjs/core';

export interface WalnutPbrMaterialOptions {
  name?: string;
  textureSize?: number;
  textureScale?: number;
  grainScale?: number;
  normalStrength?: number;
  clearCoatIntensity?: number;
}

interface WalnutSample {
  color: Color3;
  height: number;
  roughness: number;
  ambientOcclusion: number;
}

interface WalnutTextureSet {
  albedo: DynamicTexture;
  normal: DynamicTexture;
  orm: DynamicTexture;
}

const DEFAULT_TEXTURE_SIZE = 512;
const DEFAULT_TEXTURE_SCALE = 1.8;
const DEFAULT_GRAIN_SCALE = 1;
const DEFAULT_NORMAL_STRENGTH = 3.2;
const TWO_PI = Math.PI * 2;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixColor(a: Color3, b: Color3, t: number) {
  return new Color3(
    lerp(a.r, b.r, t),
    lerp(a.g, b.g, t),
    lerp(a.b, b.b, t),
  );
}

function hash2(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);

  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x: number, y: number, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.52;
    frequency *= 2.03;
  }

  return total > 0 ? value / total : value;
}

function walnutSample(u: number, v: number, grainScale: number): WalnutSample {
  const darkWalnut = new Color3(0.13, 0.065, 0.032);
  const baseWalnut = new Color3(0.34, 0.18, 0.085);
  const warmWalnut = new Color3(0.54, 0.32, 0.16);
  const amberLatewood = new Color3(0.72, 0.46, 0.23);

  const broadWarp = fbm(u * 2.2, v * 4.8);
  const fineWarp = fbm(u * 11.0 + 12.7, v * 2.2 + 4.1);
  const grainPosition = (
    u * 17.5 * grainScale +
    broadWarp * 4.6 +
    Math.sin(v * 8.0 + fineWarp * 2.4) * 0.72
  );
  const grainWave = 0.5 + 0.5 * Math.sin(grainPosition * TWO_PI);
  const fineGrain = fbm(u * 58.0 * grainScale, v * 9.5 + broadWarp * 2.0, 4);
  const pores = smoothstep(
    0.68,
    0.96,
    1 - Math.abs(Math.sin((u * 110.0 * grainScale + fineWarp * 4.0) * Math.PI)),
  ) * (0.45 + fineGrain * 0.55);
  const darkStreak = smoothstep(0.62, 0.92, grainWave) * smoothstep(0.46, 0.95, fineGrain);
  const honeyStreak = smoothstep(0.18, 0.52, grainWave) * (1 - darkStreak * 0.35);

  let knot = 0;
  const knots = [
    { x: 0.25, y: 0.32, rx: 0.12, ry: 0.22, strength: 0.45 },
    { x: 0.72, y: 0.76, rx: 0.10, ry: 0.19, strength: 0.38 },
  ];

  for (const item of knots) {
    const dx = (u - item.x) / item.rx;
    const dy = (v - item.y) / item.ry;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const swirl = 0.5 + 0.5 * Math.sin((distance * 2.2 - Math.atan2(dy, dx) * 0.45) * TWO_PI);
    knot += (1 - smoothstep(0.24, 1.0, distance)) * item.strength * (0.6 + swirl * 0.4);
  }
  knot = clamp(knot);

  let color = mixColor(darkWalnut, baseWalnut, smoothstep(0.05, 0.86, grainWave));
  color = mixColor(color, warmWalnut, honeyStreak * 0.42);
  color = mixColor(color, amberLatewood, pores * 0.18);
  color = mixColor(color, darkWalnut, darkStreak * 0.46 + knot * 0.5);

  const height = clamp(
    0.48 +
    grainWave * 0.18 +
    fineGrain * 0.06 +
    pores * 0.12 -
    darkStreak * 0.13 -
    knot * 0.18,
  );
  const roughness = clamp(
    0.34 +
    darkStreak * 0.18 +
    pores * 0.12 +
    knot * 0.14 -
    honeyStreak * 0.06,
    0.28,
    0.68,
  );
  const ambientOcclusion = clamp(0.86 + height * 0.11 - darkStreak * 0.12 - knot * 0.14);

  return {
    color,
    height,
    roughness,
    ambientOcclusion,
  };
}

function writeColor(data: Uint8ClampedArray, offset: number, color: Color3) {
  data[offset] = Math.round(clamp(color.r) * 255);
  data[offset + 1] = Math.round(clamp(color.g) * 255);
  data[offset + 2] = Math.round(clamp(color.b) * 255);
  data[offset + 3] = 255;
}

function configureTexture(texture: DynamicTexture, scale: number) {
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = scale;
  texture.vScale = scale;
  texture.hasAlpha = false;
  texture.anisotropicFilteringLevel = 8;
}

function createDynamicTexture(scene: Scene, name: string, size: number) {
  return new DynamicTexture(name, { width: size, height: size }, scene, false);
}

function createWalnutTextures(
  scene: Scene,
  name: string,
  options: Required<Pick<
    WalnutPbrMaterialOptions,
    'textureSize' | 'textureScale' | 'grainScale' | 'normalStrength'
  >>,
): WalnutTextureSet {
  const { textureSize: size, textureScale, grainScale, normalStrength } = options;
  const albedo = createDynamicTexture(scene, `${name}_albedo`, size);
  const normal = createDynamicTexture(scene, `${name}_normal`, size);
  const orm = createDynamicTexture(scene, `${name}_orm`, size);
  const heightMap = new Float32Array(size * size);
  const albedoContext = albedo.getContext() as CanvasRenderingContext2D;
  const normalContext = normal.getContext() as CanvasRenderingContext2D;
  const ormContext = orm.getContext() as CanvasRenderingContext2D;

  const albedoImage = albedoContext.createImageData(size, size);
  const ormImage = ormContext.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const offset = index * 4;
      const sample = walnutSample(x / size, y / size, grainScale);

      heightMap[index] = sample.height;
      writeColor(albedoImage.data, offset, sample.color);

      ormImage.data[offset] = Math.round(sample.ambientOcclusion * 255);
      ormImage.data[offset + 1] = Math.round(sample.roughness * 255);
      ormImage.data[offset + 2] = 0;
      ormImage.data[offset + 3] = 255;
    }
  }

  albedoContext.putImageData(albedoImage, 0, 0);
  ormContext.putImageData(ormImage, 0, 0);

  const normalImage = normalContext.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heightMap[y * size + ((x - 1 + size) % size)];
      const right = heightMap[y * size + ((x + 1) % size)];
      const down = heightMap[((y - 1 + size) % size) * size + x];
      const up = heightMap[((y + 1) % size) * size + x];
      const dx = (right - left) * normalStrength;
      const dy = (up - down) * normalStrength;
      const nz = 1;
      const length = Math.hypot(dx, dy, nz) || 1;
      const offset = (y * size + x) * 4;

      normalImage.data[offset] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normalImage.data[offset + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normalImage.data[offset + 2] = Math.round(((nz / length) * 0.5 + 0.5) * 255);
      normalImage.data[offset + 3] = 255;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);

  for (const texture of [albedo, normal, orm]) {
    configureTexture(texture, textureScale);
    texture.update(false);
  }

  return { albedo, normal, orm };
}

export function createWalnutPbrMaterial(
  scene: Scene,
  options: WalnutPbrMaterialOptions = {},
): PBRMaterial {
  const name = options.name ?? 'walnutWoodPbr';
  const textureSize = options.textureSize ?? DEFAULT_TEXTURE_SIZE;
  const textureScale = options.textureScale ?? DEFAULT_TEXTURE_SCALE;
  const grainScale = options.grainScale ?? DEFAULT_GRAIN_SCALE;
  const normalStrength = options.normalStrength ?? DEFAULT_NORMAL_STRENGTH;
  const textures = createWalnutTextures(scene, name, {
    textureSize,
    textureScale,
    grainScale,
    normalStrength,
  });

  const material = new PBRMaterial(name, scene);
  material.albedoColor = new Color3(0.47, 0.26, 0.13);
  material.albedoTexture = textures.albedo;
  material.bumpTexture = textures.normal;
  material.metallicTexture = textures.orm;
  material.metallic = 0;
  material.roughness = 0.42;
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.environmentIntensity = 0.7;
  material.forceIrradianceInFragment = true;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  material.clearCoat.isEnabled = true;
  material.clearCoat.intensity = options.clearCoatIntensity ?? 0.24;
  material.clearCoat.roughness = 0.26;

  return material;
}

export function ensureWalnutPbrUvs(mesh: AbstractMesh) {
  if (!(mesh instanceof Mesh)) {
    return;
  }

  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions || positions.length < 3) {
    return;
  }

  const existingUvs = mesh.getVerticesData(VertexBuffer.UVKind);
  const vertexCount = Math.floor(positions.length / 3);
  if (existingUvs && existingUvs.length >= vertexCount * 2) {
    return;
  }

  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const spanZ = Math.max(maxZ - minZ, 1e-6);
  const uvs = new Float32Array(vertexCount * 2);

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const positionOffset = vertexIndex * 3;
    const uvOffset = vertexIndex * 2;
    const x = positions[positionOffset];
    const y = positions[positionOffset + 1];
    const z = positions[positionOffset + 2];
    const nx = Math.abs(normals?.[positionOffset] ?? 0);
    const ny = Math.abs(normals?.[positionOffset + 1] ?? 0);
    const nz = Math.abs(normals?.[positionOffset + 2] ?? 1);

    if (nz >= nx && nz >= ny) {
      uvs[uvOffset] = (x - minX) / spanX;
      uvs[uvOffset + 1] = (y - minY) / spanY;
    } else if (ny >= nx) {
      uvs[uvOffset] = (x - minX) / spanX;
      uvs[uvOffset + 1] = (z - minZ) / spanZ;
    } else {
      uvs[uvOffset] = (y - minY) / spanY;
      uvs[uvOffset + 1] = (z - minZ) / spanZ;
    }
  }

  mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
}
