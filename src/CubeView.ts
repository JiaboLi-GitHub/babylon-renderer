import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Texture,
  DynamicTexture,
  Color3,
  Color4,
  Mesh,
  PointerEventTypes,
  PointerInfo,
  TransformNode,
  Animation,
  CubicEase,
  EasingFunction,
  LinesMesh,
  CreateLines,
} from '@babylonjs/core';

import {
  icon_home,
  icon_home_hover,
  texture_top,
  texture_right,
  texture_left,
  texture_front,
  texture_back,
  texture_bottom,
} from './textures';

export interface CubeViewOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  aspect?: number;
  hoverColor?: string;
  cubeSize?: number;
  zoom?: number;
  antialias?: boolean;
  onUpdateAngles?: (phi: number, theta: number) => void;
}

interface ControllerInfo {
  mesh: Mesh;
  name: string;
}

// Z-up CAM: X+=right, Y+=back, Z+=up
// With upVector=(0,0,1) + right-handed: x=r*sin(b)*cos(a), y=-r*sin(b)*sin(a), z=r*cos(b)
// VIEW_ANGLES = [beta, alpha] for ArcRotateCamera
const VIEW_ANGLES: Record<string, [number, number]> = {
  // Faces
  f0: [Math.PI * 0.5, 0],                    // RIGHT  (X+)
  f1: [0, 0],                                // TOP    (Z+)
  f2: [Math.PI * 0.5, Math.PI * 0.5],       // FRONT  (-Y)
  f3: [Math.PI * 0.5, Math.PI],             // LEFT   (-X)
  f4: [Math.PI, 0],                           // BOTTOM (Z-)
  f5: [Math.PI * 0.5, -Math.PI * 0.5],      // BACK   (Y+)
  // Corners
  c0: [Math.PI * 0.25, Math.PI * 0.25],     // FRONT,TOP,RIGHT
  c1: [Math.PI * 0.75, Math.PI * 0.25],     // FRONT,BOTTOM,RIGHT
  c2: [Math.PI * 0.75, Math.PI * 0.75],     // FRONT,BOTTOM,LEFT
  c3: [Math.PI * 0.25, Math.PI * 0.75],     // FRONT,TOP,LEFT
  c4: [Math.PI * 0.25, -Math.PI * 0.25],    // BACK,TOP,RIGHT
  c5: [Math.PI * 0.75, -Math.PI * 0.25],    // BACK,BOTTOM,RIGHT
  c6: [Math.PI * 0.75, -Math.PI * 0.75],    // BACK,BOTTOM,LEFT
  c7: [Math.PI * 0.25, -Math.PI * 0.75],    // BACK,TOP,LEFT
  // Edges
  e0: [Math.PI * 0.25, Math.PI * 0.5],      // TOP,FRONT
  e1: [Math.PI * 0.75, Math.PI * 0.5],      // BOTTOM,FRONT
  e2: [Math.PI * 0.25, -Math.PI * 0.5],     // TOP,BACK
  e3: [Math.PI * 0.75, -Math.PI * 0.5],     // BOTTOM,BACK
  e4: [Math.PI * 0.5, Math.PI * 0.25],      // FRONT,RIGHT
  e5: [Math.PI * 0.5, Math.PI * 0.75],      // FRONT,LEFT
  e6: [Math.PI * 0.5, -Math.PI * 0.25],     // BACK,RIGHT
  e7: [Math.PI * 0.5, -Math.PI * 0.75],     // BACK,LEFT
  e8: [Math.PI * 0.25, 0],                   // TOP,RIGHT
  e9: [Math.PI * 0.25, Math.PI],             // TOP,LEFT
  e10: [Math.PI * 0.75, 0],                  // BOTTOM,RIGHT
  e11: [Math.PI * 0.75, Math.PI],            // BOTTOM,LEFT
};

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
  private onUpdateAngles?: (phi: number, theta: number) => void;
  private mouseMoving = false;
  private homeButton: HTMLImageElement | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isAnimating = false;

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
    } = options;

    this.canvas = canvas;
    this.cubeSize = cubeSize;
    this.onUpdateAngles = onUpdateAngles;
    this.hoverColor = Color3.FromHexString(hoverColor.startsWith('#') ? hoverColor : '#' + hoverColor);

    const effectiveHeight = aspect ? width / aspect : height;
    canvas.width = width;
    canvas.height = effectiveHeight;

    // Create wrapper container for home button overlay
    this.createContainer(canvas);

    // Engine & Scene
    this.engine = new Engine(canvas, antialias, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    // Z-up coordinate system for CAM
    this.scene.useRightHandedSystem = true;
    this.scene.setRenderingAutoClearDepthStencil(1, false);

    // Camera: Z-up, default isometric showing TOP/FRONT/RIGHT
    // c0 = FRONT,TOP,RIGHT → beta=PI/4, alpha=PI/4
    this.camera = new ArcRotateCamera(
      'camera',
      Math.PI * 0.25,    // alpha
      Math.PI * 0.25,    // beta: z>0 (above)
      zoom,
      Vector3.Zero(),
      this.scene
    );
    this.camera.upVector = new Vector3(0, 0, 1); // Z-up
    this.camera.fov = 50 * Math.PI / 180;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    this.camera.lowerRadiusLimit = zoom;
    this.camera.upperRadiusLimit = zoom;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(canvas, true);

    // Build scene
    this.controllers = new TransformNode('controllers', this.scene);
    this.createAxes();
    this.createCubeFaces();
    this.createControllers();

    // Setup interaction
    this.setupPointerEvents();

    // Render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // Resize handling
    this.resizeObserver = new ResizeObserver(() => {
      this.engine.resize();
    });
    this.resizeObserver.observe(canvas);
  }

  private createContainer(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (!parent) return;

    this.container = document.createElement('div');
    this.container.className = 'cube-view-container';
    this.container.style.position = 'relative';
    this.container.style.display = 'inline-block';
    this.container.style.width = canvas.width + 'px';
    this.container.style.height = canvas.height + 'px';

    parent.insertBefore(this.container, canvas);
    this.container.appendChild(canvas);

    // Home button
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
      if (this.homeButton) this.homeButton.src = icon_home_hover;
    });
    this.homeButton.addEventListener('mouseout', () => {
      if (this.homeButton) this.homeButton.src = icon_home;
    });
    this.homeButton.addEventListener('click', () => this.clickHome());

    this.container.appendChild(this.homeButton);

    // Show home button on container hover
    this.container.addEventListener('mouseenter', () => {
      if (this.homeButton) this.homeButton.style.opacity = '1';
    });
    this.container.addEventListener('mouseleave', () => {
      if (this.homeButton) this.homeButton.style.opacity = '0';
    });
  }

  private createAxes() {
    const size = this.cubeSize;
    const origin = new Vector3(-size / 2 - 0.01, -size / 2 - 0.01, -size / 2 - 0.01);
    const axisLength = size + size / 6;
    const coneHeight = size * 0.12;
    const coneRadius = size * 0.04;

    // Z-up CAM: X=red(right), Y=green(back/forward), Z=blue(up)
    const axes: [Vector3, Color3, string][] = [
      [new Vector3(1, 0, 0), new Color3(1, 0, 0), 'X'],    // X = red
      [new Vector3(0, 1, 0), new Color3(0, 1, 0), 'Y'],    // Y = green
      [new Vector3(0, 0, 1), new Color3(0, 0, 1), 'Z'],    // Z = blue (up)
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
      // Orient cone along axis direction (default cylinder is Y-up)
      if (dir.x === 1) cone.rotation.z = -Math.PI / 2;
      else if (dir.z === 1) cone.rotation.x = Math.PI / 2;

      const labelSize = size * 0.2;
      const labelPlane = MeshBuilder.CreatePlane('axisLabel_' + label, { size: labelSize }, this.scene);
      const dtex = new DynamicTexture('dtex_' + label, 64, this.scene, false);
      dtex.hasAlpha = true;
      // Draw mirrored text to counteract right-handed billboard flip
      const ctx = dtex.getContext();
      ctx.clearRect(0, 0, 64, 64);
      ctx.save();
      ctx.translate(64, 0);
      ctx.scale(-1, 1);
      ctx.font = 'bold 44px Arial';
      ctx.fillStyle = color.toHexString();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      ctx.restore();
      dtex.update();
      const labelMat = new StandardMaterial('labelMat_' + label, this.scene);
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

  private createTexturedPlane(
    size: number,
    textureData: string,
    doubleSided: boolean = true
  ): Mesh {
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
    mat.needDepthPrePass = true; // write depth even with alpha, so controllers are properly occluded
    plane.material = mat;
    plane.isPickable = false;
    return plane;
  }

  private createCubeFaces() {
    const size = this.cubeSize;
    const half = size / 2;

    // Z-up CAM: TOP at Z+, BOTTOM at Z-, FRONT at -Y, BACK at +Y, RIGHT at X+, LEFT at -X

    // TOP face - Z+
    const top = this.createTexturedPlane(size, texture_top);
    top.position.z = half;
    // Plane default faces +Z in RH; rotate to face outward from Z+
    // No rotation needed — plane faces +Z by default

    // BOTTOM face - Z-
    const bottom = this.createTexturedPlane(size, texture_bottom);
    bottom.position.z = -half;
    bottom.rotation.x = Math.PI;

    // FRONT face - Y- (towards operator)
    const front = this.createTexturedPlane(size, texture_front);
    front.position.y = -half;
    front.rotation.x = Math.PI / 2;

    // BACK face - Y+
    const back = this.createTexturedPlane(size, texture_back);
    back.position.y = half;
    back.rotation.x = -Math.PI / 2;

    // RIGHT face - X+
    const right = this.createTexturedPlane(size, texture_right);
    right.position.x = half;
    right.rotation.y = Math.PI / 2;

    // LEFT face - X-
    const left = this.createTexturedPlane(size, texture_left);
    left.position.x = -half;
    left.rotation.y = -Math.PI / 2;

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

    const mat = new StandardMaterial(name + '_mat', this.scene);
    mat.diffuseColor = this.hoverColor;
    mat.emissiveColor = this.hoverColor;
    mat.alpha = 0.5;
    mat.disableLighting = true;
    box.material = mat;
    box.visibility = 0.001;
    box.renderingGroupId = 1; // render on top of textured planes
    box.position.set(posX, posY, posZ);
    box.parent = this.controllers;

    this.controllerMeshes.push({ mesh: box, name });
    return box;
  }

  private createControllers() {
    const size = this.cubeSize;
    const half = size / 2;
    const quarter = size / 4;

    // --- Corner cubes (8) --- Z-up: x=LR, y=FB, z=TB
    const cornerPositions: [string, number, number, number][] = [
      ['c0', 1, -1, 1],   // FRONT,TOP,RIGHT    (X+,-Y,Z+)
      ['c1', 1, -1, -1],  // FRONT,BOTTOM,RIGHT  (X+,-Y,Z-)
      ['c2', -1, -1, -1], // FRONT,BOTTOM,LEFT   (-X,-Y,Z-)
      ['c3', -1, -1, 1],  // FRONT,TOP,LEFT      (-X,-Y,Z+)
      ['c4', 1, 1, 1],    // BACK,TOP,RIGHT      (X+,Y+,Z+)
      ['c5', 1, 1, -1],   // BACK,BOTTOM,RIGHT   (X+,Y+,Z-)
      ['c6', -1, 1, -1],  // BACK,BOTTOM,LEFT    (-X,Y+,Z-)
      ['c7', -1, 1, 1],   // BACK,TOP,LEFT       (-X,Y+,Z+)
    ];

    for (const [name, x, y, z] of cornerPositions) {
      const _x = x * 1.01;
      const _y = y * 1.01;
      const _z = z * 1.01;
      const px = x > 0 ? half * _x - quarter / 2 : half * _x + quarter / 2;
      const py = y > 0 ? half * _y - quarter / 2 : half * _y + quarter / 2;
      const pz = z > 0 ? half * _z - quarter / 2 : half * _z + quarter / 2;
      this.createControllerBox(name, quarter, quarter, quarter, px, py, pz);
    }

    // --- Edge cubes (12) --- Z-up: x=LR, y=FB, z=TB
    const edgePositions: [string, number, number, number][] = [
      ['e0', 0, -1, 1],   // TOP,FRONT     (0,-Y,Z+)
      ['e1', 0, -1, -1],  // BOTTOM,FRONT  (0,-Y,Z-)
      ['e2', 0, 1, 1],    // TOP,BACK      (0,Y+,Z+)
      ['e3', 0, 1, -1],   // BOTTOM,BACK   (0,Y+,Z-)
      ['e4', 1, -1, 0],   // FRONT,RIGHT   (X+,-Y,0)
      ['e5', -1, -1, 0],  // FRONT,LEFT    (-X,-Y,0)
      ['e6', 1, 1, 0],    // BACK,RIGHT    (X+,Y+,0)
      ['e7', -1, 1, 0],   // BACK,LEFT     (-X,Y+,0)
      ['e8', 1, 0, 1],    // TOP,RIGHT     (X+,0,Z+)
      ['e9', -1, 0, 1],   // TOP,LEFT      (-X,0,Z+)
      ['e10', 1, 0, -1],  // BOTTOM,RIGHT  (X+,0,Z-)
      ['e11', -1, 0, -1], // BOTTOM,LEFT   (-X,0,Z-)
    ];

    for (const [name, x, y, z] of edgePositions) {
      const _x = x * 1.01;
      const _y = y * 1.01;
      const _z = z * 1.01;

      let sx = quarter, sy = quarter, sz = quarter;
      if (x === 0) sx = half;
      if (y === 0) sy = half;
      if (z === 0) sz = half;

      const px = x > 0 ? half * _x - sx / 2 : x === 0 ? 0 : half * _x + sx / 2;
      const py = y > 0 ? half * _y - sy / 2 : y === 0 ? 0 : half * _y + sy / 2;
      const pz = z > 0 ? half * _z - sz / 2 : z === 0 ? 0 : half * _z + sz / 2;

      this.createControllerBox(name, sx, sy, sz, px, py, pz);
    }

    // --- Face cubes (6) --- Z-up: x=LR, y=FB, z=TB
    const facePositions: [string, number, number, number][] = [
      ['f0', 1, 0, 0],   // RIGHT  (X+)
      ['f1', 0, 0, 1],   // TOP    (Z+)
      ['f2', 0, -1, 0],  // FRONT  (-Y)
      ['f3', -1, 0, 0],  // LEFT   (-X)
      ['f4', 0, 0, -1],  // BOTTOM (Z-)
      ['f5', 0, 1, 0],   // BACK   (Y+)
    ];

    for (const [name, x, y, z] of facePositions) {
      const _x = x * 1.01;
      const _y = y * 1.01;
      const _z = z * 1.01;

      let sx = quarter, sy = quarter, sz = quarter;
      if (x === 0) { sy = half; sz = half; }
      if (y === 0) { sx = half; sz = half; }
      if (z === 0) { sx = half; sy = half; }

      const px = x > 0 ? half * _x - sx / 2 : x === 0 ? 0 : half * _x + sx / 2;
      const py = y > 0 ? half * _y - sy / 2 : y === 0 ? 0 : half * _y + sy / 2;
      const pz = z > 0 ? half * _z - sz / 2 : z === 0 ? 0 : half * _z + sz / 2;

      this.createControllerBox(name, sx, sy, sz, px, py, pz);
    }
  }

  private setupPointerEvents() {
    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          this.mouseMoving = false;
          break;

        case PointerEventTypes.POINTERMOVE:
          this.mouseMoving = true;
          this.handleHover();
          break;

        case PointerEventTypes.POINTERUP:
          if (!this.mouseMoving && this.intersected) {
            this.handleClick(this.intersected.name);
          }
          // Report current angles
          this.reportAngles();
          break;
      }
    });

    // Also handle hover on each frame for smooth updates
    this.scene.registerBeforeRender(() => {
      this.handleHover();
    });
  }

  private handleHover() {
    const pickResult = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => this.controllerMeshes.some((c) => c.mesh === mesh)
    );

    if (pickResult?.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh as Mesh;
      if (this.intersected !== mesh) {
        // Unhighlight previous
        if (this.intersected) {
          this.intersected.visibility = 0.001;
        }
        // Highlight new
        this.intersected = mesh;
        mesh.visibility = 1;
      }
    } else {
      if (this.intersected) {
        this.intersected.visibility = 0.001;
        this.intersected = null;
      }
    }
  }

  private handleClick(name: string) {
    const angles = VIEW_ANGLES[name];
    if (!angles) return;

    const [phi, theta] = angles;
    this.animateToAngles(phi, theta);

    if (this.onUpdateAngles) {
      this.onUpdateAngles(phi, theta);
    }
  }

  /**
   * Z-up camera: VIEW_ANGLES stores [beta, alpha] directly.
   * beta = polar angle from Z+ (0=top, PI=bottom)
   * alpha = azimuthal angle in XY plane from X+
   */
  private phiThetaToAlphaBeta(beta: number, alpha: number): [number, number] {
    return [alpha, beta];
  }

  private alphaBetaToPhiTheta(): [number, number] {
    return [this.camera.beta, this.camera.alpha];
  }

  private animateToAngles(phi: number, theta: number) {
    if (this.isAnimating) return;
    this.isAnimating = true;

    const [targetAlpha, targetBeta] = this.phiThetaToAlphaBeta(phi, theta);

    // Find shortest path for alpha
    let currentAlpha = this.camera.alpha;
    let deltaAlpha = targetAlpha - currentAlpha;
    // Normalize to [-PI, PI]
    while (deltaAlpha > Math.PI) deltaAlpha -= 2 * Math.PI;
    while (deltaAlpha < -Math.PI) deltaAlpha += 2 * Math.PI;
    const finalAlpha = currentAlpha + deltaAlpha;

    const fps = 60;
    const totalFrames = 30; // 0.5 second animation

    const alphaAnim = new Animation(
      'alphaAnim', 'alpha', fps,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    alphaAnim.setKeys([
      { frame: 0, value: this.camera.alpha },
      { frame: totalFrames, value: finalAlpha },
    ]);

    const betaAnim = new Animation(
      'betaAnim', 'beta', fps,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    betaAnim.setKeys([
      { frame: 0, value: this.camera.beta },
      { frame: totalFrames, value: targetBeta },
    ]);

    // Ease in/out
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
      }
    );
  }

  clickHome() {
    // Default isometric: FRONT,TOP,RIGHT → beta=PI/4, alpha=PI/4
    const beta = Math.PI * 0.25;
    const alpha = Math.PI * 0.25;
    this.animateToAngles(beta, alpha);
    if (this.onUpdateAngles) {
      this.onUpdateAngles(beta, alpha);
    }
  }

  setAngles(phi: number, theta: number) {
    const [alpha, beta] = this.phiThetaToAlphaBeta(phi, theta);
    this.camera.alpha = alpha;
    this.camera.beta = beta;
  }

  private reportAngles() {
    if (this.onUpdateAngles) {
      const [phi, theta] = this.alphaBetaToPhiTheta();
      this.onUpdateAngles(phi, theta);
    }
  }

  resize(width: number, height: number, aspect?: number) {
    const effectiveHeight = aspect ? width / aspect : height;
    this.canvas.width = width;
    this.canvas.height = effectiveHeight;
    if (this.container) {
      this.container.style.width = width + 'px';
      this.container.style.height = effectiveHeight + 'px';
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

    // Remove home button and restore canvas
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
