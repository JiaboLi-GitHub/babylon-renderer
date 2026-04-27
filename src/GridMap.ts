import {
  AbstractMesh,
  Camera,
  Color3,
  DynamicTexture,
  LinesMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

export interface GridMapOptions {
  scene: Scene;
  camera: Camera;
  canvas: HTMLCanvasElement;
  unitLabel?: string;
  elevation?: number;
  coordinateScale?: number;
  minimumHalfRangeValue?: number;
  modelPaddingRatio?: number;
  squarePaddingRatio?: number;
  includeOriginInBounds?: boolean;
  targetMajorPixelSpacing?: number;
  targetLabelPixelHeight?: number;
  targetLabelOffsetPixels?: number;
  minorPerMajor?: number;
  minMajorValueStep?: number;
  maxMajorValueStep?: number;
}

export interface GridMapUnitOptions {
  unitLabel?: string;
  coordinateScale?: number;
  minimumHalfRangeValue?: number;
  minMajorValueStep?: number;
  maxMajorValueStep?: number;
}

export interface GridMapState {
  unitLabel: string;
  coordinateScale: number;
  minXValue: number;
  maxXValue: number;
  minYValue: number;
  maxYValue: number;
  minXWorld: number;
  maxXWorld: number;
  minYWorld: number;
  maxYWorld: number;
  widthValue: number;
  heightValue: number;
  widthWorld: number;
  heightWorld: number;
  halfRangeValue: number;
  halfRangeWorld: number;
  size: number;
  majorValueStep: number;
  minorValueStep: number;
  majorWorldStep: number;
  minorWorldStep: number;
}

interface GridMapConfig {
  unitLabel: string;
  elevation: number;
  coordinateScale: number;
  minimumHalfRangeValue: number;
  modelPaddingRatio: number;
  squarePaddingRatio: number;
  includeOriginInBounds: boolean;
  targetMajorPixelSpacing: number;
  targetLabelPixelHeight: number;
  targetLabelOffsetPixels: number;
  minorPerMajor: number;
  minMajorValueStep: number;
  maxMajorValueStep: number;
}

interface GridMapModelBounds {
  minXWorld: number;
  maxXWorld: number;
  minYWorld: number;
  maxYWorld: number;
}

interface GridMapRangeWorld {
  minXWorld: number;
  maxXWorld: number;
  minYWorld: number;
  maxYWorld: number;
}

interface GridLabelEntry {
  worldValue: number;
  mesh: Mesh;
  baseHeight: number;
}

const DEFAULT_GRID_MAP_CONFIG: GridMapConfig = {
  unitLabel: '',
  elevation: 0,
  coordinateScale: 25,
  minimumHalfRangeValue: 350,
  modelPaddingRatio: 1.15,
  squarePaddingRatio: 1.35,
  includeOriginInBounds: true,
  targetMajorPixelSpacing: 80,
  targetLabelPixelHeight: 28,
  targetLabelOffsetPixels: 18,
  minorPerMajor: 2,
  minMajorValueStep: 25,
  maxMajorValueStep: 500,
};

export class GridMap {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly config: GridMapConfig;

  private readonly gridMeshes: {
    minor: LinesMesh | null;
    major: LinesMesh | null;
    border: LinesMesh | null;
    xAxis: LinesMesh | null;
    yAxis: LinesMesh | null;
    signature: string | null;
  } = {
    minor: null,
    major: null,
    border: null,
    xAxis: null,
    yAxis: null,
    signature: null,
  };

  private readonly gridLabelMeshes: {
    right: { signature: string | null; entries: GridLabelEntry[] };
    bottom: { signature: string | null; entries: GridLabelEntry[] };
  } = {
    right: { signature: null, entries: [] },
    bottom: { signature: null, entries: [] },
  };

  private rangeWorld: GridMapRangeWorld;
  private currentState: GridMapState | null = null;
  private fittedMeshes: AbstractMesh[] = [];

  constructor(options: GridMapOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.config = {
      unitLabel: options.unitLabel ?? DEFAULT_GRID_MAP_CONFIG.unitLabel,
      elevation: options.elevation ?? DEFAULT_GRID_MAP_CONFIG.elevation,
      coordinateScale: options.coordinateScale ?? DEFAULT_GRID_MAP_CONFIG.coordinateScale,
      minimumHalfRangeValue: options.minimumHalfRangeValue ?? DEFAULT_GRID_MAP_CONFIG.minimumHalfRangeValue,
      modelPaddingRatio: options.modelPaddingRatio ?? DEFAULT_GRID_MAP_CONFIG.modelPaddingRatio,
      squarePaddingRatio: options.squarePaddingRatio ?? DEFAULT_GRID_MAP_CONFIG.squarePaddingRatio,
      includeOriginInBounds: options.includeOriginInBounds ?? DEFAULT_GRID_MAP_CONFIG.includeOriginInBounds,
      targetMajorPixelSpacing: options.targetMajorPixelSpacing ?? DEFAULT_GRID_MAP_CONFIG.targetMajorPixelSpacing,
      targetLabelPixelHeight: options.targetLabelPixelHeight ?? DEFAULT_GRID_MAP_CONFIG.targetLabelPixelHeight,
      targetLabelOffsetPixels: options.targetLabelOffsetPixels ?? DEFAULT_GRID_MAP_CONFIG.targetLabelOffsetPixels,
      minorPerMajor: options.minorPerMajor ?? DEFAULT_GRID_MAP_CONFIG.minorPerMajor,
      minMajorValueStep: options.minMajorValueStep ?? DEFAULT_GRID_MAP_CONFIG.minMajorValueStep,
      maxMajorValueStep: options.maxMajorValueStep ?? DEFAULT_GRID_MAP_CONFIG.maxMajorValueStep,
    };
    this.rangeWorld = this.getDefaultRangeWorld();
  }

  fitToMeshes(meshes: AbstractMesh[]) {
    this.fittedMeshes = [...meshes];
    const bounds = this.getModelBounds(meshes);
    this.rangeWorld = this.getGridRangeWorld(bounds);
  }

  setUnitOptions(options: GridMapUnitOptions) {
    if (options.unitLabel !== undefined) {
      this.config.unitLabel = options.unitLabel;
    }

    this.config.coordinateScale = this.getPositiveOption(
      options.coordinateScale,
      this.config.coordinateScale,
    );
    this.config.minimumHalfRangeValue = this.getPositiveOption(
      options.minimumHalfRangeValue,
      this.config.minimumHalfRangeValue,
    );
    this.config.minMajorValueStep = this.getPositiveOption(
      options.minMajorValueStep,
      this.config.minMajorValueStep,
    );
    this.config.maxMajorValueStep = this.getPositiveOption(
      options.maxMajorValueStep,
      this.config.maxMajorValueStep,
    );

    this.clearGridSignatures();
    this.fitToMeshes(this.fittedMeshes);
    this.currentState = null;
  }

  update() {
    const state = this.getAdaptiveGridState(this.rangeWorld);
    this.currentState = state;
    this.syncGridMeshes(state);
    this.updateGridCoordinateMeshes(state);
  }

  getState(): GridMapState {
    return this.currentState ?? this.getAdaptiveGridState(this.rangeWorld);
  }

  dispose() {
    this.disposeMesh(this.gridMeshes.minor);
    this.disposeMesh(this.gridMeshes.major);
    this.disposeMesh(this.gridMeshes.border);
    this.disposeMesh(this.gridMeshes.xAxis);
    this.disposeMesh(this.gridMeshes.yAxis);
    this.disposeGridLabelEntries(this.gridLabelMeshes.right.entries);
    this.disposeGridLabelEntries(this.gridLabelMeshes.bottom.entries);
    this.gridLabelMeshes.right.entries = [];
    this.gridLabelMeshes.bottom.entries = [];
    this.clearGridSignatures();
  }

  private clearGridSignatures() {
    this.gridLabelMeshes.right.signature = null;
    this.gridLabelMeshes.bottom.signature = null;
    this.gridMeshes.signature = null;
  }

  private getPositiveOption(value: number | undefined, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getDefaultRangeWorld(): GridMapRangeWorld {
    const halfWorld = this.config.minimumHalfRangeValue / this.config.coordinateScale;
    return {
      minXWorld: -halfWorld,
      maxXWorld: halfWorld,
      minYWorld: -halfWorld,
      maxYWorld: halfWorld,
    };
  }

  private isMultipleOf(value: number, interval: number) {
    return Math.abs(value / interval - Math.round(value / interval)) < 1e-6;
  }

  private disposeMesh(mesh: { dispose: () => void } | null) {
    mesh?.dispose();
  }

  private rebuildGridMeshes(state: GridMapState) {
    this.disposeMesh(this.gridMeshes.minor);
    this.disposeMesh(this.gridMeshes.major);
    this.disposeMesh(this.gridMeshes.border);
    this.disposeMesh(this.gridMeshes.xAxis);
    this.disposeMesh(this.gridMeshes.yAxis);

    const minorLines: Vector3[][] = [];
    const majorLines: Vector3[][] = [];
    const axisHeight = this.config.elevation + 0.01;

    for (const value of this.getSteppedGridValues(state.minYValue, state.maxYValue, state.minorValueStep)) {
      const snappedValue = Math.abs(value) < 1e-6 ? 0 : Number(value.toFixed(6));
      const worldValue = snappedValue / state.coordinateScale;
      const target = this.isMultipleOf(snappedValue, state.majorValueStep) ? majorLines : minorLines;

      target.push([
        new Vector3(state.minXWorld, worldValue, this.config.elevation),
        new Vector3(state.maxXWorld, worldValue, this.config.elevation),
      ]);
    }

    for (const value of this.getSteppedGridValues(state.minXValue, state.maxXValue, state.minorValueStep)) {
      const snappedValue = Math.abs(value) < 1e-6 ? 0 : Number(value.toFixed(6));
      const worldValue = snappedValue / state.coordinateScale;
      const target = this.isMultipleOf(snappedValue, state.majorValueStep) ? majorLines : minorLines;

      target.push([
        new Vector3(worldValue, state.minYWorld, this.config.elevation),
        new Vector3(worldValue, state.maxYWorld, this.config.elevation),
      ]);
    }

    this.gridMeshes.minor = MeshBuilder.CreateLineSystem('minorGrid', {
      lines: minorLines,
      updatable: false,
    }, this.scene);
    this.gridMeshes.minor.color = new Color3(0.9, 0.9, 0.9);
    this.gridMeshes.minor.isPickable = false;

    this.gridMeshes.major = MeshBuilder.CreateLineSystem('majorGrid', {
      lines: majorLines,
      updatable: false,
    }, this.scene);
    this.gridMeshes.major.color = new Color3(0.75, 0.75, 0.75);
    this.gridMeshes.major.isPickable = false;

    this.gridMeshes.border = MeshBuilder.CreateLines('gridBorder', {
      points: [
        new Vector3(state.minXWorld, state.minYWorld, axisHeight),
        new Vector3(state.minXWorld, state.maxYWorld, axisHeight),
        new Vector3(state.maxXWorld, state.maxYWorld, axisHeight),
        new Vector3(state.maxXWorld, state.minYWorld, axisHeight),
        new Vector3(state.minXWorld, state.minYWorld, axisHeight),
      ],
    }, this.scene);
    this.gridMeshes.border.color = new Color3(0.6, 0.6, 0.6);
    this.gridMeshes.border.isPickable = false;

    if (state.minYValue <= 0 && state.maxYValue >= 0) {
      this.gridMeshes.xAxis = MeshBuilder.CreateLines('gridXAxis', {
        points: [
          new Vector3(state.minXWorld, 0, axisHeight),
          new Vector3(state.maxXWorld, 0, axisHeight),
        ],
      }, this.scene);
      this.gridMeshes.xAxis.color = new Color3(1, 0.58, 0.58);
      this.gridMeshes.xAxis.isPickable = false;
    } else {
      this.gridMeshes.xAxis = null;
    }

    if (state.minXValue <= 0 && state.maxXValue >= 0) {
      this.gridMeshes.yAxis = MeshBuilder.CreateLines('gridYAxis', {
        points: [
          new Vector3(0, state.minYWorld, axisHeight),
          new Vector3(0, state.maxYWorld, axisHeight),
        ],
      }, this.scene);
      this.gridMeshes.yAxis.color = new Color3(0.74, 0.96, 0.74);
      this.gridMeshes.yAxis.isPickable = false;
    } else {
      this.gridMeshes.yAxis = null;
    }
  }

  private syncGridMeshes(state: GridMapState) {
    const signature = [
      state.minXWorld.toFixed(4),
      state.maxXWorld.toFixed(4),
      state.minYWorld.toFixed(4),
      state.maxYWorld.toFixed(4),
      state.minorWorldStep.toFixed(4),
      state.majorWorldStep.toFixed(4),
    ].join('|');

    if (this.gridMeshes.signature === signature) {
      return;
    }

    this.rebuildGridMeshes(state);
    this.gridMeshes.signature = signature;
  }

  private projectToScreen(point: Vector3) {
    return Vector3.Project(
      point,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight),
    );
  }

  private getSteppedGridValues(minValue: number, maxValue: number, stepValue: number, includeBoundaries = false) {
    if (!Number.isFinite(stepValue) || stepValue <= 0) {
      return [0];
    }

    const values: number[] = [];
    const epsilon = 1e-6;
    const start = Math.ceil((minValue - epsilon) / stepValue) * stepValue;
    const end = Math.floor((maxValue + epsilon) / stepValue) * stepValue;

    for (let value = start; value <= end + epsilon; value += stepValue) {
      const snappedValue = Math.abs(value) < epsilon ? 0 : Number(value.toFixed(6));
      if (snappedValue >= minValue - epsilon && snappedValue <= maxValue + epsilon) {
        values.push(snappedValue);
      }
    }

    if (!includeBoundaries) {
      return values;
    }

    if (!values.some((value) => Math.abs(value - minValue) < epsilon)) {
      values.unshift(minValue);
    }
    if (!values.some((value) => Math.abs(value - maxValue) < epsilon)) {
      values.push(maxValue);
    }

    return values;
  }

  private getProjectedGridBoundaries(state: GridMapState) {
    const centerX = (state.minXWorld + state.maxXWorld) * 0.5;
    const centerY = (state.minYWorld + state.maxYWorld) * 0.5;
    const positiveY = this.projectToScreen(new Vector3(centerX, state.maxYWorld, this.config.elevation));
    const negativeY = this.projectToScreen(new Vector3(centerX, state.minYWorld, this.config.elevation));
    const positiveX = this.projectToScreen(new Vector3(state.maxXWorld, centerY, this.config.elevation));
    const negativeX = this.projectToScreen(new Vector3(state.minXWorld, centerY, this.config.elevation));

    return {
      rightYWorld: positiveY.x >= negativeY.x ? state.maxYWorld : state.minYWorld,
      bottomXWorld: positiveX.y >= negativeX.y ? state.maxXWorld : state.minXWorld,
    };
  }

  private createGridLabelMesh(name: string, text: string, rotationZ = 0) {
    const width = Math.max(1.1, text.length * 0.34 + 0.42);
    const height = 0.58;
    const plane = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    const texture = new DynamicTexture(`${name}_texture`, {
      width: 512,
      height: 256,
    }, this.scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, 512, 256);
    const fontSize = Math.max(58, Math.min(100, Math.floor(760 / Math.max(text.length, 1))));
    ctx.font = `400 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#9d9d9d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 128);

    texture.hasAlpha = true;
    texture.update();

    const material = new StandardMaterial(`${name}_material`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.backFaceCulling = false;

    plane.material = material;
    plane.rotation.z = rotationZ;
    plane.isPickable = false;
    plane.renderingGroupId = 1;

    return {
      mesh: plane,
      baseHeight: height,
    };
  }

  private formatGridLabelValue(value: number) {
    const absValue = Math.abs(value);
    const decimals = absValue >= 100
      ? 0
      : absValue >= 10
        ? 1
        : absValue >= 1
          ? 2
          : 4;

    return Number(absValue.toFixed(decimals)).toString();
  }

  private getWorldUnitsPerPixel(point: Vector3) {
    const screenOrigin = this.projectToScreen(point);
    const screenX = this.projectToScreen(new Vector3(point.x + 1, point.y, point.z));
    const screenY = this.projectToScreen(new Vector3(point.x, point.y + 1, point.z));
    const pixelsPerWorldUnit = Math.max(
      1e-4,
      (
        Math.hypot(screenX.x - screenOrigin.x, screenX.y - screenOrigin.y) +
        Math.hypot(screenY.x - screenOrigin.x, screenY.y - screenOrigin.y)
      ) / 2,
    );

    return 1 / pixelsPerWorldUnit;
  }

  private disposeGridLabelEntries(entries: GridLabelEntry[]) {
    for (const entry of entries) {
      if (entry.mesh.material) {
        entry.mesh.material.dispose(false, true);
      }
      entry.mesh.dispose();
    }
  }

  private buildGridLabelEntries(axis: 'right' | 'bottom', state: GridMapState) {
    const entries: GridLabelEntry[] = [];
    const rangeValues = axis === 'right'
      ? this.getSteppedGridValues(state.minXValue, state.maxXValue, state.majorValueStep)
      : this.getSteppedGridValues(state.minYValue, state.maxYValue, state.majorValueStep);

    for (const value of rangeValues) {
      const snappedValue = Math.abs(value) < 1e-6 ? 0 : Number(value.toFixed(6));
      const labelText = this.formatGridLabelValue(snappedValue);
      const labelMesh = this.createGridLabelMesh(
        `grid_${axis}_${state.majorValueStep}_${snappedValue}`,
        labelText,
        axis === 'right' ? Math.PI / 2 : 0,
      );

      entries.push({
        worldValue: snappedValue / state.coordinateScale,
        mesh: labelMesh.mesh,
        baseHeight: labelMesh.baseHeight,
      });
    }

    return entries;
  }

  private getNiceCeilStep(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }

    const exponent = Math.floor(Math.log10(value));
    const magnitude = 10 ** exponent;
    const normalized = value / magnitude;

    for (const factor of [1, 2, 2.5, 5, 10]) {
      if (normalized <= factor) {
        return factor * magnitude;
      }
    }

    return 10 * magnitude;
  }

  private roundGridValue(value: number) {
    if (Math.abs(value) < 1e-6) {
      return 0;
    }

    return Number(value.toFixed(6));
  }

  private getSquareSpanValue(spanValue: number, stepValue: number) {
    const paddedSpanValue = Math.max(stepValue, spanValue * this.config.squarePaddingRatio);
    return Math.ceil(paddedSpanValue / stepValue) * stepValue;
  }

  private expandAxisBoundsToSpan(minValue: number, maxValue: number, targetSpanValue: number, stepValue: number) {
    const currentSpanValue = maxValue - minValue;
    if (currentSpanValue >= targetSpanValue - 1e-6) {
      return { minValue, maxValue };
    }

    const extraSteps = Math.round((targetSpanValue - currentSpanValue) / stepValue);
    const stepsBefore = Math.floor(extraSteps / 2);
    const stepsAfter = extraSteps - stepsBefore;

    let expandedMinValue = minValue - stepsBefore * stepValue;
    let expandedMaxValue = maxValue + stepsAfter * stepValue;

    if (this.config.includeOriginInBounds) {
      if (expandedMinValue > 0) {
        const shiftSteps = Math.ceil(expandedMinValue / stepValue);
        expandedMinValue -= shiftSteps * stepValue;
        expandedMaxValue -= shiftSteps * stepValue;
      } else if (expandedMaxValue < 0) {
        const shiftSteps = Math.ceil(-expandedMaxValue / stepValue);
        expandedMinValue += shiftSteps * stepValue;
        expandedMaxValue += shiftSteps * stepValue;
      }
    }

    return {
      minValue: expandedMinValue,
      maxValue: expandedMaxValue,
    };
  }

  private expandAxisRange(minWorld: number, maxWorld: number, minimumSpanWorld: number) {
    const spanWorld = Math.max(maxWorld - minWorld, 1e-6);
    const paddedSpanWorld = Math.max(minimumSpanWorld, spanWorld * this.config.modelPaddingRatio);
    const centerWorld = (minWorld + maxWorld) * 0.5;

    let expandedMinWorld = centerWorld - paddedSpanWorld * 0.5;
    let expandedMaxWorld = centerWorld + paddedSpanWorld * 0.5;

    if (this.config.includeOriginInBounds) {
      expandedMinWorld = Math.min(expandedMinWorld, 0);
      expandedMaxWorld = Math.max(expandedMaxWorld, 0);
    }

    return {
      minWorld: expandedMinWorld,
      maxWorld: expandedMaxWorld,
    };
  }

  private getStableSquareRangeWorld(rangeWorld: GridMapRangeWorld) {
    const snapStepValue = this.config.minMajorValueStep;
    const rawMinXValue = rangeWorld.minXWorld * this.config.coordinateScale;
    const rawMaxXValue = rangeWorld.maxXWorld * this.config.coordinateScale;
    const rawMinYValue = rangeWorld.minYWorld * this.config.coordinateScale;
    const rawMaxYValue = rangeWorld.maxYWorld * this.config.coordinateScale;

    const minXValue = Math.floor(rawMinXValue / snapStepValue) * snapStepValue;
    const maxXValue = Math.ceil(rawMaxXValue / snapStepValue) * snapStepValue;
    const minYValue = Math.floor(rawMinYValue / snapStepValue) * snapStepValue;
    const maxYValue = Math.ceil(rawMaxYValue / snapStepValue) * snapStepValue;

    const snappedWidthValue = maxXValue - minXValue;
    const snappedHeightValue = maxYValue - minYValue;
    const targetSquareSpanValue = this.getSquareSpanValue(
      Math.max(snappedWidthValue, snappedHeightValue),
      snapStepValue,
    );
    const squareXBounds = this.expandAxisBoundsToSpan(
      minXValue,
      maxXValue,
      targetSquareSpanValue,
      snapStepValue,
    );
    const squareYBounds = this.expandAxisBoundsToSpan(
      minYValue,
      maxYValue,
      targetSquareSpanValue,
      snapStepValue,
    );

    return {
      minXWorld: this.roundGridValue(squareXBounds.minValue / this.config.coordinateScale),
      maxXWorld: this.roundGridValue(squareXBounds.maxValue / this.config.coordinateScale),
      minYWorld: this.roundGridValue(squareYBounds.minValue / this.config.coordinateScale),
      maxYWorld: this.roundGridValue(squareYBounds.maxValue / this.config.coordinateScale),
    };
  }

  private getGridRangeWorld(bounds: GridMapModelBounds | null): GridMapRangeWorld {
    if (!bounds) {
      return this.getDefaultRangeWorld();
    }

    const minimumSpanWorld = (this.config.minimumHalfRangeValue * 2) / this.config.coordinateScale;
    const xRange = this.expandAxisRange(bounds.minXWorld, bounds.maxXWorld, minimumSpanWorld);
    const yRange = this.expandAxisRange(bounds.minYWorld, bounds.maxYWorld, minimumSpanWorld);

    return this.getStableSquareRangeWorld({
      minXWorld: xRange.minWorld,
      maxXWorld: xRange.maxWorld,
      minYWorld: yRange.minWorld,
      maxYWorld: yRange.maxWorld,
    });
  }

  private getAdaptiveGridState(rangeWorld: GridMapRangeWorld): GridMapState {
    const unitWorldStep = 1 / this.config.coordinateScale;
    const origin = this.projectToScreen(new Vector3(0, 0, this.config.elevation));
    const xUnit = this.projectToScreen(new Vector3(unitWorldStep, 0, this.config.elevation));
    const yUnit = this.projectToScreen(new Vector3(0, unitWorldStep, this.config.elevation));
    const pixelPerValueUnit = Math.max(
      1e-4,
      (Math.hypot(xUnit.x - origin.x, xUnit.y - origin.y) +
        Math.hypot(yUnit.x - origin.x, yUnit.y - origin.y)) / 2,
    );
    const roughMajorValueStep = this.config.targetMajorPixelSpacing / pixelPerValueUnit;
    const majorValueStep = Math.min(
      this.config.maxMajorValueStep,
      Math.max(this.config.minMajorValueStep, this.getNiceCeilStep(roughMajorValueStep)),
    );
    const minorValueStep = majorValueStep / this.config.minorPerMajor;

    const minXWorld = rangeWorld.minXWorld;
    const maxXWorld = rangeWorld.maxXWorld;
    const minYWorld = rangeWorld.minYWorld;
    const maxYWorld = rangeWorld.maxYWorld;
    const minXValue = this.roundGridValue(minXWorld * this.config.coordinateScale);
    const maxXValue = this.roundGridValue(maxXWorld * this.config.coordinateScale);
    const minYValue = this.roundGridValue(minYWorld * this.config.coordinateScale);
    const maxYValue = this.roundGridValue(maxYWorld * this.config.coordinateScale);
    const widthValue = this.roundGridValue(maxXValue - minXValue);
    const heightValue = this.roundGridValue(maxYValue - minYValue);
    const widthWorld = maxXWorld - minXWorld;
    const heightWorld = maxYWorld - minYWorld;
    const halfRangeValue = Math.max(
      Math.abs(minXValue),
      Math.abs(maxXValue),
      Math.abs(minYValue),
      Math.abs(maxYValue),
    );
    const halfRangeWorld = halfRangeValue / this.config.coordinateScale;

    return {
      unitLabel: this.config.unitLabel,
      coordinateScale: this.config.coordinateScale,
      minXValue,
      maxXValue,
      minYValue,
      maxYValue,
      minXWorld,
      maxXWorld,
      minYWorld,
      maxYWorld,
      widthValue,
      heightValue,
      widthWorld,
      heightWorld,
      halfRangeValue,
      halfRangeWorld,
      size: Math.max(widthWorld, heightWorld),
      majorValueStep,
      minorValueStep,
      majorWorldStep: majorValueStep / this.config.coordinateScale,
      minorWorldStep: minorValueStep / this.config.coordinateScale,
    };
  }

  private ensureGridCoordinateMeshes(state: GridMapState) {
    for (const axis of ['right', 'bottom'] as const) {
      const signature = [
        axis,
        this.config.unitLabel,
        state.minXValue,
        state.maxXValue,
        state.minYValue,
        state.maxYValue,
        state.majorValueStep,
      ].join('|');

      if (this.gridLabelMeshes[axis].signature === signature) {
        continue;
      }

      this.disposeGridLabelEntries(this.gridLabelMeshes[axis].entries);
      this.gridLabelMeshes[axis].entries = this.buildGridLabelEntries(axis, state);
      this.gridLabelMeshes[axis].signature = signature;
    }
  }

  private updateGridCoordinateMeshes(state: GridMapState) {
    this.ensureGridCoordinateMeshes(state);

    const labelHeight = this.config.elevation + 0.03;
    const { rightYWorld, bottomXWorld } = this.getProjectedGridBoundaries(state);
    const rightYDirection = Math.sign(rightYWorld) || 1;
    const bottomXDirection = Math.sign(bottomXWorld) || 1;
    const rightRotation = rightYDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
    const bottomRotation = bottomXDirection > 0 ? 0 : Math.PI;

    for (const label of this.gridLabelMeshes.right.entries) {
      const borderPosition = new Vector3(label.worldValue, rightYWorld, labelHeight);
      const worldUnitsPerPixel = this.getWorldUnitsPerPixel(borderPosition);
      const worldOffset = Math.max(
        worldUnitsPerPixel * this.config.targetLabelOffsetPixels,
        0.16,
      );
      const worldScale = Math.max(
        0.25,
        (worldUnitsPerPixel * this.config.targetLabelPixelHeight) / label.baseHeight,
      );

      label.mesh.position.set(
        label.worldValue,
        rightYWorld + rightYDirection * worldOffset,
        labelHeight,
      );
      label.mesh.scaling.set(worldScale, worldScale, 1);
      label.mesh.rotation.z = rightRotation;
    }

    for (const label of this.gridLabelMeshes.bottom.entries) {
      const borderPosition = new Vector3(bottomXWorld, label.worldValue, labelHeight);
      const worldUnitsPerPixel = this.getWorldUnitsPerPixel(borderPosition);
      const worldOffset = Math.max(
        worldUnitsPerPixel * this.config.targetLabelOffsetPixels,
        0.16,
      );
      const worldScale = Math.max(
        0.25,
        (worldUnitsPerPixel * this.config.targetLabelPixelHeight) / label.baseHeight,
      );

      label.mesh.position.set(
        bottomXWorld + bottomXDirection * worldOffset,
        label.worldValue,
        labelHeight,
      );
      label.mesh.scaling.set(worldScale, worldScale, 1);
      label.mesh.rotation.z = bottomRotation;
    }
  }

  private getModelBounds(meshes: AbstractMesh[]): GridMapModelBounds | null {
    if (meshes.length === 0) {
      return null;
    }

    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const boundingInfo = mesh.getBoundingInfo();
      min.minimizeInPlace(boundingInfo.boundingBox.minimumWorld);
      max.maximizeInPlace(boundingInfo.boundingBox.maximumWorld);
    }

    return {
      minXWorld: min.x,
      maxXWorld: max.x,
      minYWorld: min.y,
      maxYWorld: max.y,
    };
  }
}
