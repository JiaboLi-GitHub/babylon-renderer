import {
  AbstractMesh,
  Camera,
  Color3,
  LinesMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  Observer,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

export type WorkpieceOriginCandidateKind = 'corner' | 'edge-center' | 'face-center';
export type WorkpieceOriginAxisId = 'x' | 'y' | 'z';

export interface WorkpieceOriginCandidate {
  id: string;
  kind: WorkpieceOriginCandidateKind;
  positionWorld: Vector3;
  normalWorld: Vector3;
}

export interface WorkpieceBoundsWorld {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: Vector3;
  diagonal: number;
}

export interface WorkpieceOriginSelection {
  id: string;
  kind: WorkpieceOriginCandidateKind;
  positionWorld: Vector3;
  positionValue: {
    x: number;
    y: number;
    z: number;
  };
  axisXWorld: Vector3;
  axisYWorld: Vector3;
  axisZWorld: Vector3;
}

export interface WorkpieceOriginAxisPreview {
  originWorld: Vector3;
  axisLengthWorld: number;
  axisXWorld: Vector3;
  axisYWorld: Vector3;
  axisZWorld: Vector3;
}

export interface WorkpieceOriginSelectorState {
  enabled: boolean;
  boundsWorld: WorkpieceBoundsWorld | null;
  candidates: WorkpieceOriginCandidate[];
  hoveredCandidateId: string | null;
  hoveredAxisId: WorkpieceOriginAxisId | null;
  selectedCandidateId: string | null;
  activeRotationAxisId: WorkpieceOriginAxisId | null;
  selection: WorkpieceOriginSelection | null;
  axisPreview: WorkpieceOriginAxisPreview | null;
}

export interface WorkpieceOriginSelectorUnitOptions {
  coordinateScale?: number;
  unitLabel?: string;
}

export interface WorkpieceOriginSelectorOptions extends WorkpieceOriginSelectorUnitOptions {
  scene: Scene;
  camera: Camera;
  canvas: HTMLCanvasElement;
  enabled?: boolean;
  showBoundingBox?: boolean;
  showCandidates?: boolean;
  showAxisPreview?: boolean;
  candidateKinds?: WorkpieceOriginCandidateKind[];
  handleRadiusRatio?: number;
  minHandleRadiusWorld?: number;
  maxHandleRadiusWorld?: number;
  axisLengthRatio?: number;
  minAxisLengthWorld?: number;
  onOriginChange?: (selection: WorkpieceOriginSelection | null) => void;
  onStateChange?: (state: WorkpieceOriginSelectorState) => void;
}

interface WorkpieceOriginSelectorConfig {
  enabled: boolean;
  showBoundingBox: boolean;
  showCandidates: boolean;
  showAxisPreview: boolean;
  candidateKinds: WorkpieceOriginCandidateKind[];
  coordinateScale: number;
  unitLabel: string;
  handleRadiusRatio: number;
  minHandleRadiusWorld: number;
  maxHandleRadiusWorld: number;
  axisLengthRatio: number;
  minAxisLengthWorld: number;
}

const DEFAULT_CANDIDATE_KINDS: WorkpieceOriginCandidateKind[] = [
  'corner',
  'edge-center',
  'face-center',
];

const DEFAULT_CONFIG: Omit<WorkpieceOriginSelectorConfig, 'candidateKinds'> & {
  candidateKinds: WorkpieceOriginCandidateKind[];
} = {
  enabled: true,
  showBoundingBox: true,
  showCandidates: true,
  showAxisPreview: true,
  candidateKinds: DEFAULT_CANDIDATE_KINDS,
  coordinateScale: 1,
  unitLabel: '',
  handleRadiusRatio: 0.018,
  minHandleRadiusWorld: 0.025,
  maxHandleRadiusWorld: 0.18,
  axisLengthRatio: 0.24,
  minAxisLengthWorld: 0.35,
};

const BOUND_EPSILON = 1e-9;
const CLICK_MOVE_THRESHOLD_PIXELS = 4;
const MIN_SAFE_THICKNESS_WORLD = 1e-4;
const AXIS_IDS: WorkpieceOriginAxisId[] = ['x', 'y', 'z'];
const AXIS_COLORS: Record<WorkpieceOriginAxisId, Color3> = {
  x: new Color3(0.95, 0.12, 0.12),
  y: new Color3(0.16, 0.68, 0.18),
  z: new Color3(0.1, 0.32, 1),
};
const AXIS_EMISSIVE_COLORS: Record<WorkpieceOriginAxisId, Color3> = {
  x: new Color3(0.55, 0.02, 0.02),
  y: new Color3(0.02, 0.36, 0.04),
  z: new Color3(0.02, 0.08, 0.58),
};
const WORKPIECE_AXIS_ROTATION_STEP_RADIANS = Math.PI / 2;

export class WorkpieceOriginSelector {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly config: WorkpieceOriginSelectorConfig;
  private readonly root: TransformNode;
  private readonly candidateMeshes = new Map<string, Mesh>();
  private readonly candidateByMesh = new Map<AbstractMesh, WorkpieceOriginCandidate>();
  private readonly candidateMaterial: StandardMaterial;
  private readonly hoverMaterial: StandardMaterial;
  private readonly selectedMaterial: StandardMaterial;
  private readonly axisXMaterial: StandardMaterial;
  private readonly axisYMaterial: StandardMaterial;
  private readonly axisZMaterial: StandardMaterial;
  private readonly axisMaterials: Record<WorkpieceOriginAxisId, StandardMaterial>;
  private readonly onOriginChange?: (selection: WorkpieceOriginSelection | null) => void;
  private readonly onStateChange?: (state: WorkpieceOriginSelectorState) => void;
  private readonly handleCanvasPointerLeave = () => {
    this.setHoverTargets(null, null);
  };
  private readonly axisPreviewMeshes: AbstractMesh[] = [];

  private boundingBoxMesh: LinesMesh | null = null;
  private boundsWorld: WorkpieceBoundsWorld | null = null;
  private candidates: WorkpieceOriginCandidate[] = [];
  private hoveredCandidateId: string | null = null;
  private hoveredAxisId: WorkpieceOriginAxisId | null = null;
  private selectedCandidateId: string | null = null;
  private axisXWorld = new Vector3(1, 0, 0);
  private axisYWorld = new Vector3(0, 1, 0);
  private axisZWorld = new Vector3(0, 0, 1);
  private activeRotationAxisId: WorkpieceOriginAxisId | null = null;
  private pointerObserver: Observer<PointerInfo> | null = null;
  private pointerDown: {
    x: number;
    y: number;
    targetType: 'candidate' | 'axis' | null;
    targetId: string | null;
  } | null = null;

  constructor(options: WorkpieceOriginSelectorOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.config = {
      enabled: options.enabled ?? DEFAULT_CONFIG.enabled,
      showBoundingBox: options.showBoundingBox ?? DEFAULT_CONFIG.showBoundingBox,
      showCandidates: options.showCandidates ?? DEFAULT_CONFIG.showCandidates,
      showAxisPreview: options.showAxisPreview ?? DEFAULT_CONFIG.showAxisPreview,
      candidateKinds: [...(options.candidateKinds ?? DEFAULT_CONFIG.candidateKinds)],
      coordinateScale: this.getPositiveOption(options.coordinateScale, DEFAULT_CONFIG.coordinateScale),
      unitLabel: options.unitLabel ?? DEFAULT_CONFIG.unitLabel,
      handleRadiusRatio: this.getPositiveOption(options.handleRadiusRatio, DEFAULT_CONFIG.handleRadiusRatio),
      minHandleRadiusWorld: this.getPositiveOption(
        options.minHandleRadiusWorld,
        DEFAULT_CONFIG.minHandleRadiusWorld,
      ),
      maxHandleRadiusWorld: this.getPositiveOption(
        options.maxHandleRadiusWorld,
        DEFAULT_CONFIG.maxHandleRadiusWorld,
      ),
      axisLengthRatio: this.getPositiveOption(options.axisLengthRatio, DEFAULT_CONFIG.axisLengthRatio),
      minAxisLengthWorld: this.getPositiveOption(
        options.minAxisLengthWorld,
        DEFAULT_CONFIG.minAxisLengthWorld,
      ),
    };
    this.onOriginChange = options.onOriginChange;
    this.onStateChange = options.onStateChange;

    this.root = new TransformNode('workpieceOriginSelector.root', this.scene);
    this.root.setEnabled(this.config.enabled);

    this.candidateMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.candidateMaterial',
      new Color3(0.92, 0.96, 1),
      new Color3(0.26, 0.38, 0.5),
    );
    this.hoverMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.hoverMaterial',
      new Color3(1, 0.82, 0.22),
      new Color3(0.58, 0.34, 0.04),
    );
    this.selectedMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.selectedMaterial',
      new Color3(1, 0.45, 0.16),
      new Color3(0.62, 0.18, 0.04),
    );
    this.axisXMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.axisXMaterial',
      AXIS_COLORS.x,
      AXIS_EMISSIVE_COLORS.x,
    );
    this.axisYMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.axisYMaterial',
      AXIS_COLORS.y,
      AXIS_EMISSIVE_COLORS.y,
    );
    this.axisZMaterial = this.createCandidateMaterial(
      'workpieceOriginSelector.axisZMaterial',
      AXIS_COLORS.z,
      AXIS_EMISSIVE_COLORS.z,
    );
    this.axisMaterials = {
      x: this.axisXMaterial,
      y: this.axisYMaterial,
      z: this.axisZMaterial,
    };

    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      this.handlePointer(pointerInfo);
    });
    this.canvas.addEventListener('pointerleave', this.handleCanvasPointerLeave);
  }

  fitToMeshes(meshes: AbstractMesh[]) {
    const hadSelection = this.selectedCandidateId !== null;
    this.clearSelection({ emit: false });
    this.boundsWorld = this.computeBounds(meshes);
    this.candidates = this.boundsWorld ? this.buildCandidates(this.boundsWorld) : [];
    this.rebuildBoundingBoxMesh();
    this.rebuildCandidateMeshes();
    if (hadSelection) {
      this.onOriginChange?.(null);
    }
    this.emitState();
  }

  setEnabled(enabled: boolean) {
    const nextEnabled = Boolean(enabled);
    if (this.config.enabled === nextEnabled) {
      return;
    }

    this.config.enabled = nextEnabled;
    this.root.setEnabled(nextEnabled);
    if (!nextEnabled) {
      this.pointerDown = null;
      this.setHoverTargets(null, null);
    }
    this.emitState();
  }

  setUnitOptions(options: WorkpieceOriginSelectorUnitOptions) {
    if (options.unitLabel !== undefined) {
      this.config.unitLabel = options.unitLabel;
    }

    this.config.coordinateScale = this.getPositiveOption(
      options.coordinateScale,
      this.config.coordinateScale,
    );

    if (this.selectedCandidateId) {
      this.onOriginChange?.(this.getSelection());
    }
    this.emitState();
  }

  clearSelection(options: { emit?: boolean } = {}) {
    const hadSelection = this.selectedCandidateId !== null;
    this.hoveredCandidateId = null;
    this.hoveredAxisId = null;
    this.selectedCandidateId = null;
    this.resetAxisFrame();
    this.activeRotationAxisId = null;
    this.pointerDown = null;
    this.syncCandidateMaterials();
    this.disposeAxisPreviewMeshes();
    this.syncCanvasCursor();

    if (options.emit === false) {
      return;
    }

    if (hadSelection) {
      this.onOriginChange?.(null);
    }
    this.emitState();
  }

  update() {
    void this.camera;
  }

  getState(): WorkpieceOriginSelectorState {
    return {
      enabled: this.config.enabled,
      boundsWorld: this.cloneBounds(this.boundsWorld),
      candidates: this.candidates.map((candidate) => this.cloneCandidate(candidate)),
      hoveredCandidateId: this.hoveredCandidateId,
      hoveredAxisId: this.hoveredAxisId,
      selectedCandidateId: this.selectedCandidateId,
      activeRotationAxisId: this.activeRotationAxisId,
      selection: this.getSelection(),
      axisPreview: this.getAxisPreview(),
    };
  }

  dispose() {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.canvas.removeEventListener('pointerleave', this.handleCanvasPointerLeave);
    this.disposeBoundingBoxMesh();
    this.disposeCandidateMeshes();
    this.disposeAxisPreviewMeshes();
    this.candidateMaterial.dispose();
    this.hoverMaterial.dispose();
    this.selectedMaterial.dispose();
    this.axisXMaterial.dispose();
    this.axisYMaterial.dispose();
    this.axisZMaterial.dispose();
    this.root.dispose();
  }

  selectCandidateById(id: string): boolean {
    if (!this.candidates.some((candidate) => candidate.id === id)) {
      return false;
    }

    if (this.selectedCandidateId === id) {
      this.syncAxisPreview();
      return true;
    }

    this.selectedCandidateId = id;
    this.resetAxisFrame();
    this.clearActiveRotationAxis({ emit: false });
    this.syncCandidateMaterials();
    this.syncAxisPreview();
    this.onOriginChange?.(this.getSelection());
    this.emitState();
    return true;
  }

  selectAxisById(axisId: WorkpieceOriginAxisId): boolean {
    if (!AXIS_IDS.includes(axisId) || !this.getAxisPreview()) {
      return false;
    }

    this.activeRotationAxisId = axisId;
    this.rotateAxisFrame(axisId, WORKPIECE_AXIS_ROTATION_STEP_RADIANS);
    this.syncAxisPreview();
    this.onOriginChange?.(this.getSelection());
    this.emitState();
    return true;
  }

  private emitState() {
    this.onStateChange?.(this.getState());
  }

  private handlePointer(pointerInfo: PointerInfo) {
    if (!this.config.enabled || !this.boundsWorld) {
      return;
    }

    switch (pointerInfo.type) {
      case PointerEventTypes.POINTERMOVE:
        this.handlePointerMove(pointerInfo);
        break;
      case PointerEventTypes.POINTERDOWN:
        this.handlePointerDown(pointerInfo);
        break;
      case PointerEventTypes.POINTERUP:
        this.handlePointerUp(pointerInfo);
        break;
      default:
        break;
    }
  }

  private handlePointerMove(pointerInfo: PointerInfo) {
    const axisId = this.pickAxisId(pointerInfo.event);
    const candidateId = axisId ? null : this.config.showCandidates ? this.pickCandidateId() : null;
    this.setHoverTargets(candidateId, axisId);
  }

  private handlePointerDown(pointerInfo: PointerInfo) {
    const event = pointerInfo.event;
    if (event.button !== 0) {
      return;
    }

    const axisId = this.pickAxisId(event);
    const candidateId = axisId ? null : this.config.showCandidates ? this.pickCandidateId() : null;
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      targetType: candidateId ? 'candidate' : axisId ? 'axis' : null,
      targetId: candidateId ?? axisId,
    };
  }

  private handlePointerUp(pointerInfo: PointerInfo) {
    const event = pointerInfo.event;
    if (event.button !== 0 || !this.pointerDown) {
      this.pointerDown = null;
      return;
    }

    const pointerDown = this.pointerDown;
    this.pointerDown = null;

    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (distance > CLICK_MOVE_THRESHOLD_PIXELS) {
      return;
    }

    const axisId = this.pickAxisId(event);
    const candidateId = axisId ? null : this.config.showCandidates ? this.pickCandidateId() : null;
    const targetType = candidateId ? 'candidate' : axisId ? 'axis' : null;
    const targetId = candidateId ?? axisId;

    if (!targetId || targetType !== pointerDown.targetType || targetId !== pointerDown.targetId) {
      return;
    }

    if (targetType === 'candidate') {
      this.selectCandidateById(targetId);
    } else if (targetType === 'axis') {
      this.selectAxisById(targetId as WorkpieceOriginAxisId);
    }
  }

  private pickCandidateId(): string | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => this.candidateByMesh.has(mesh),
      false,
      this.camera,
    );

    const mesh = pick?.pickedMesh;
    if (!pick?.hit || !mesh) {
      return null;
    }

    return this.candidateByMesh.get(mesh)?.id ?? null;
  }

  private pickAxisId(event: { clientX: number; clientY: number }): WorkpieceOriginAxisId | null {
    const preview = this.getAxisPreview();
    if (!preview) {
      return null;
    }

    const pointer = this.getCanvasPointer(event);
    const hitThresholdPixels = 14;
    let closestAxisId: WorkpieceOriginAxisId | null = null;
    let closestDistance = hitThresholdPixels;

    for (const axisId of AXIS_IDS) {
      const direction = this.getAxisDirectionFromPreview(preview, axisId);
      const start = this.projectToScreen(preview.originWorld);
      const end = this.projectToScreen(
        preview.originWorld.add(direction.scale(preview.axisLengthWorld)),
      );
      const distance = this.distanceToScreenSegment(
        pointer.x,
        pointer.y,
        start.x,
        start.y,
        end.x,
        end.y,
      );

      if (distance <= closestDistance) {
        closestAxisId = axisId;
        closestDistance = distance;
      }
    }

    return closestAxisId;
  }

  private getCanvasPointer(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.canvas.clientWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.clientHeight / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private setHoverTargets(
    candidateId: string | null,
    axisId: WorkpieceOriginAxisId | null,
  ) {
    const nextCandidateId = candidateId && this.candidateMeshes.has(candidateId)
      ? candidateId
      : null;
    const nextAxisId = !nextCandidateId && axisId && AXIS_IDS.includes(axisId)
      ? axisId
      : null;

    if (
      this.hoveredCandidateId === nextCandidateId
      && this.hoveredAxisId === nextAxisId
    ) {
      return;
    }

    this.hoveredCandidateId = nextCandidateId;
    this.hoveredAxisId = nextAxisId;
    this.syncCandidateMaterials();
    this.syncCanvasCursor();
    this.emitState();
  }

  private resetAxisFrame() {
    this.axisXWorld = new Vector3(1, 0, 0);
    this.axisYWorld = new Vector3(0, 1, 0);
    this.axisZWorld = new Vector3(0, 0, 1);
  }

  private rotateAxisFrame(axisId: WorkpieceOriginAxisId, angleRadians: number) {
    const rotationAxis = this.getFrameAxis(axisId);
    const rotation = Quaternion.RotationAxis(rotationAxis, angleRadians);

    this.axisXWorld = this.rotateFrameAxis(this.axisXWorld, rotation);
    this.axisZWorld = this.rotateFrameAxis(this.axisZWorld, rotation);
    this.axisYWorld = this.sanitizeAxisVector(Vector3.Cross(this.axisZWorld, this.axisXWorld));
  }

  private getFrameAxis(axisId: WorkpieceOriginAxisId) {
    switch (axisId) {
      case 'x':
        return this.axisXWorld.clone();
      case 'y':
        return this.axisYWorld.clone();
      case 'z':
      default:
        return this.axisZWorld.clone();
    }
  }

  private rotateFrameAxis(axis: Vector3, rotation: Quaternion) {
    const rotated = Vector3.Zero();
    axis.applyRotationQuaternionToRef(rotation, rotated);
    return this.sanitizeAxisVector(rotated);
  }

  private sanitizeAxisVector(axis: Vector3) {
    const normalized = this.normalizeOrFallback(axis.clone());
    normalized.x = this.sanitizeAxisComponent(normalized.x);
    normalized.y = this.sanitizeAxisComponent(normalized.y);
    normalized.z = this.sanitizeAxisComponent(normalized.z);
    return normalized;
  }

  private sanitizeAxisComponent(value: number) {
    if (Math.abs(value) < 1e-10) {
      return 0;
    }

    if (Math.abs(value - 1) < 1e-10) {
      return 1;
    }

    if (Math.abs(value + 1) < 1e-10) {
      return -1;
    }

    return value;
  }

  private getAxisDirectionFromPreview(
    preview: WorkpieceOriginAxisPreview,
    axisId: WorkpieceOriginAxisId,
  ) {
    switch (axisId) {
      case 'x':
        return this.normalizeOrFallback(preview.axisXWorld);
      case 'y':
        return this.normalizeOrFallback(preview.axisYWorld);
      case 'z':
      default:
        return this.normalizeOrFallback(preview.axisZWorld);
    }
  }

  private projectToScreen(point: Vector3) {
    return Vector3.Project(
      point,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight),
    );
  }

  private distanceToScreenSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared <= BOUND_EPSILON) {
      return Math.hypot(px - ax, py - ay);
    }

    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
    const closestX = ax + abx * t;
    const closestY = ay + aby * t;
    return Math.hypot(px - closestX, py - closestY);
  }

  private getSelection(): WorkpieceOriginSelection | null {
    if (!this.selectedCandidateId) {
      return null;
    }

    const candidate = this.candidates.find((item) => item.id === this.selectedCandidateId);
    if (!candidate) {
      return null;
    }

    const positionWorld = candidate.positionWorld.clone();
    return {
      id: candidate.id,
      kind: candidate.kind,
      positionWorld,
      positionValue: {
        x: positionWorld.x * this.config.coordinateScale,
        y: positionWorld.y * this.config.coordinateScale,
        z: positionWorld.z * this.config.coordinateScale,
      },
      axisXWorld: this.axisXWorld.clone(),
      axisYWorld: this.axisYWorld.clone(),
      axisZWorld: this.axisZWorld.clone(),
    };
  }

  private getAxisPreview(): WorkpieceOriginAxisPreview | null {
    if (!this.boundsWorld) {
      return null;
    }

    const selection = this.getSelection();
    if (!selection) {
      return null;
    }

    return {
      originWorld: selection.positionWorld.clone(),
      axisLengthWorld: this.resolveAxisLength(this.boundsWorld),
      axisXWorld: selection.axisXWorld.clone(),
      axisYWorld: selection.axisYWorld.clone(),
      axisZWorld: selection.axisZWorld.clone(),
    };
  }

  private syncAxisPreview() {
    this.disposeAxisPreviewMeshes();

    if (!this.config.showAxisPreview) {
      return;
    }

    const bounds = this.boundsWorld;
    const preview = this.getAxisPreview();
    if (!bounds || !preview) {
      return;
    }

    const axisDefinitions = [
      {
        id: 'x' as const,
        material: this.axisMaterials.x,
        direction: preview.axisXWorld,
      },
      {
        id: 'y' as const,
        material: this.axisMaterials.y,
        direction: preview.axisYWorld,
      },
      {
        id: 'z' as const,
        material: this.axisMaterials.z,
        direction: preview.axisZWorld,
      },
    ];
    const tipDiameter = Math.max(
      this.resolveHandleRadius(bounds) * 0.9,
      preview.axisLengthWorld * 0.035,
    );
    const shaftRadius = Math.max(tipDiameter * 0.16, preview.axisLengthWorld * 0.006);

    for (const axis of axisDefinitions) {
      const direction = this.normalizeOrFallback(axis.direction);
      const end = preview.originWorld.add(direction.scale(preview.axisLengthWorld));
      const shaft = MeshBuilder.CreateTube(
        `workpieceOriginSelector.axis.${axis.id}`,
        {
          path: [preview.originWorld, end],
          radius: shaftRadius,
          tessellation: 10,
        },
        this.scene,
      );
      shaft.parent = this.root;
      shaft.material = axis.material;
      shaft.isPickable = false;
      shaft.renderingGroupId = 2;
      shaft.alwaysSelectAsActiveMesh = true;
      shaft.metadata = {
        ...(shaft.metadata ?? {}),
        workpieceOriginAxisId: axis.id,
      };
      this.axisPreviewMeshes.push(shaft);

      const tip = MeshBuilder.CreateSphere(
        `workpieceOriginSelector.axisTip.${axis.id}`,
        {
          diameter: tipDiameter,
          segments: 12,
        },
        this.scene,
      );
      tip.parent = this.root;
      tip.position.copyFrom(end);
      tip.material = axis.material;
      tip.isPickable = false;
      tip.renderingGroupId = 2;
      tip.alwaysSelectAsActiveMesh = true;
      tip.metadata = {
        ...(tip.metadata ?? {}),
        workpieceOriginAxisId: axis.id,
      };
      this.axisPreviewMeshes.push(tip);
    }
  }

  private clearActiveRotationAxis(options: { emit?: boolean } = {}) {
    const hadActiveAxis = this.activeRotationAxisId !== null;
    this.activeRotationAxisId = null;

    if (hadActiveAxis && options.emit !== false) {
      this.emitState();
    }
  }

  private computeBounds(meshes: AbstractMesh[]): WorkpieceBoundsWorld | null {
    if (meshes.length === 0) {
      return null;
    }

    const min = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const max = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    let hasBounds = false;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const boundingInfo = mesh.getBoundingInfo();
      min.minimizeInPlace(boundingInfo.boundingBox.minimumWorld);
      max.maximizeInPlace(boundingInfo.boundingBox.maximumWorld);
      hasBounds = true;
    }

    if (!hasBounds || !this.isFiniteVector(min) || !this.isFiniteVector(max)) {
      return null;
    }

    return this.expandDegenerateBounds(min, max);
  }

  private expandDegenerateBounds(min: Vector3, max: Vector3): WorkpieceBoundsWorld {
    const safeMin = min.clone();
    const safeMax = max.clone();
    const rawSize = safeMax.subtract(safeMin);
    const rawDiagonal = rawSize.length();
    const safeThickness = Math.max(rawDiagonal * 0.001, MIN_SAFE_THICKNESS_WORLD);

    this.expandAxisIfDegenerate(safeMin, safeMax, 'x', safeThickness);
    this.expandAxisIfDegenerate(safeMin, safeMax, 'y', safeThickness);
    this.expandAxisIfDegenerate(safeMin, safeMax, 'z', safeThickness);

    const center = safeMin.add(safeMax).scale(0.5);
    const size = safeMax.subtract(safeMin);
    return {
      min: safeMin,
      max: safeMax,
      center,
      size,
      diagonal: size.length(),
    };
  }

  private expandAxisIfDegenerate(
    min: Vector3,
    max: Vector3,
    axis: 'x' | 'y' | 'z',
    safeThickness: number,
  ) {
    if (Math.abs(max[axis] - min[axis]) > BOUND_EPSILON) {
      return;
    }

    const center = (min[axis] + max[axis]) * 0.5;
    min[axis] = center - safeThickness * 0.5;
    max[axis] = center + safeThickness * 0.5;
  }

  private buildCandidates(bounds: WorkpieceBoundsWorld): WorkpieceOriginCandidate[] {
    const enabledKinds = new Set(this.config.candidateKinds);
    const candidates: WorkpieceOriginCandidate[] = [];
    const min = bounds.min;
    const max = bounds.max;
    const center = bounds.center;

    if (enabledKinds.has('corner')) {
      for (const xSide of this.getAxisSides('x', min.x, max.x)) {
        for (const ySide of this.getAxisSides('y', min.y, max.y)) {
          for (const zSide of this.getAxisSides('z', min.z, max.z)) {
            candidates.push(this.createCandidate(
              `corner:${xSide.label}:${ySide.label}:${zSide.label}`,
              'corner',
              new Vector3(xSide.value, ySide.value, zSide.value),
              new Vector3(xSide.sign, ySide.sign, zSide.sign),
            ));
          }
        }
      }
    }

    if (enabledKinds.has('edge-center')) {
      for (const ySide of this.getAxisSides('y', min.y, max.y)) {
        for (const zSide of this.getAxisSides('z', min.z, max.z)) {
          candidates.push(this.createCandidate(
            `edge-center:x:${ySide.label}:${zSide.label}`,
            'edge-center',
            new Vector3(center.x, ySide.value, zSide.value),
            new Vector3(0, ySide.sign, zSide.sign),
          ));
        }
      }

      for (const xSide of this.getAxisSides('x', min.x, max.x)) {
        for (const zSide of this.getAxisSides('z', min.z, max.z)) {
          candidates.push(this.createCandidate(
            `edge-center:y:${xSide.label}:${zSide.label}`,
            'edge-center',
            new Vector3(xSide.value, center.y, zSide.value),
            new Vector3(xSide.sign, 0, zSide.sign),
          ));
        }
      }

      for (const xSide of this.getAxisSides('x', min.x, max.x)) {
        for (const ySide of this.getAxisSides('y', min.y, max.y)) {
          candidates.push(this.createCandidate(
            `edge-center:z:${xSide.label}:${ySide.label}`,
            'edge-center',
            new Vector3(xSide.value, ySide.value, center.z),
            new Vector3(xSide.sign, ySide.sign, 0),
          ));
        }
      }
    }

    if (enabledKinds.has('face-center')) {
      candidates.push(
        this.createCandidate(
          'face-center:min-x',
          'face-center',
          new Vector3(min.x, center.y, center.z),
          new Vector3(-1, 0, 0),
        ),
        this.createCandidate(
          'face-center:max-x',
          'face-center',
          new Vector3(max.x, center.y, center.z),
          new Vector3(1, 0, 0),
        ),
        this.createCandidate(
          'face-center:min-y',
          'face-center',
          new Vector3(center.x, min.y, center.z),
          new Vector3(0, -1, 0),
        ),
        this.createCandidate(
          'face-center:max-y',
          'face-center',
          new Vector3(center.x, max.y, center.z),
          new Vector3(0, 1, 0),
        ),
        this.createCandidate(
          'face-center:min-z',
          'face-center',
          new Vector3(center.x, center.y, min.z),
          new Vector3(0, 0, -1),
        ),
        this.createCandidate(
          'face-center:max-z',
          'face-center',
          new Vector3(center.x, center.y, max.z),
          new Vector3(0, 0, 1),
        ),
      );
    }

    return candidates;
  }

  private getAxisSides(axis: 'x' | 'y' | 'z', min: number, max: number) {
    return [
      { label: `min-${axis}`, value: min, sign: -1 },
      { label: `max-${axis}`, value: max, sign: 1 },
    ];
  }

  private createCandidate(
    id: string,
    kind: WorkpieceOriginCandidateKind,
    positionWorld: Vector3,
    normalWorld: Vector3,
  ): WorkpieceOriginCandidate {
    return {
      id,
      kind,
      positionWorld,
      normalWorld: this.normalizeOrFallback(normalWorld),
    };
  }

  private rebuildBoundingBoxMesh() {
    this.disposeBoundingBoxMesh();

    if (!this.boundsWorld || !this.config.showBoundingBox) {
      return;
    }

    const { min, max } = this.boundsWorld;
    const c000 = new Vector3(min.x, min.y, min.z);
    const c100 = new Vector3(max.x, min.y, min.z);
    const c110 = new Vector3(max.x, max.y, min.z);
    const c010 = new Vector3(min.x, max.y, min.z);
    const c001 = new Vector3(min.x, min.y, max.z);
    const c101 = new Vector3(max.x, min.y, max.z);
    const c111 = new Vector3(max.x, max.y, max.z);
    const c011 = new Vector3(min.x, max.y, max.z);

    this.boundingBoxMesh = MeshBuilder.CreateLineSystem(
      'workpieceOriginSelector.boundingBox',
      {
        lines: [
          [c000, c100],
          [c100, c110],
          [c110, c010],
          [c010, c000],
          [c001, c101],
          [c101, c111],
          [c111, c011],
          [c011, c001],
          [c000, c001],
          [c100, c101],
          [c110, c111],
          [c010, c011],
        ],
      },
      this.scene,
    );
    this.boundingBoxMesh.parent = this.root;
    this.boundingBoxMesh.color = new Color3(0.08, 0.62, 0.78);
    this.boundingBoxMesh.alpha = 0.92;
    this.boundingBoxMesh.isPickable = false;
    this.boundingBoxMesh.renderingGroupId = 2;
    this.boundingBoxMesh.alwaysSelectAsActiveMesh = true;
  }

  private rebuildCandidateMeshes() {
    this.disposeCandidateMeshes();

    if (!this.boundsWorld || !this.config.showCandidates) {
      return;
    }

    const radius = this.resolveHandleRadius(this.boundsWorld);
    for (const candidate of this.candidates) {
      const mesh = MeshBuilder.CreateSphere(
        `workpieceOriginSelector.candidate.${candidate.id}`,
        {
          diameter: radius * 2,
          segments: 16,
        },
        this.scene,
      );
      mesh.parent = this.root;
      mesh.position.copyFrom(candidate.positionWorld);
      mesh.material = this.candidateMaterial;
      mesh.isPickable = true;
      mesh.renderingGroupId = 2;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.metadata = {
        ...(mesh.metadata ?? {}),
        workpieceOriginCandidateId: candidate.id,
        workpieceOriginCandidateKind: candidate.kind,
      };

      this.candidateMeshes.set(candidate.id, mesh);
      this.candidateByMesh.set(mesh, candidate);
    }
  }

  private syncCandidateMaterials() {
    for (const [id, mesh] of this.candidateMeshes) {
      if (id === this.selectedCandidateId) {
        mesh.material = this.selectedMaterial;
      } else if (id === this.hoveredCandidateId) {
        mesh.material = this.hoverMaterial;
      } else {
        mesh.material = this.candidateMaterial;
      }
    }
  }

  private syncCanvasCursor() {
    this.canvas.style.cursor = this.hoveredCandidateId || this.hoveredAxisId ? 'pointer' : '';
  }

  private disposeBoundingBoxMesh() {
    this.boundingBoxMesh?.dispose();
    this.boundingBoxMesh = null;
  }

  private disposeCandidateMeshes() {
    for (const mesh of this.candidateMeshes.values()) {
      mesh.material = null;
      mesh.dispose();
    }

    this.candidateMeshes.clear();
    this.candidateByMesh.clear();
  }

  private disposeAxisPreviewMeshes() {
    for (const mesh of this.axisPreviewMeshes) {
      mesh.dispose();
    }

    this.axisPreviewMeshes.length = 0;
    this.hoveredAxisId = null;
    this.syncCanvasCursor();
  }

  private resolveHandleRadius(bounds: WorkpieceBoundsWorld) {
    const minRadius = Math.min(
      this.config.minHandleRadiusWorld,
      this.config.maxHandleRadiusWorld,
    );
    const maxRadius = Math.max(
      this.config.minHandleRadiusWorld,
      this.config.maxHandleRadiusWorld,
    );

    return Math.max(
      minRadius,
      Math.min(maxRadius, bounds.diagonal * this.config.handleRadiusRatio),
    );
  }

  private resolveAxisLength(bounds: WorkpieceBoundsWorld) {
    return Math.max(
      this.config.minAxisLengthWorld,
      bounds.diagonal * this.config.axisLengthRatio,
    );
  }

  private createCandidateMaterial(
    name: string,
    diffuseColor: Color3,
    emissiveColor: Color3,
  ) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = diffuseColor;
    material.emissiveColor = emissiveColor;
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    return material;
  }

  private cloneBounds(bounds: WorkpieceBoundsWorld | null): WorkpieceBoundsWorld | null {
    if (!bounds) {
      return null;
    }

    return {
      min: bounds.min.clone(),
      max: bounds.max.clone(),
      center: bounds.center.clone(),
      size: bounds.size.clone(),
      diagonal: bounds.diagonal,
    };
  }

  private cloneCandidate(candidate: WorkpieceOriginCandidate): WorkpieceOriginCandidate {
    return {
      id: candidate.id,
      kind: candidate.kind,
      positionWorld: candidate.positionWorld.clone(),
      normalWorld: candidate.normalWorld.clone(),
    };
  }

  private normalizeOrFallback(vector: Vector3) {
    if (vector.lengthSquared() <= BOUND_EPSILON) {
      return new Vector3(0, 0, 1);
    }

    return vector.normalize();
  }

  private isFiniteVector(vector: Vector3) {
    return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
  }

  private getPositiveOption(value: number | undefined, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
