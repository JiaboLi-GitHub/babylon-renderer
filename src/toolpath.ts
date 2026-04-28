export interface ToolpathBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ToolpathPoint {
  x: number;
  y: number;
  z: number;
}

export interface ToolpathSegment {
  start: ToolpathPoint;
  end: ToolpathPoint;
}

export interface FacingToolpathOptions {
  bounds: ToolpathBounds;
  coordinateScale: number;
  toolDiameter: number;
  stepoverRatio?: number;
  cutDepth?: number;
  safeHeight?: number;
}

export interface FacingToolpathPlan {
  strategy: 'facing-raster';
  bounds: ToolpathBounds;
  cutPoints: ToolpathPoint[];
  rapidSegments: ToolpathSegment[];
  safeZ: number;
  cutZ: number;
  toolDiameter: number;
  stepover: number;
  stepoverRatio: number;
  cutDepth: number;
  safeHeight: number;
  rowCount: number;
  totalCutDistance: number;
  totalRapidDistance: number;
}

export interface FacingGcodeOptions {
  coordinateScale: number;
  millimetersPerUnit?: number;
  programName?: string;
  feedRate?: number;
  plungeRate?: number;
  spindleSpeed?: number;
}

const DEFAULT_STEPOVER_RATIO = 0.6;
const DEFAULT_CUT_DEPTH = 1;
const DEFAULT_SAFE_HEIGHT = 5;
const DEFAULT_FEED_RATE = 800;
const DEFAULT_PLUNGE_RATE = 180;
const DEFAULT_SPINDLE_SPEED = 12000;
const EPSILON = 1e-8;

function sanitizePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(a: ToolpathPoint, b: ToolpathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sumDistances(points: ToolpathPoint[]): number {
  let distance = 0;

  for (let index = 1; index < points.length; index += 1) {
    distance += distanceBetween(points[index - 1], points[index]);
  }

  return distance;
}

function getInsetRange(min: number, max: number, inset: number): [number, number] {
  const size = Math.max(0, max - min);

  if (size <= EPSILON) {
    return [min, max];
  }

  const safeInset = Math.min(inset, size / 2);
  const start = min + safeInset;
  const end = max - safeInset;

  if (end < start) {
    const center = (min + max) / 2;
    return [center, center];
  }

  return [start, end];
}

function getRasterRows(start: number, end: number, stepover: number): number[] {
  if (Math.abs(end - start) <= EPSILON) {
    return [(start + end) / 2];
  }

  const rows: number[] = [];
  const safeStep = Math.max(stepover, EPSILON);

  for (let y = start; y < end - EPSILON; y += safeStep) {
    rows.push(y);
  }

  const last = rows[rows.length - 1];
  if (last === undefined || Math.abs(last - end) > EPSILON) {
    rows.push(end);
  }

  return rows;
}

function sanitizeProgramName(programName: string | undefined): string {
  return (programName ?? 'simple-facing')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'simple-facing';
}

function formatNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

export function createFacingToolpath(options: FacingToolpathOptions): FacingToolpathPlan {
  const coordinateScale = sanitizePositive(options.coordinateScale, 1);
  const toolDiameter = sanitizePositive(options.toolDiameter, 1);
  const stepoverRatio = clamp(
    sanitizePositive(options.stepoverRatio, DEFAULT_STEPOVER_RATIO),
    0.05,
    1,
  );
  const cutDepth = sanitizePositive(options.cutDepth, DEFAULT_CUT_DEPTH);
  const safeHeight = sanitizePositive(options.safeHeight, DEFAULT_SAFE_HEIGHT);

  const toolDiameterWorld = toolDiameter / coordinateScale;
  const toolRadiusWorld = toolDiameterWorld / 2;
  const stepover = toolDiameter * stepoverRatio;
  const stepoverWorld = Math.max(stepover / coordinateScale, EPSILON);
  const cutDepthWorld = cutDepth / coordinateScale;
  const safeHeightWorld = safeHeight / coordinateScale;
  const safeZ = options.bounds.maxZ + safeHeightWorld;
  const cutZ = options.bounds.maxZ - cutDepthWorld;

  const [minX, maxX] = getInsetRange(options.bounds.minX, options.bounds.maxX, toolRadiusWorld);
  const [minY, maxY] = getInsetRange(options.bounds.minY, options.bounds.maxY, toolRadiusWorld);
  const rows = getRasterRows(minY, maxY, stepoverWorld);
  const cutPoints: ToolpathPoint[] = [];

  rows.forEach((y, rowIndex) => {
    if (rowIndex % 2 === 0) {
      cutPoints.push({ x: minX, y, z: cutZ });
      cutPoints.push({ x: maxX, y, z: cutZ });
      return;
    }

    cutPoints.push({ x: maxX, y, z: cutZ });
    cutPoints.push({ x: minX, y, z: cutZ });
  });

  const firstPoint = cutPoints[0];
  const lastPoint = cutPoints[cutPoints.length - 1];
  const rapidSegments: ToolpathSegment[] = firstPoint && lastPoint
    ? [
      {
        start: { ...firstPoint, z: safeZ },
        end: firstPoint,
      },
      {
        start: lastPoint,
        end: { ...lastPoint, z: safeZ },
      },
    ]
    : [];

  return {
    strategy: 'facing-raster',
    bounds: { ...options.bounds },
    cutPoints,
    rapidSegments,
    safeZ,
    cutZ,
    toolDiameter,
    stepover,
    stepoverRatio,
    cutDepth,
    safeHeight,
    rowCount: rows.length,
    totalCutDistance: sumDistances(cutPoints),
    totalRapidDistance: rapidSegments.reduce(
      (total, segment) => total + distanceBetween(segment.start, segment.end),
      0,
    ),
  };
}

export function generateFacingGcode(plan: FacingToolpathPlan, options: FacingGcodeOptions): string {
  const coordinateScale = sanitizePositive(options.coordinateScale, 1);
  const millimetersPerUnit = sanitizePositive(options.millimetersPerUnit, 1);
  const toMillimeters = (worldValue: number) => worldValue * coordinateScale * millimetersPerUnit;
  const feedRate = sanitizePositive(options.feedRate, DEFAULT_FEED_RATE);
  const plungeRate = sanitizePositive(options.plungeRate, DEFAULT_PLUNGE_RATE);
  const spindleSpeed = Math.round(sanitizePositive(options.spindleSpeed, DEFAULT_SPINDLE_SPEED));
  const programName = sanitizeProgramName(options.programName);
  const firstPoint = plan.cutPoints[0];

  if (!firstPoint) {
    throw new Error('Cannot export an empty toolpath.');
  }

  const lines = [
    '%',
    `(Program: ${programName})`,
    '(Strategy: simple facing raster)',
    `(Rows: ${plan.rowCount})`,
    `(Tool diameter: ${formatNumber(plan.toolDiameter)} project units)`,
    'G21',
    'G90',
    'G17',
    'G94',
    'G54',
    `S${spindleSpeed} M3`,
    `G0 Z${formatNumber(toMillimeters(plan.safeZ))}`,
    `G0 X${formatNumber(toMillimeters(firstPoint.x))} Y${formatNumber(toMillimeters(firstPoint.y))}`,
    `G1 Z${formatNumber(toMillimeters(plan.cutZ))} F${formatNumber(plungeRate)}`,
  ];

  for (const point of plan.cutPoints.slice(1)) {
    lines.push(
      `G1 X${formatNumber(toMillimeters(point.x))} Y${formatNumber(toMillimeters(point.y))} F${formatNumber(feedRate)}`,
    );
  }

  lines.push(
    `G0 Z${formatNumber(toMillimeters(plan.safeZ))}`,
    'M5',
    'M30',
    '%',
    '',
  );

  return lines.join('\n');
}
