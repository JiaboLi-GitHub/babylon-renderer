import {
  Color3,
  Mesh,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import {
  AdvancedBrepShapeRepresentation,
  AdvancedFace,
  ApplicationContext,
  ApplicationProtocolDefinition,
  Axis2Placement3D,
  CartesianPoint,
  ClosedShell,
  ColourRgb,
  Direction,
  EdgeCurve,
  EdgeLoop,
  FaceOuterBound,
  FillAreaStyle,
  FillAreaStyleColour,
  Line,
  ManifoldSolidBrep,
  MechanicalDesignGeometricPresentationRepresentation,
  OrientedEdge,
  Plane,
  PresentationStyleAssignment,
  Product,
  ProductContext,
  ProductDefinition,
  ProductDefinitionContext,
  ProductDefinitionFormation,
  ProductDefinitionShape,
  Repository,
  ShapeDefinitionRepresentation,
  StyledItem,
  SurfaceSideStyle,
  SurfaceStyleFillArea,
  SurfaceStyleUsage,
  Unknown,
  Vector as StepVector,
  VertexPoint,
} from 'stepts';

const DEFAULT_IMPORT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

const TRIANGLE_EPSILON_SQUARED = 1e-10;
const VERTEX_MERGE_TOLERANCE = 1e-7;
const EXPORT_YIELD_EVERY = 750;
const DEFAULT_EXPORT_COLOR = [0.75, 0.78, 0.82];

const scriptLoadPromises = new Map();

let occtImportPromise = null;

function setStatus(onStatus, message) {
  if (onStatus) {
    onStatus(message);
  }
}

function hasArrayPayload(value, minimumLength) {
  return value != null && typeof value.length === 'number' && value.length >= minimumLength;
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function sanitizeNodeName(name, fallback) {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function loadClassicScript(src) {
  if (scriptLoadPromises.has(src)) {
    return scriptLoadPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  scriptLoadPromises.set(src, promise);
  return promise;
}

async function getOcctImport() {
  if (!occtImportPromise) {
    occtImportPromise = (async () => {
      const [{ default: occtImportScriptUrl }, { default: occtImportWasmUrl }] = await Promise.all([
        import('occt-import-js/dist/occt-import-js.js?url'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);

      await loadClassicScript(occtImportScriptUrl);

      if (typeof window.occtimportjs !== 'function') {
        throw new Error('occt-import-js did not register its global entry point.');
      }

      return window.occtimportjs({
        locateFile(path) {
          if (path.endsWith('.wasm')) {
            return occtImportWasmUrl;
          }
          return path;
        },
      });
    })();
  }

  return occtImportPromise;
}

function createImportedMaterial(scene, meshData, materialName) {
  const material = new StandardMaterial(materialName, scene);
  material.specularColor = new Color3(0.12, 0.12, 0.12);

  if (Array.isArray(meshData.color) && meshData.color.length === 3) {
    material.diffuseColor = new Color3(meshData.color[0], meshData.color[1], meshData.color[2]);
  } else {
    material.diffuseColor = new Color3(...DEFAULT_EXPORT_COLOR);
  }

  return material;
}

function createImportedMesh(scene, meshData, meshName) {
  const mesh = new Mesh(meshName, scene);
  const vertexData = new VertexData();

  vertexData.positions = [...meshData.attributes.position.array];
  vertexData.indices = [...meshData.index.array];

  if (meshData.attributes.normal?.array) {
    vertexData.normals = [...meshData.attributes.normal.array];
  }

  vertexData.applyToMesh(mesh, true);
  mesh.material = createImportedMaterial(scene, meshData, `${meshName}_material`);
  mesh.receiveShadows = false;

  return mesh;
}

function attachImportedHierarchy(scene, parent, nodeData, importResult, meshCache) {
  const transform = new TransformNode(
    sanitizeNodeName(nodeData.name, `${parent.name}_node`),
    scene,
  );
  transform.parent = parent;

  for (const meshIndex of nodeData.meshes ?? []) {
    let mesh = meshCache.get(meshIndex);
    if (!mesh) {
      const meshData = importResult.meshes[meshIndex];
      const meshName = sanitizeNodeName(meshData?.name, `stepMesh_${meshIndex}`);
      mesh = createImportedMesh(scene, meshData, meshName);
      meshCache.set(meshIndex, mesh);
    }
    mesh.parent = transform;
  }

  for (const child of nodeData.children ?? []) {
    attachImportedHierarchy(scene, transform, child, importResult, meshCache);
  }
}

function summarizeMeshes(meshes) {
  let triangleCount = 0;

  for (const mesh of meshes) {
    const indices = mesh.getIndices();
    if (!indices) {
      continue;
    }
    triangleCount += Math.floor(indices.length / 3);
  }

  return {
    meshCount: meshes.length,
    triangleCount,
  };
}

export async function loadStepModel({
  scene,
  file,
  importParams = DEFAULT_IMPORT_PARAMS,
  onStatus,
}) {
  if (!file) {
    throw new Error('No STEP file was provided.');
  }

  setStatus(onStatus, `Initializing STEP importer for ${file.name}...`);

  const [occt, buffer] = await Promise.all([
    getOcctImport(),
    file.arrayBuffer(),
  ]);

  setStatus(onStatus, `Parsing ${file.name}...`);

  const importResult = occt.ReadStepFile(new Uint8Array(buffer), importParams);
  if (!importResult?.success) {
    throw new Error(`Failed to parse ${file.name}.`);
  }

  const root = new TransformNode(
    sanitizeNodeName(stripExtension(file.name), 'stepModel'),
    scene,
  );

  const meshCache = new Map();

  if ((importResult.root?.children?.length ?? 0) > 0) {
    for (const child of importResult.root.children) {
      attachImportedHierarchy(scene, root, child, importResult, meshCache);
    }
  } else {
    for (let meshIndex = 0; meshIndex < importResult.meshes.length; meshIndex += 1) {
      const meshData = importResult.meshes[meshIndex];
      const meshName = sanitizeNodeName(meshData?.name, `stepMesh_${meshIndex}`);
      const mesh = createImportedMesh(scene, meshData, meshName);
      mesh.parent = root;
      meshCache.set(meshIndex, mesh);
    }
  }

  const meshes = root.getChildMeshes();
  const summary = summarizeMeshes(meshes);

  setStatus(
    onStatus,
    `Loaded ${file.name} (${summary.meshCount} meshes, ${summary.triangleCount} triangles).`,
  );

  return {
    root,
    summary,
  };
}

function triangleAreaSquared(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;

  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;

  return crossX * crossX + crossY * crossY + crossZ * crossZ;
}

function transformPointToRef(worldMatrix, source, vertexIndex, target) {
  const offset = vertexIndex * 3;
  target.copyFromFloats(source[offset], source[offset + 1], source[offset + 2]);
  Vector3.TransformCoordinatesToRef(target, worldMatrix, target);
}

function triggerDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'model/step' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function getExportableMeshData(meshes) {
  return meshes.filter((mesh) => {
    if (!mesh || mesh.isDisposed() || !mesh.isEnabled()) {
      return false;
    }

    if (mesh.visibility <= 0 || !mesh.isVisible) {
      return false;
    }

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();

    return hasArrayPayload(positions, 9) && hasArrayPayload(indices, 3);
  });
}

function quantizeCoordinate(value) {
  return Math.round(value / VERTEX_MERGE_TOLERANCE);
}

function getVertexKey(point) {
  return [
    quantizeCoordinate(point.x),
    quantizeCoordinate(point.y),
    quantizeCoordinate(point.z),
  ].join(',');
}

function clampColorChannel(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function getMeshColor(mesh) {
  const material = mesh.material;
  const rawColor = material?.diffuseColor ?? material?.albedoColor;

  if (rawColor) {
    return [
      clampColorChannel(rawColor.r),
      clampColorChannel(rawColor.g),
      clampColorChannel(rawColor.b),
    ];
  }

  return DEFAULT_EXPORT_COLOR;
}

function createRepresentationContext(repo, modelName) {
  const lengthUnit = repo.add(
    new Unknown('', [
      '( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )',
    ]),
  );
  const angleUnit = repo.add(
    new Unknown('', [
      '( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )',
    ]),
  );
  const solidAngleUnit = repo.add(
    new Unknown('', [
      '( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )',
    ]),
  );
  const uncertainty = repo.add(
    new Unknown('UNCERTAINTY_MEASURE_WITH_UNIT', [
      'LENGTH_MEASURE(1.E-07)',
      `${lengthUnit}`,
      "'distance_accuracy_value'",
      "'Maximum Tolerance'",
    ]),
  );

  return repo.add(
    new Unknown('', [
      `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidAngleUnit})) REPRESENTATION_CONTEXT('${modelName.replace(/'/g, "''")}','3D') )`,
    ]),
  );
}

function addVertex(repo, vertexCache, point) {
  const key = getVertexKey(point);
  const cached = vertexCache.get(key);
  if (cached) {
    return cached;
  }

  const pointRef = repo.add(new CartesianPoint('', point.x, point.y, point.z));
  const vertexRef = repo.add(new VertexPoint('', pointRef));
  const vertexEntry = {
    key,
    ref: vertexRef,
    pointRef,
    x: point.x,
    y: point.y,
    z: point.z,
  };

  vertexCache.set(key, vertexEntry);
  return vertexEntry;
}

function createStepDirection(repo, direction) {
  return repo.add(new Direction('', direction.x, direction.y, direction.z));
}

function ensureEdge(repo, edgeCache, vertexCache, startKey, endKey) {
  const edgeKey = startKey < endKey
    ? `${startKey}|${endKey}`
    : `${endKey}|${startKey}`;

  let edgeEntry = edgeCache.get(edgeKey);
  if (edgeEntry) {
    return edgeEntry;
  }

  const startVertex = vertexCache.get(startKey);
  const endVertex = vertexCache.get(endKey);
  const canonicalStart = startKey < endKey ? startVertex : endVertex;
  const canonicalEnd = startKey < endKey ? endVertex : startVertex;

  const delta = new Vector3(
    canonicalEnd.x - canonicalStart.x,
    canonicalEnd.y - canonicalStart.y,
    canonicalEnd.z - canonicalStart.z,
  );
  const length = delta.length();

  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Encountered a collapsed mesh edge during STEP export.');
  }

  delta.scaleInPlace(1 / length);

  const directionRef = createStepDirection(repo, delta);
  const vectorRef = repo.add(new StepVector('', directionRef, length));
  const lineRef = repo.add(new Line('', canonicalStart.pointRef, vectorRef));
  const edgeRef = repo.add(
    new EdgeCurve('', canonicalStart.ref, canonicalEnd.ref, lineRef, true),
  );

  edgeEntry = {
    ref: edgeRef,
    startKey: canonicalStart.key,
    endKey: canonicalEnd.key,
    usageCount: 0,
    orientationBalance: 0,
  };
  edgeCache.set(edgeKey, edgeEntry);
  return edgeEntry;
}

function createStyledSolid(repo, solidRef, mesh, meshName) {
  const [r, g, b] = getMeshColor(mesh);
  const colorRef = repo.add(new ColourRgb(`${meshName}_color`, r, g, b));
  const fillColorRef = repo.add(new FillAreaStyleColour('', colorRef));
  const fillStyleRef = repo.add(new FillAreaStyle('', [fillColorRef]));
  const surfaceFillRef = repo.add(new SurfaceStyleFillArea(fillStyleRef));
  const surfaceSideRef = repo.add(new SurfaceSideStyle('', [surfaceFillRef]));
  const surfaceUsageRef = repo.add(new SurfaceStyleUsage('.BOTH.', surfaceSideRef));
  const styleRef = repo.add(new PresentationStyleAssignment([surfaceUsageRef]));

  return repo.add(new StyledItem('', [styleRef], solidRef));
}

async function buildSolidForMesh({
  repo,
  mesh,
  meshIndex,
  progress,
  onStatus,
}) {
  mesh.computeWorldMatrix(true);

  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  const worldMatrix = mesh.getWorldMatrix();
  const meshName = sanitizeNodeName(mesh.name, `mesh_${meshIndex + 1}`);

  const vertexCache = new Map();
  const edgeCache = new Map();
  const faceRefs = [];

  const pointA = new Vector3();
  const pointB = new Vector3();
  const pointC = new Vector3();
  const edgeAB = new Vector3();
  const edgeAC = new Vector3();
  const edgeDirection = new Vector3();
  const cross = new Vector3();

  for (let indexOffset = 0; indexOffset < indices.length; indexOffset += 3) {
    transformPointToRef(worldMatrix, positions, indices[indexOffset], pointA);
    transformPointToRef(worldMatrix, positions, indices[indexOffset + 1], pointB);
    transformPointToRef(worldMatrix, positions, indices[indexOffset + 2], pointC);

    if (triangleAreaSquared(pointA, pointB, pointC) <= TRIANGLE_EPSILON_SQUARED) {
      continue;
    }

    const vertexA = addVertex(repo, vertexCache, pointA);
    const vertexB = addVertex(repo, vertexCache, pointB);
    const vertexC = addVertex(repo, vertexCache, pointC);

    if (
      vertexA.key === vertexB.key ||
      vertexB.key === vertexC.key ||
      vertexC.key === vertexA.key
    ) {
      continue;
    }

    const loopVertices = [vertexA, vertexB, vertexC];
    const orientedEdgeRefs = [];

    for (let loopIndex = 0; loopIndex < loopVertices.length; loopIndex += 1) {
      const startVertex = loopVertices[loopIndex];
      const endVertex = loopVertices[(loopIndex + 1) % loopVertices.length];
      const edgeEntry = ensureEdge(repo, edgeCache, vertexCache, startVertex.key, endVertex.key);
      const sameDirection = (
        edgeEntry.startKey === startVertex.key &&
        edgeEntry.endKey === endVertex.key
      );

      edgeEntry.usageCount += 1;
      edgeEntry.orientationBalance += sameDirection ? 1 : -1;

      orientedEdgeRefs.push(repo.add(new OrientedEdge('', edgeEntry.ref, sameDirection)));
    }

    edgeAB.copyFrom(pointB);
    edgeAB.subtractInPlace(pointA);
    edgeAC.copyFrom(pointC);
    edgeAC.subtractInPlace(pointA);
    edgeDirection.copyFrom(edgeAB);
    edgeDirection.normalize();
    Vector3.CrossToRef(edgeAB, edgeAC, cross);
    cross.normalize();

    const originRef = repo.add(new CartesianPoint('', pointA.x, pointA.y, pointA.z));
    const normalRef = createStepDirection(repo, cross);
    const refDirectionRef = createStepDirection(repo, edgeDirection);
    const planePlacementRef = repo.add(
      new Axis2Placement3D('', originRef, normalRef, refDirectionRef),
    );
    const planeRef = repo.add(new Plane('', planePlacementRef));
    const loopRef = repo.add(new EdgeLoop('', orientedEdgeRefs));
    const faceBoundRef = repo.add(new FaceOuterBound('', loopRef, true));

    faceRefs.push(repo.add(new AdvancedFace('', [faceBoundRef], planeRef, true)));

    progress.exportedTriangles += 1;
    if (progress.exportedTriangles % EXPORT_YIELD_EVERY === 0) {
      setStatus(onStatus, `Preparing STEP faces... ${progress.exportedTriangles.toLocaleString()} triangles`);
      await nextAnimationFrame();
    }
  }

  if (faceRefs.length === 0) {
    return null;
  }

  const invalidEdgeCount = [...edgeCache.values()].filter((edgeEntry) => (
    edgeEntry.usageCount !== 2 || edgeEntry.orientationBalance !== 0
  )).length;

  if (invalidEdgeCount > 0) {
    throw new Error(
      `Mesh "${meshName}" is not watertight. STEP export currently requires closed, consistently wound meshes.`,
    );
  }

  const shellRef = repo.add(new ClosedShell(meshName, faceRefs));
  const solidRef = repo.add(new ManifoldSolidBrep(meshName, shellRef));
  const styledItemRef = createStyledSolid(repo, solidRef, mesh, meshName);

  return {
    meshName,
    solidRef,
    styledItemRef,
    faceCount: faceRefs.length,
  };
}

function createProductStructure(repo, modelName, geomContext, solidRefs, styledItemRefs) {
  const appContext = repo.add(
    new ApplicationContext('core data for automotive mechanical design processes'),
  );
  repo.add(
    new ApplicationProtocolDefinition(
      'international standard',
      'automotive_design',
      2010,
      appContext,
    ),
  );

  const productContext = repo.add(new ProductContext('', appContext, 'mechanical'));
  const product = repo.add(new Product(modelName, modelName, '', [productContext]));
  const productDefContext = repo.add(
    new ProductDefinitionContext('part definition', appContext, 'design'),
  );
  const productDefFormation = repo.add(new ProductDefinitionFormation('', '', product));
  const productDef = repo.add(
    new ProductDefinition('', '', productDefFormation, productDefContext),
  );
  const productDefShape = repo.add(new ProductDefinitionShape('', '', productDef));

  repo.add(
    new MechanicalDesignGeometricPresentationRepresentation(
      '',
      styledItemRefs,
      geomContext,
    ),
  );

  const shapeRepresentation = repo.add(
    new AdvancedBrepShapeRepresentation(modelName, solidRefs, geomContext),
  );
  repo.add(new ShapeDefinitionRepresentation(productDefShape, shapeRepresentation));
}

export async function exportMeshesToStep({
  meshes,
  fileName = 'scene.step',
  onStatus,
}) {
  const exportableMeshes = getExportableMeshData(meshes);
  if (exportableMeshes.length === 0) {
    throw new Error('There are no visible meshes to export.');
  }

  setStatus(onStatus, 'Preparing STEP export...');

  const modelName = sanitizeNodeName(stripExtension(fileName), 'scene');
  const repo = new Repository();
  const geomContext = createRepresentationContext(repo, modelName);
  const progress = { exportedTriangles: 0 };
  const solidRefs = [];
  const styledItemRefs = [];

  for (let meshIndex = 0; meshIndex < exportableMeshes.length; meshIndex += 1) {
    const mesh = exportableMeshes[meshIndex];
    const meshResult = await buildSolidForMesh({
      repo,
      mesh,
      meshIndex,
      progress,
      onStatus,
    });

    if (!meshResult) {
      continue;
    }

    solidRefs.push(meshResult.solidRef);
    styledItemRefs.push(meshResult.styledItemRef);
  }

  if (solidRefs.length === 0 || progress.exportedTriangles === 0) {
    throw new Error('No valid triangles were found for STEP export.');
  }

  createProductStructure(repo, modelName, geomContext, solidRefs, styledItemRefs);

  setStatus(onStatus, 'Serializing STEP file...');
  const stepText = repo.toPartFile({
    name: modelName,
    author: 'babylon-renderer',
    org: 'babylon-renderer',
  });
  const stepBytes = new TextEncoder().encode(stepText);

  setStatus(onStatus, 'Validating exported STEP...');
  const occt = await getOcctImport();
  const validationResult = occt.ReadStepFile(stepBytes, DEFAULT_IMPORT_PARAMS);
  if (!validationResult?.success) {
    throw new Error('The generated STEP file failed validation.');
  }

  triggerDownload(stepBytes, fileName);
  setStatus(
    onStatus,
    `Exported ${fileName} (${progress.exportedTriangles.toLocaleString()} faceted triangles).`,
  );
}
