# 工件坐标轴原点选取系统需求文档

## 1. 背景

当前项目已经具备 Babylon.js 主场景、STEP 模型加载、模型包围盒计算、自适应网格和 View Cube。下一步需要增加一个“工件坐标轴原点选取系统”，让用户可以在工件或毛坯包围盒上的候选点中选择一个点，作为工件坐标轴的原点。

参考实现来自：

- `/Users/taotu/Downloads/SceneGraph.Net/src/SceneGraph.Avalonia/Interaction/Widgets/StockFrame/StockFrameWidget.cs`
- `/Users/taotu/Downloads/SceneGraph.Net/src/SceneGraph.Avalonia/Interaction/Widgets/Constraints/BoxStockConstraint.cs`
- `/Users/taotu/Downloads/SceneGraph.Net/src/SceneGraph.GsimVisualization/StockFrameController.cs`
- `/Users/taotu/Downloads/SceneGraph.Net/src/SceneGraph.GsimSimulation/MultiSetup/WcsTransformAdapter.cs`

参考项目中的核心思想是：用一个独立 widget 管理交互状态，用 constraint 管理可选几何范围，用 representation 管理可视化，用 controller 把结果转换成坐标系或仿真 frame。本项目将复用这种分层思想，但实现方式需要适配 Babylon.js 和当前 TypeScript 模块结构。

## 2. 目标

本功能目标如下：

- 启动或模型加载后，在主场景生成一个包围盒。
- 包围盒上显示若干可选点。
- 用户可以选择其中一个点作为工件坐标轴原点。
- 选择后显示工件坐标轴预览。
- 对外暴露选取结果，供后续加工路径、导出、仿真或 UI 状态使用。
- 按阶段实现，每个阶段可独立检查。

## 3. 非目标

第一轮不包含以下能力：

- 不做完整 CAM 坐标系编辑器。
- 不做任意模型面、边、顶点拾取。
- 不做自由放置原点。
- 不做旋转角度输入面板。
- 不改 STEP 导入导出语义。
- 不改现有 `GridMap`、`CubeView` 的公共行为。

后续可以在稳定候选点选取后，再增加面选取、轴向选择、偏移、吸附模式和持久化。

## 4. 用户故事

作为使用者，我希望打开页面后能直接看到一个工件包围盒，知道当前工件的大致加工范围。

作为使用者，我希望包围盒上有明确的候选点，可以点击其中一个点，把它设为工件坐标轴原点。

作为使用者，我希望当前选中的原点有高亮状态，并能看到从该点发出的 X/Y/Z 坐标轴，确认坐标系位置。

作为开发接入方，我希望通过模块事件或状态 API 读取当前原点、坐标轴方向和包围盒信息。

## 5. 分阶段范围

## 5.1 阶段 1：静态包围盒和候选点

阶段目标：

- 启动时为当前默认模型生成一个包围盒。
- 包围盒基于当前模型世界包围盒计算。
- 包围盒线框清晰可见，不参与模型材质和阴影。
- 包围盒上生成候选点。
- 候选点默认可见，但本阶段可以只完成展示，不要求点击选中。

候选点默认集合：

- 8 个角点。
- 12 条边的中点。
- 6 个面的中心点。

合计 26 个候选点。

验收标准：

- 页面启动后能看到包围盒。
- 包围盒能覆盖默认模型。
- 候选点全部位于包围盒表面。
- 模型切换或重新加载后，包围盒和点位能跟随更新。
- 候选点大小与模型尺度相关，避免小模型看不到、大模型过大。

## 5.2 阶段 2：点位悬停和点击选中

阶段目标：

- 鼠标移动到候选点上时显示 hover 高亮。
- 点击候选点后将其设为当前工件原点。
- 选中点保持 selected 高亮。
- 空白点击不改变当前选中结果。
- 提供 `onOriginChange` 回调或等价状态读取能力。

验收标准：

- hover 点和 selected 点视觉上可区分。
- 选中一个点后，状态中能读取该点坐标。
- 再次点击另一个点会更新选中结果。
- 候选点拾取不影响 View Cube。
- 主场景相机仍可正常旋转、缩放和平移。

## 5.3 阶段 3：工件坐标轴预览

阶段目标：

- 选中原点后，在该点显示 X/Y/Z 坐标轴。
- 默认坐标轴方向与当前世界坐标一致：X 红色、Y 绿色、Z 蓝色。
- 坐标轴长度根据包围盒对角线自适应。
- 坐标轴对象不参与候选点拾取。

验收标准：

- 选中点后能看到坐标轴从该点发出。
- 坐标轴随原点选择切换位置。
- 坐标轴长度在不同模型尺寸下保持合理。
- 未选中原点时不显示坐标轴，或显示为明确的未确认状态。

## 5.4 阶段 4：模块化 API 和 Demo 接入

阶段目标：

- 新增独立 TypeScript 模块，例如 `WorkpieceOriginSelector`。
- 通过 `src/index.ts` 导出模块和类型。
- 在 `index.html` demo 中接入模块。
- 模型加载、单位切换、模型偏移时同步刷新候选点。

验收标准：

- 主项目可通过构造函数接入：

```ts
const selector = new WorkpieceOriginSelector({
  scene,
  camera,
  canvas,
  onOriginChange: handleOriginChange,
})
```

- 主项目可在模型变化后调用：

```ts
selector.fitToMeshes(modelRoot.getChildMeshes())
```

- 主项目可读取：

```ts
selector.getState()
```

- 模块提供 `dispose()`，释放所有 Babylon 资源。

## 5.5 阶段 5：回归测试

阶段目标：

- 增加或扩展 Playwright E2E 测试。
- 覆盖启动显示、候选点数量、点击选中和模型刷新。
- 必要时增加模块级单元测试。

验收标准：

- `npm run build` 通过。
- `npm run test:e2e` 中新增场景通过。
- 测试能验证候选点总数、选中状态和坐标轴状态。

## 6. 交互需求

## 6.1 默认状态

- 启动后进入“可选择原点”的展示状态。
- 包围盒和候选点默认显示。
- 没有选中点时，状态中的 `origin` 为 `null`。

## 6.2 Hover 状态

- 鼠标指向候选点时，该点变大或变亮。
- 鼠标离开后恢复普通状态。
- hover 不改变正式选择结果。

## 6.3 Selected 状态

- 点击候选点后进入 selected 状态。
- selected 点保持高亮。
- selected 状态触发回调。
- selected 状态驱动坐标轴预览。

## 6.4 Reset 状态

需要提供重置能力：

```ts
selector.clearSelection()
```

重置后：

- 清除 selected 点。
- 清除或隐藏坐标轴。
- 保留包围盒和候选点。

## 7. 视觉需求

- 包围盒使用轻量线框，颜色应区别于 `GridMap` 网格。
- 候选点使用球形或 billboard 视觉。
- 候选点优先显示在模型之上，避免被遮挡到不可用。
- hover 和 selected 状态必须可辨认。
- 坐标轴颜色遵循常见约定：X 红、Y 绿、Z 蓝。
- 所有辅助对象应命名清晰，便于调试和 E2E 选择。

建议默认视觉：

- 包围盒：青蓝色线框，透明感较弱。
- 普通点：白色或浅色。
- hover 点：黄色或高亮色。
- selected 点：橙色或品牌强调色。
- 坐标轴：三色箭头或三条带端点的线。

## 8. 数据需求

选取结果至少包含：

```ts
interface WorkpieceOriginSelection {
  id: string
  kind: 'corner' | 'edge-center' | 'face-center'
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
```

说明：

- `positionWorld` 使用 Babylon 世界坐标。
- `positionValue` 使用当前显示单位换算后的坐标值。
- 第一阶段可以只保留世界坐标，单位值在阶段 4 补齐。
- 默认轴向先使用世界轴向，后续再增加按面法线推导或手动选轴。

## 9. 异常与边界情况

- 没有模型时，使用默认包围盒或不显示 selector，由实现阶段决定。
- 模型包围盒为空时，不生成候选点。
- 包围盒某个方向尺寸为 0 时，使用最小厚度兜底，避免候选点重合到不可交互。
- 模型尺寸极大或极小时，候选点半径必须 clamp 到合理范围。
- 模型刷新后，如果原选中点不再存在，应清空选择。

## 10. 与现有功能关系

与 `GridMap` 的关系：

- `GridMap` 继续负责地面参考网格。
- 本功能负责模型三维包围盒和工件原点候选点。
- 两者都可从模型包围盒计算，但不共享渲染对象。

与 `CubeView` 的关系：

- `CubeView` 继续管理视角导航。
- 本功能只接管主场景 candidate point 的拾取。

与 STEP 导入导出的关系：

- STEP 加载完成后刷新 selector。
- STEP 导出第一阶段不带 WCS 信息。
- 后续若需要导出 WCS，需要另行定义文件格式或业务字段。

## 11. 待确认问题

- 候选点是否只放在上表面和下表面，还是使用完整 6 个面。本文档默认完整 6 个面。
- 第一版是否需要默认选中一个点，例如 `minX/minY/maxZ`。
- 工件坐标轴默认方向是否始终等于世界轴，还是根据所选面的法线决定 Z 轴。
- UI 是否需要显示当前原点坐标文本。
- 候选点是否需要支持“只显示角点、角点加边中点、全部点”的配置。
