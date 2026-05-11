# 工件坐标轴原点选取系统技术文档

## 1. 技术定位

本功能建议新增为独立模块：

- `src/WorkpieceOriginSelector.ts`

并通过：

- `src/index.ts`

导出公开 API。

它的职责是管理工件包围盒、候选原点、hover/selected 状态、坐标轴预览和选取结果。它不负责模型加载、相机 fit、网格绘制、STEP 导出或加工路径生成。

## 2. 参考实现映射

SceneGraph.Net 中相关分层如下：

- `BoxStockConstraint`
  负责毛坯包围盒、表面拾取、吸附点生成。
- `StockFrameWidget`
  负责交互步骤、hover、点击、确认和状态流转。
- `StockFrameRepresentation`
  负责表面轮廓、候选点、选中点、坐标轴等可视化对象。
- `StockFrameController`
  负责把 widget 结果接入 scene，并转换成 `SimulationFrame`。
- `WcsTransformAdapter`
  负责将 WCS offset/rotation 转换成 frame 或矩阵。

当前 Babylon 项目建议对应为：

```text
WorkpieceOriginSelector
  - bounds calculation
  - candidate generation
  - pointer picking
  - visual object lifecycle
  - state and event output
```

第一版先不拆多个文件，避免过度设计；当后续加入表面选择、自由放置、轴向选择后，再拆成 `Constraint`、`Representation`、`Controller` 子模块。

## 3. 当前项目接入点

当前主场景位于：

- `index.html`

现有可复用逻辑：

- `getModelBounds(meshes)` 已能计算模型世界包围盒。
- `updateActiveModel(root, summary, name)` 是模型切换后的集中入口。
- `syncGridElevationToModel()` 与 `gridMap.fitToMeshes()` 已在模型刷新时调用。
- `engine.runRenderLoop()` 已每帧更新 `gridMap` 和 scale bar。

建议接入位置：

```ts
const workpieceOriginSelector = new WorkpieceOriginSelector({
  scene,
  camera,
  canvas: mainCanvas,
  coordinateScale: currentGridUnitOptions.coordinateScale,
  unitLabel: currentGridUnitOptions.unitLabel,
  onOriginChange: (selection) => {
    setIoStatus(selection
      ? `工件原点: ${selection.positionValue.x}, ${selection.positionValue.y}, ${selection.positionValue.z}`
      : '工件原点已清除。')
  },
})
```

模型变化后：

```ts
workpieceOriginSelector.fitToMeshes(modelRoot.getChildMeshes())
```

单位切换后：

```ts
workpieceOriginSelector.setUnitOptions({
  coordinateScale: currentGridUnitOptions.coordinateScale,
  unitLabel: currentGridUnitOptions.unitLabel,
})
```

每帧：

```ts
workpieceOriginSelector.update()
```

第一版如果没有 billboarding 或屏幕尺寸锁定需求，`update()` 可以为空实现，但保留 API 以便后续扩展。

## 4. 坐标约定

当前项目使用：

```ts
scene.useRightHandedSystem = true
camera.upVector = new Vector3(0, 0, 1)
```

因此本模块按 Z-up 世界坐标实现：

- X 轴：世界 X 正方向。
- Y 轴：世界 Y 正方向。
- Z 轴：世界 Z 正方向。

STEP 模型加载时已有：

```ts
worldScale: 1 / currentGridUnitOptions.coordinateScale
```

因此：

- `positionWorld` 是 Babylon 世界坐标。
- `positionValue = positionWorld * coordinateScale` 是当前显示单位下的值。

## 5. 公开 API 设计

## 5.1 类型定义

```ts
export type WorkpieceOriginCandidateKind =
  | 'corner'
  | 'edge-center'
  | 'face-center'

export interface WorkpieceOriginCandidate {
  id: string
  kind: WorkpieceOriginCandidateKind
  positionWorld: Vector3
  normalWorld: Vector3
}

export interface WorkpieceOriginSelection {
  id: string
  kind: WorkpieceOriginCandidateKind
  positionWorld: Vector3
  positionValue: {
    x: number
    y: number
    z: number
  }
  axisXWorld: Vector3
  axisYWorld: Vector3
  axisZWorld: Vector3
}

export interface WorkpieceOriginSelectorState {
  enabled: boolean
  boundsWorld: {
    min: Vector3
    max: Vector3
    center: Vector3
    size: Vector3
    diagonal: number
  } | null
  candidates: WorkpieceOriginCandidate[]
  hoveredCandidateId: string | null
  selectedCandidateId: string | null
  selection: WorkpieceOriginSelection | null
}

export interface WorkpieceOriginSelectorOptions {
  scene: Scene
  camera: Camera
  canvas: HTMLCanvasElement
  coordinateScale?: number
  unitLabel?: string
  enabled?: boolean
  showBoundingBox?: boolean
  showCandidates?: boolean
  candidateKinds?: WorkpieceOriginCandidateKind[]
  handleRadiusRatio?: number
  minHandleRadiusWorld?: number
  maxHandleRadiusWorld?: number
  axisLengthRatio?: number
  onOriginChange?: (selection: WorkpieceOriginSelection | null) => void
  onStateChange?: (state: WorkpieceOriginSelectorState) => void
}
```

内部可使用一个等价的私有 bounds 类型，避免在计算过程中反复从 state 拆装：

```ts
interface WorkpieceBoundsWorld {
  min: Vector3
  max: Vector3
  center: Vector3
  size: Vector3
  diagonal: number
}
```

## 5.2 类接口

```ts
export class WorkpieceOriginSelector {
  constructor(options: WorkpieceOriginSelectorOptions)
  fitToMeshes(meshes: AbstractMesh[]): void
  setEnabled(enabled: boolean): void
  setUnitOptions(options: { coordinateScale?: number; unitLabel?: string }): void
  clearSelection(): void
  update(): void
  getState(): WorkpieceOriginSelectorState
  dispose(): void
}
```

## 6. 内部结构

建议内部字段：

```ts
private readonly scene: Scene
private readonly camera: Camera
private readonly canvas: HTMLCanvasElement
private readonly root: TransformNode
private readonly candidateMeshes = new Map<string, Mesh>()
private readonly candidateByMesh = new Map<AbstractMesh, WorkpieceOriginCandidate>()
private boundingBoxMesh: LinesMesh | null = null
private axisRoot: TransformNode | null = null
private boundsWorld: WorkpieceBoundsWorld | null = null
private candidates: WorkpieceOriginCandidate[] = []
private hoveredCandidateId: string | null = null
private selectedCandidateId: string | null = null
private pointerObserver: Observer<PointerInfo> | null = null
```

资源归属：

- 所有可视对象挂到 `root`。
- `dispose()` 只释放本模块创建的对象。
- 不修改用户传入的模型 mesh。
- 不修改 `GridMap` 创建的对象。

## 7. 包围盒计算

输入：

```ts
fitToMeshes(meshes: AbstractMesh[])
```

流程：

1. 过滤已 dispose 或无 bounding info 的 mesh。
2. 对每个 mesh 调用 `computeWorldMatrix(true)`。
3. 读取 `mesh.getBoundingInfo().boundingBox.minimumWorld` 和 `maximumWorld`。
4. 聚合得到 `min` 和 `max`。
5. 如果包围盒为空，清空 selector。
6. 对接近 0 的尺寸做最小厚度兜底。

兜底策略：

```ts
const safeThickness = Math.max(diagonal * 0.001, 1e-4)
```

如果某轴尺寸小于该值，就以中心为基准扩张到最小厚度。

输出：

```ts
{
  min,
  max,
  center: min.add(max).scale(0.5),
  size: max.subtract(min),
  diagonal: size.length(),
}
```

## 8. 候选点生成

默认生成 26 个候选点。

## 8.1 角点

8 个：

```text
(minX, minY, minZ)
(maxX, minY, minZ)
(maxX, maxY, minZ)
(minX, maxY, minZ)
(minX, minY, maxZ)
(maxX, minY, maxZ)
(maxX, maxY, maxZ)
(minX, maxY, maxZ)
```

## 8.2 边中点

12 个：

- X 方向 4 条边中点。
- Y 方向 4 条边中点。
- Z 方向 4 条边中点。

## 8.3 面中心

6 个：

- `minX` 面中心。
- `maxX` 面中心。
- `minY` 面中心。
- `maxY` 面中心。
- `minZ` 面中心。
- `maxZ` 面中心。

## 8.4 ID 规则

候选点 ID 使用稳定字符串，便于测试：

```text
corner:min-x:min-y:min-z
edge-center:x:min-y:max-z
face-center:max-z
```

## 9. 可视化实现

## 9.1 包围盒

使用 Babylon `MeshBuilder.CreateLineSystem` 或 `MeshBuilder.CreateLines` 创建 12 条边。

建议命名：

```ts
workpieceOriginSelector.boundingBox
```

建议属性：

```ts
boundingBoxMesh.isPickable = false
boundingBoxMesh.renderingGroupId = 1
boundingBoxMesh.color = new Color3(0.08, 0.62, 0.78)
```

## 9.2 候选点

第一版使用 26 个独立 sphere mesh，数量很少，简单可靠，方便 pick 和测试。

建议命名：

```ts
workpieceOriginSelector.candidate.corner:min-x:min-y:min-z
```

建议属性：

```ts
mesh.isPickable = true
mesh.metadata = {
  workpieceOriginCandidateId: candidate.id,
}
```

半径：

```ts
radius = clamp(
  bounds.diagonal * handleRadiusRatio,
  minHandleRadiusWorld,
  maxHandleRadiusWorld,
)
```

默认建议：

```ts
handleRadiusRatio: 0.018
minHandleRadiusWorld: 0.025
maxHandleRadiusWorld: 0.18
```

## 9.3 材质

建议创建并复用 4 个材质：

- `boxMaterial`
- `candidateMaterial`
- `hoverMaterial`
- `selectedMaterial`

候选点根据状态切换 material，不重复创建材质。

材质示例：

```ts
candidateMaterial.diffuseColor = new Color3(0.92, 0.96, 1)
hoverMaterial.diffuseColor = new Color3(1, 0.82, 0.2)
selectedMaterial.diffuseColor = new Color3(1, 0.44, 0.14)
```

可选增强：

- `emissiveColor` 提升识别度。
- `disableDepthWrite` 降低遮挡问题。
- `renderingGroupId` 让辅助对象在模型之后渲染。

## 9.4 坐标轴预览

第一版可用线段实现，后续再升级成箭头。

对象：

```ts
axisRoot
axisX
axisY
axisZ
```

长度：

```ts
axisLength = Math.max(bounds.diagonal * axisLengthRatio, minAxisLength)
```

默认：

```ts
axisLengthRatio: 0.22
```

方向不要依赖 Babylon 的方向常量命名，直接使用当前业务坐标约定：

```ts
const axisXWorld = new Vector3(1, 0, 0)
const axisYWorld = new Vector3(0, 1, 0)
const axisZWorld = new Vector3(0, 0, 1)
```

## 10. 拾取实现

使用 Babylon pointer observable：

```ts
this.pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
  switch (pointerInfo.type) {
    case PointerEventTypes.POINTERMOVE:
      this.handlePointerMove()
      break
    case PointerEventTypes.POINTERUP:
      this.handlePointerUp(pointerInfo.event)
      break
  }
})
```

hover：

```ts
const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) =>
  this.candidateByMesh.has(mesh)
)
```

click：

- 用 `POINTERUP` 选中候选点。
- 可记录 `POINTERDOWN` 坐标，并设置最大移动距离，例如 4px，避免拖拽相机时误选。
- 只处理主按钮点击。

选择后：

```ts
this.selectedCandidateId = candidate.id
this.syncCandidateMaterials()
this.syncAxisPreview()
this.emitState()
this.onOriginChange?.(this.getState().selection)
```

相机兼容：

- 不阻止相机 pointer 事件。
- 不处理非候选点点击。
- 拾取对象限定在本模块 candidate meshes。

## 11. 状态流转

状态机：

```text
empty
  -> ready(bounds + candidates)
  -> hovering(candidate)
  -> selected(candidate)
  -> ready(clearSelection)
```

`fitToMeshes()` 行为：

- 重建 bounds。
- 重建 candidates。
- 清空 hover。
- 清空 selected。
- 触发 `onOriginChange(null)`。

`clearSelection()` 行为：

- 保留 bounds 和 candidates。
- 清空 selected。
- 清空坐标轴。
- 触发状态事件。

## 12. 与单位系统集成

模块内部存储世界坐标。对外状态额外提供当前单位值：

```ts
positionValue = {
  x: positionWorld.x * coordinateScale,
  y: positionWorld.y * coordinateScale,
  z: positionWorld.z * coordinateScale,
}
```

单位切换时：

- 不重建包围盒。
- 不重建候选点。
- 只更新 `coordinateScale` 和 `unitLabel`。
- 如果已有 selected，重新 emit selection，保证 UI 文本同步。

## 13. 测试方案

## 13.1 模块级测试

如果后续把候选点生成函数拆成纯函数，可以测试：

- 标准 box 生成 26 个候选点。
- 8 个角点坐标正确。
- 12 个边中点坐标正确。
- 6 个面中心坐标正确。
- zero-thickness bounds 会被最小厚度扩张。

## 13.2 E2E 测试

建议扩展 `e2e/cubeview.spec.ts` 或新增：

- `e2e/workpiece-origin-selector.spec.ts`

测试入口可挂到 `window.__BABYLON_RENDERER_TEST_API__`：

```ts
getWorkpieceOriginSelectorState: () => workpieceOriginSelector.getState()
selectWorkpieceOriginCandidate: (id) => workpieceOriginSelector.selectCandidateById(id)
```

为了测试稳定，可以增加一个仅测试可用的公开方法：

```ts
selectCandidateById(id: string): boolean
```

或挂在 debug/test API 中，而不导出到正式类型。

E2E 验收：

- 页面启动后 `candidates.length === 26`。
- `boundsWorld !== null`。
- 点击或测试 API 选中一个 candidate 后 `selection !== null`。
- `selection.positionWorld` 与 candidate 坐标一致。
- 坐标轴对象存在。
- 模型 offset 后，bounds 和 candidates 坐标随之变化，selection 被清空。

## 14. 阶段实现任务拆分

## 14.1 阶段 1 任务

- 新增 `src/WorkpieceOriginSelector.ts`。
- 实现 bounds 计算。
- 实现 26 个候选点生成。
- 实现包围盒线框。
- 实现候选点可视化。
- 在 `src/index.ts` 导出。
- 在 demo 中实例化并接入模型刷新。

## 14.2 阶段 2 任务

- 增加 pointer hover。
- 增加 click selection。
- 增加 selected 状态材质切换。
- 增加 `onOriginChange` 和 `getState()`。
- 增加 `clearSelection()`。

## 14.3 阶段 3 任务

- 增加坐标轴预览。
- 坐标轴随 selected origin 更新。
- 坐标轴长度根据 bounds 自适应。
- 坐标轴不参与 picking。

## 14.4 阶段 4 任务

- 增加单位换算输出。
- 接入单位切换。
- 增加 demo 状态显示。
- 整理 CSS 或 toolbar 控制项。

## 14.5 阶段 5 任务

- 增加 E2E 测试。
- 跑 `npm run build`。
- 跑 `npm run test:e2e`。
- 根据截图或测试结果修正视觉细节。

## 15. 风险与处理

风险：候选点被模型遮挡。

处理：使用合适的 `renderingGroupId`、emissive 材质，必要时关闭深度写入或改用 billboard。

风险：拖拽相机时误触发选点。

处理：用 pointer down/up 距离阈值，只在短距离点击时选择。

风险：模型包围盒极薄导致候选点重合。

处理：zero-thickness axis 使用最小厚度扩张。

风险：与现有测试 API 或脏工作区冲突。

处理：新增文件优先，接入 `index.html` 时只修改必要 import、初始化和模型刷新位置。

风险：坐标轴方向的业务语义后续变化。

处理：第一版固定世界轴，并把 axis vectors 放入 selection 结果，后续可替换为按面法线或用户指定轴向。

## 16. 推荐第一阶段交付清单

第一阶段完成后，应包含：

- `src/WorkpieceOriginSelector.ts`
- `src/index.ts` 导出更新
- `index.html` demo 接入
- 可选：`e2e/workpiece-origin-selector.spec.ts`

第一阶段不包含：

- hover/click
- 坐标轴预览
- UI 控制项
- WCS 导出

这样第一阶段检查重点会非常明确：只确认启动包围盒和候选点位置是否符合预期。
