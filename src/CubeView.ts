import {
  Animation,
  ArcRotateCamera,
  Color3,
  Color4,
  CreateLines,
  CubicEase,
  DynamicTexture,
  EasingFunction,
  Engine,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  PointerInfo,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import {
  icon_home,
  icon_home_hover,
  texture_back,
  texture_bottom,
  texture_front,
  texture_left,
  texture_right,
  texture_top,
} from './textures';

export interface CubeViewOrientation {
  alpha: number;
  beta: number;
}

export type CubeViewChangeSource = 'drag' | 'click' | 'home';

export type CubeViewChangePhase = 'start' | 'update' | 'end';

export interface CubeViewOrientationChangeEvent {
  orientation: CubeViewOrientation;
  source: CubeViewChangeSource;
  phase: CubeViewChangePhase;
}

export interface CubeViewOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  aspect?: number;
  hoverColor?: string;
  cubeSize?: number;
  zoom?: number;
  antialias?: boolean;
  onUpdateAngles?: (beta: number, alpha: number) => void;
  onOrientationChange?: (event: CubeViewOrientationChangeEvent) => void;
}

interface ControllerInfo {
  mesh: Mesh;
  name: string;
}

// Z-up camera: X+=right, Y+=back, Z+=up
// VIEW_ANGLES stores [beta, alpha] for ArcRotateCamera.
const VIEW_ANGLES: Record<string, [number, number]> = {
  // Faces
  f0: [Math.PI * 0.5, 0],                    // RIGHT  (X+)
  f1: [0, 0],                                // TOP    (Z+)
  f2: [Math.PI * 0.5, Math.PI * 0.5],        // FRONT  (-Y)
  f3: [Math.PI * 0.5, Math.PI],              // LEFT   (-X)
  f4: [Math.PI, 0],                          // BOTTOM (Z-)
  f5: [Math.PI * 0.5, -Math.PI * 0.5],       // BACK   (Y+)
  // Corners
  c0: [Math.PI * 0.25, Math.PI * 0.25],      // FRONT,TOP,RIGHT
  c1: [Math.PI * 0.75, Math.PI * 0.25],      // FRONT,BOTTOM,RIGHT
  c2: [Math.PI * 0.75, Math.PI * 0.75],      // FRONT,BOTTOM,LEFT
  c3: [Math.PI * 0.25, Math.PI * 0.75],      // FRONT,TOP,LEFT
  c4: [Math.PI * 0.25, -Math.PI * 0.25],     // BACK,TOP,RIGHT
  c5: [Math.PI * 0.75, -Math.PI * 0.25],     // BACK,BOTTOM,RIGHT
  c6: [Math.PI * 0.75, -Math.PI * 0.75],     // BACK,BOTTOM,LEFT
  c7: [Math.PI * 0.25, -Math.PI * 0.75],     // BACK,TOP,LEFT
  // Edges
  e0: [Math.PI * 0.25, Math.PI * 0.5],       // TOP,FRONT
  e1: [Math.PI * 0.75, Math.PI * 0.5],       // BOTTOM,FRONT
  e2: [Math.PI * 0.25, -Math.PI * 0.5],      // TOP,BACK
  e3: [Math.PI * 0.75, -Math.PI * 0.5],      // BOTTOM,BACK
  e4: [Math.PI * 0.5, Math.PI * 0.25],       // FRONT,RIGHT
  e5: [Math.PI * 0.5, Math.PI * 0.75],       // FRONT,LEFT
  e6: [Math.PI * 0.5, -Math.PI * 0.25],      // BACK,RIGHT
  e7: [Math.PI * 0.5, -Math.PI * 0.75],      // BACK,LEFT
  e8: [Math.PI * 0.25, 0],                   // TOP,RIGHT
  e9: [Math.PI * 0.25, Math.PI],             // TOP,LEFT
  e10: [Math.PI * 0.75, 0],                  // BOTTOM,RIGHT
  e11: [Math.PI * 0.75, Math.PI],            // BOTTOM,LEFT
};

const CLICK_DRAG_THRESHOLD_PX = 6;

export class CubeView {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private canvas: HTMLCanvasElement;
  private controllers: TransformNode;
  private controllerMeshes: ControllerInfo[] = [];
  private intersected: Mesh | null = null;
  private hoverColor: Color3;
  private cubeSize: number;
  private onUpdateAngles?: (beta: number, alpha: number) => void;
  private onOrientationChange?: (event: CubeViewOrientationChangeEvent) => void;
  private homeButton: HTMLImageElement | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isAnimating = false;
  private pointerDownPosition: { x: number; y: number } | null = null;
  private isDragging = false;
  private activeInteractionSource: CubeViewChangeSource | null = null;

  constructor(options: CubeViewOptions) {
    const {
      canvas,
      width = 200,
      height = 200,
      aspect,
      hoverColor = '#0033ff',
      cubeSize = 2,
      zoom = 8,
      antialias = false,
      onUpdateAngles,
      onOrientationChange,
    } = options;

    this.canvas = canvas;
    this.cubeSize = cubeSize;
    this.onUpdateAngles = onUpdateAngles;
    this.onOrientationChange = onOrientationChange;
    this.hoverColor = Color3.FromHexString(hoverColor.startsWith('#') ? hoverColor : `#${hoverColor}`);

    const effectiveHeight = aspect ? width / aspect : height;
    canvas.width = width;
    canvas.height = effectiveHeight;

    this.createContainer(canvas);

    this.engine = new Engine(canvas, antialias, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.useRightHandedSystem = true;
    this.scene.setRenderingAutoClearDepthStencil(1, false);

    this.camera = new ArcRotateCamera(
      'camera',
      Math.PI * 0.25,
      Math.PI * 0.25,
      zoom,
      Vector3.Zero(),
      this.scene
    );
    this.camera.upVector = new Vector3(0, 0, 1);
    this.camera.fov = 50 * Math.PI / 180;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    this.camera.lowerRadiusLimit = zoom;
    this.camera.upperRadiusLimit = zoom;
    this.camera.panningSensibility = 0;
    this.camera.lowerBetaLimit = null;
    this.camera.upperBetaLimit = null;
    this.camera.allowUpsideDown = true;
    this.camera.attachControl(canvas, true);

    this.controllers = new TransformNode('controllers', this.scene);
    this.createAxes();
    this.createCubeFaces();
    this.createControllers();

    this.setupPointerEvents();
    this.camera.onViewMatrixChangedObservable.add(() => {
      if (this.activeInteractionSource) {
        this.emitOrientationChange('update', this.activeInteractionSource);
      }
    });

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.engine.resize();
    });
    this.resizeObserver.observe(canvas);
  }

  private createContainer(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }

    this.container = document.createElement('div');
    this.container.className = 'cube-view-container';
    this.container.style.position = 'relative';
    this.container.style.display = 'inline-block';
    this.container.style.width = `${canvas.width}px`;
    this.container.style.height = `${canvas.height}px`;

    parent.insertBefore(this.container, canvas);
    this.container.appendChild(canvas);

    this.homeButton = document.createElement('img');
    this.homeButton.src = icon_home;
    this.homeButton.className = 'button-home';
    this.homeButton.style.position = 'absolute';
    this.homeButton.style.top = '0px';
    this.homeButton.style.left = '0px';
    this.homeButton.style.width = '12%';
    this.homeButton.style.minWidth = '20px';
    this.homeButton.style.opacity = '0';
    this.homeButton.style.transition = '200ms ease-in-out';
    this.homeButton.style.cursor = 'pointer';
    this.homeButton.style.zIndex = '10';

    this.homeButton.addEventListener('mouseover', () => {
      if (this.homeButton) {
        this.homeButton.src = icon_home_hover;
      }
    });
    this.homeButton.addEventListener('mouseout', () => {
      if (this.homeButton) {
        this.homeButton.src = icon_home;
      }
    });
    this.homeButton.addEventListener('click', () => this.clickHome());

    this.container.appendChild(this.homeButton);

    this.container.addEventListener('mouseenter', () => {
      if (this.homeButton) {
        this.homeButton.style.opacity = '1';
      }
    });
    this.container.addEventListener('mouseleave', () => {
      if (this.homeButton) {
        this.homeButton.style.opacity = '0';
      }
    });
  }

  private createAxes() {
    const size = this.cubeSize;
    const origin = new Vector3(-size / 2 - 0.01, -size / 2 - 0.01, -size / 2 - 0.01);
    const axisLength = size + size / 6;
    const coneHeight = size * 0.12;
    const coneRadius = size * 0.04;

    const axes: [Vector3, Color3, string][] = [
      [new Vector3(1, 0, 0), new Color3(1, 0, 0), 'X'],
      [new Vector3(0, 1, 0), new Color3(0, 1, 0), 'Y'],
      [new Vector3(0, 0, 1), new Color3(0, 0, 1), 'Z'],
    ];

    for (const [dir, color, label] of axes) {
      const end = origin.add(dir.scale(axisLength));
      const line = CreateLines('axisLine', { points: [origin, end], updatable: false }, this.scene);
      line.color = color;
      line.isPickable = false;

      const cone = MeshBuilder.CreateCylinder('axisCone', {
        diameterTop: 0,
        diameterBottom: coneRadius * 2,
        height: coneHeight,
        tessellation: 12,
      }, this.scene);
      const coneMat = new StandardMaterial('coneMat', this.scene);
      coneMat.diffuseColor = color;
      coneMat.emissiveColor = color;
      coneMat.disableLighting = true;
      cone.material = coneMat;
      cone.isPickable = false;
      cone.position = end.add(dir.scale(coneHeight / 2));

      if (dir.x === 1) {
        cone.rotation.z = -Math.PI / 2;
      } else if (dir.z === 1) {
        cone.rotation.x = Math.PI / 2;
      }

      const labelSize = size * 0.2;
      const labelPlane = MeshBuilder.CreatePlane(`axisLabel_${label}`, { size: labelSize }, this.scene);
      const dtex = new DynamicTexture(`dtex_${label}`, 64, this.scene, false);
      dtex.hasAlpha = true;

      const ctx = dtex.getContext();
      ctx.clearRect(0, 0, 64, 64);
      ctx.save();
      ctx.translate(64, 0);
      ctx.scale(-1, 1);
      ctx.font = 'bold 44px Arial';
      ctx.fillStyle = color.toHexString();
      (ctx as CanvasRenderingContext2D & { textAlign: string }).textAlign = 'center';
      (ctx as CanvasRenderingContext2D & { textBaseline: string }).textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      ctx.restore();
      dtex.update();

      const labelMat = new StandardMaterial(`labelMat_${label}`, this.scene);
      labelMat.diffuseTexture = dtex;
      labelMat.emissiveTexture = dtex;
      labelMat.useAlphaFromDiffuseTexture = true;
      labelMat.disableLighting = true;
      labelMat.backFaceCulling = false;
      labelPlane.material = labelMat;
      labelPlane.isPickable = false;
      labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      labelPlane.position = end.add(dir.scale(coneHeight + labelSize * 0.6));
    }
  }

  private createTexturedPlane(size: number, textureData: string, doubleSided: boolean = true): Mesh {
    const plane = MeshBuilder.CreatePlane('plane', {
      size,
      sideOrientation: doubleSided ? Mesh.DOUBLESIDE : Mesh.FRONTSIDE,
    }, this.scene);
    const mat = new StandardMaterial('mat', this.scene);
    mat.diffuseTexture = new Texture(textureData, this.scene);
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = new Texture(textureData, this.scene);
    mat.emissiveTexture.hasAlpha = true;
    mat.disableLighting = true;
    mat.needDepthPrePass = true;
    plane.material = mat;
    plane.isPickable = false;
    return plane;
  }

  private createCubeFaces() {
    const size = this.cubeSize;
    const half = size / 2;

    const top = this.createTexturedPlane(size, texture_top);
    top.position.z = half;
    top.rotation.z = Math.PI / 2;

    const bottom = this.createTexturedPlane(size, texture_bottom);
    bottom.position.z = -half;
    bottom.rotation.x = Math.PI;
    bottom.rotation.z = -Math.PI / 2;

    const front = this.createTexturedPlane(size, texture_front);
    front.position.y = -half;
    front.rotation.x = Math.PI / 2;

    const back = this.createTexturedPlane(size, texture_back);
    back.position.y = half;
    back.rotation.x = -Math.PI / 2;
    back.rotation.z = Math.PI;

    const right = this.createTexturedPlane(size, texture_right);
    right.position.x = half;
    right.rotation.y = Math.PI / 2;
    right.rotation.z = Math.PI / 2;

    const left = this.createTexturedPlane(size, texture_left);
    left.position.x = -half;
    left.rotation.y = -Math.PI / 2;
    left.rotation.z = -Math.PI / 2;
  }

  private createControllerBox(
    name: string,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    posX: number,
    posY: number,
    posZ: number
  ): Mesh {
    const box = MeshBuilder.CreateBox(name, {
      width: sizeX,
      height: sizeY,
      depth: sizeZ,
    }, this.scene);

    const mat = new StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseColor = this.hoverColor;
    mat.emissiveColor = this.hoverColor;
    mat.alpha = 0.5;
    mat.disableLighting = true;
    box.material = mat;
    box.visibility = 0.001;
    box.renderingGroupId = 1;
    box.position.set(posX, posY, posZ);
    box.parent = this.controllers;

    this.controllerMeshes.push({ mesh: box, name });
    return box;
  }

  private createControllers() {
    const size = this.cubeSize;
    const half = size / 2;
    const quarter = size / 4;

    const cornerPositions: [string, number, number, number][] = [
      ['c0', 1, -1, 1],
      ['c1', 1, -1, -1],
      ['c2', -1, -1, -1],
      ['c3', -1, -1, 1],
      ['c4', 1, 1, 1],
      ['c5', 1, 1, -1],
      ['c6', -1, 1, -1],
      ['c7', -1, 1, 1],
    ];

    for (const [name, x, y, z] of cornerPositions) {
      const scaledX = x * 1.01;
      const scaledY = y * 1.01;
      const scaledZ = z * 1.01;
      const px = x > 0 ? half * scaledX - quarter / 2 : half * scaledX + quarter / 2;
      const py = y > 0 ? half * scaledY - quarter / 2 : half * scaledY + quarter / 2;
      const pz = z > 0 ? half * scaledZ - quarter / 2 : half * scaledZ + quarter / 2;
      this.createControllerBox(name, quarter, quarter, quarter, px, py, pz);
    }

    const edgePositions: [string, number, number, number][] = [
      ['e0', 0, -1, 1],
      ['e1', 0, -1, -1],
      ['e2', 0, 1, 1],
      ['e3', 0, 1, -1],
      ['e4', 1, -1, 0],
      ['e5', -1, -1, 0],
      ['e6', 1, 1, 0],
      ['e7', -1, 1, 0],
      ['e8', 1, 0, 1],
      ['e9', -1, 0, 1],
      ['e10', 1, 0, -1],
      ['e11', -1, 0, -1],
    ];

    for (const [name, x, y, z] of edgePositions) {
      const scaledX = x * 1.01;
      const scaledY = y * 1.01;
      const scaledZ = z * 1.01;

      let sx = quarter;
      let sy = quarter;
      let sz = quarter;
      if (x === 0) sx = half;
      if (y === 0) sy = half;
      if (z === 0) sz = half;

      const px = x > 0 ? half * scaledX - sx / 2 : x === 0 ? 0 : half * scaledX + sx / 2;
      const py = y > 0 ? half * scaledY - sy / 2 : y === 0 ? 0 : half * scaledY + sy / 2;
      const pz = z > 0 ? half * scaledZ - sz / 2 : z === 0 ? 0 : half * scaledZ + sz / 2;

      this.createControllerBox(name, sx, sy, sz, px, py, pz);
    }

    const facePositions: [string, number, number, number][] = [
      ['f0', 1, 0, 0],
      ['f1', 0, 0, 1],
      ['f2', 0, -1, 0],
      ['f3', -1, 0, 0],
      ['f4', 0, 0, -1],
      ['f5', 0, 1, 0],
    ];

    for (const [name, x, y, z] of facePositions) {
      const scaledX = x * 1.01;
      const scaledY = y * 1.01;
      const scaledZ = z * 1.01;

      let sx = quarter;
      let sy = quarter;
      let sz = quarter;
      if (x === 0) {
        sy = half;
        sz = half;
      }
      if (y === 0) {
        sx = half;
        sz = half;
      }
      if (z === 0) {
        sx = half;
        sy = half;
      }

      const px = x > 0 ? half * scaledX - sx / 2 : x === 0 ? 0 : half * scaledX + sx / 2;
      const py = y > 0 ? half * scaledY - sy / 2 : y === 0 ? 0 : half * scaledY + sy / 2;
      const pz = z > 0 ? half * scaledZ - sz / 2 : z === 0 ? 0 : half * scaledZ + sz / 2;

      this.createControllerBox(name, sx, sy, sz, px, py, pz);
    }
  }

  private setupPointerEvents() {
    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          this.pointerDownPosition = {
            x: this.scene.pointerX,
            y: this.scene.pointerY,
          };
          this.isDragging = false;
          break;

        case PointerEventTypes.POINTERMOVE:
          this.handleHover();
          if (this.pointerDownPosition && !this.isDragging) {
            const deltaX = this.scene.pointerX - this.pointerDownPosition.x;
            const deltaY = this.scene.pointerY - this.pointerDownPosition.y;
            if (Math.hypot(deltaX, deltaY) >= CLICK_DRAG_THRESHOLD_PX) {
              this.stopCameraAnimation();
              this.isDragging = true;
              this.beginInteraction('drag');
            }
          }
          break;

        case PointerEventTypes.POINTERUP:
          if (this.isDragging) {
            this.endInteraction();
          } else if (this.intersected) {
            this.handleClick(this.intersected.name);
          }
          this.pointerDownPosition = null;
          this.isDragging = false;
          break;
      }
    });

    this.scene.registerBeforeRender(() => {
      this.handleHover();
    });
  }

  private handleHover() {
    const pickResult = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => this.controllerMeshes.some((controller) => controller.mesh === mesh)
    );

    if (pickResult?.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh as Mesh;
      if (this.intersected !== mesh) {
        if (this.intersected) {
          this.intersected.visibility = 0.001;
        }
        this.intersected = mesh;
        mesh.visibility = 1;
      }
      return;
    }

    if (this.intersected) {
      this.intersected.visibility = 0.001;
      this.intersected = null;
    }
  }

  private handleClick(name: string) {
    const angles = VIEW_ANGLES[name];
    if (!angles) {
      return;
    }

    const [beta, alpha] = angles;
    this.animateToOrientation({ alpha, beta }, 'click');
  }

  private animateToOrientation(
    orientation: CubeViewOrientation,
    source: Exclude<CubeViewChangeSource, 'drag'>
  ) {
    this.stopCameraAnimation();
    this.beginInteraction(source);

    const targetBeta = orientation.beta;
    const finalAlpha = this.normalizeAlpha(orientation.alpha);
    const currentOrientation = this.getOrientation();

    if (
      Math.abs(finalAlpha - currentOrientation.alpha) < Number.EPSILON &&
      Math.abs(targetBeta - currentOrientation.beta) < Number.EPSILON
    ) {
      this.endInteraction();
      return;
    }

    this.isAnimating = true;

    const fps = 60;
    const totalFrames = 30;

    const alphaAnim = new Animation(
      'alphaAnim',
      'alpha',
      fps,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    alphaAnim.setKeys([
      { frame: 0, value: this.camera.alpha },
      { frame: totalFrames, value: finalAlpha },
    ]);

    const betaAnim = new Animation(
      'betaAnim',
      'beta',
      fps,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    betaAnim.setKeys([
      { frame: 0, value: this.camera.beta },
      { frame: totalFrames, value: targetBeta },
    ]);

    const easingFunction = new CubicEase();
    easingFunction.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    alphaAnim.setEasingFunction(easingFunction);
    betaAnim.setEasingFunction(easingFunction);

    this.scene.beginDirectAnimation(
      this.camera,
      [alphaAnim, betaAnim],
      0,
      totalFrames,
      false,
      1,
      () => {
        this.isAnimating = false;
        this.endInteraction();
      }
    );
  }

  private beginInteraction(source: CubeViewChangeSource) {
    if (this.activeInteractionSource === source) {
      return;
    }

    if (this.activeInteractionSource) {
      this.endInteraction();
    }

    this.activeInteractionSource = source;
    this.emitOrientationChange('start', source);
  }

  private endInteraction() {
    if (!this.activeInteractionSource) {
      return;
    }

    const source = this.activeInteractionSource;
    this.activeInteractionSource = null;
    this.emitOrientationChange('end', source);
  }

  private emitOrientationChange(phase: CubeViewChangePhase, source: CubeViewChangeSource) {
    const orientation = this.getOrientation();

    if (this.onOrientationChange) {
      this.onOrientationChange({ orientation, source, phase });
    }

    if (phase !== 'start' && this.onUpdateAngles) {
      this.onUpdateAngles(orientation.beta, orientation.alpha);
    }
  }

  private normalizeAlpha(targetAlpha: number) {
    let deltaAlpha = targetAlpha - this.camera.alpha;
    while (deltaAlpha > Math.PI) deltaAlpha -= 2 * Math.PI;
    while (deltaAlpha < -Math.PI) deltaAlpha += 2 * Math.PI;
    return this.camera.alpha + deltaAlpha;
  }

  private stopCameraAnimation() {
    if (!this.isAnimating) {
      return;
    }

    this.scene.stopAnimation(this.camera);
    this.isAnimating = false;

    if (this.activeInteractionSource && this.activeInteractionSource !== 'drag') {
      this.endInteraction();
    }
  }

  clickHome() {
    const beta = Math.PI * 0.25;
    const alpha = Math.PI * 0.25;
    this.animateToOrientation({ alpha, beta }, 'home');
  }

  getOrientation(): CubeViewOrientation {
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
    };
  }

  setOrientation(orientation: CubeViewOrientation) {
    this.stopCameraAnimation();
    if (this.activeInteractionSource === 'drag') {
      this.pointerDownPosition = null;
      this.isDragging = false;
      this.endInteraction();
    }
    this.camera.alpha = this.normalizeAlpha(orientation.alpha);
    this.camera.beta = orientation.beta;
  }

  // Legacy API kept for compatibility with callers that still pass [beta, alpha].
  setAngles(beta: number, alpha: number) {
    this.setOrientation({ alpha, beta });
  }

  resize(width: number, height: number, aspect?: number) {
    const effectiveHeight = aspect ? width / aspect : height;
    this.canvas.width = width;
    this.canvas.height = effectiveHeight;
    if (this.container) {
      this.container.style.width = `${width}px`;
      this.container.style.height = `${effectiveHeight}px`;
    }
    this.engine.resize();
  }

  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();

    if (this.container && this.homeButton) {
      this.container.removeChild(this.homeButton);
      const parent = this.container.parentElement;
      if (parent) {
        parent.insertBefore(this.canvas, this.container);
        parent.removeChild(this.container);
      }
    }
  }
}
