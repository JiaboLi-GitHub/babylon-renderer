export type LengthUnit = 'millimeter' | 'centimeter';

export interface LengthUnitDefinition {
  key: LengthUnit;
  label: string;
  abbreviation: string;
  millimetersPerUnit: number;
  stepSiPrefix: string | null;
  stepConversionName?: string;
}

export interface GridUnitOptions {
  unit: LengthUnit;
  unitLabel: string;
  coordinateScale: number;
  minimumHalfRangeValue: number;
  minMajorValueStep: number;
  maxMajorValueStep: number;
}

const BASE_MILLIMETERS_PER_WORLD_UNIT = 25;
const BASE_MINIMUM_HALF_RANGE_MILLIMETERS = 350;
const BASE_MIN_MAJOR_STEP_MILLIMETERS = 25;
const BASE_MAX_MAJOR_STEP_MILLIMETERS = 500;

export const LENGTH_UNITS: readonly LengthUnitDefinition[] = [
  {
    key: 'millimeter',
    label: 'Millimeters',
    abbreviation: 'mm',
    millimetersPerUnit: 1,
    stepSiPrefix: '.MILLI.',
  },
  {
    key: 'centimeter',
    label: 'Centimeters',
    abbreviation: 'cm',
    millimetersPerUnit: 10,
    stepSiPrefix: '.CENTI.',
  },
] as const;

export const DEFAULT_LENGTH_UNIT: LengthUnit = 'millimeter';

export function getLengthUnitDefinition(unit: LengthUnit | string): LengthUnitDefinition {
  return LENGTH_UNITS.find((definition) => definition.key === unit) ?? LENGTH_UNITS[0];
}

export function getGridUnitOptions(unit: LengthUnit | string): GridUnitOptions {
  const definition = getLengthUnitDefinition(unit);
  const unitsPerMillimeter = 1 / definition.millimetersPerUnit;

  return {
    unit: definition.key,
    unitLabel: definition.abbreviation,
    coordinateScale: BASE_MILLIMETERS_PER_WORLD_UNIT * unitsPerMillimeter,
    minimumHalfRangeValue: BASE_MINIMUM_HALF_RANGE_MILLIMETERS * unitsPerMillimeter,
    minMajorValueStep: BASE_MIN_MAJOR_STEP_MILLIMETERS * unitsPerMillimeter,
    maxMajorValueStep: BASE_MAX_MAJOR_STEP_MILLIMETERS * unitsPerMillimeter,
  };
}
