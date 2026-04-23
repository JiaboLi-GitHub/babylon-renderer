# Grid Map And View Cube Module Design

## 1. 背景

当前项目已经把两个适合在主项目复用的能力拆成了独立模块：

- `GridMap`
  负责主场景里的参考网格、坐标轴、坐标标签，以及基于模型范围的网格自适应。
- `CubeView`
  负责方向导航、投影视图切换、拖拽旋转，以及将交互结果通过事件回传给主项目。

这两个模块的目标都不是管理模型生命周期，而是作为 Babylon 场景上的可插拔辅助组件存在。

相关实现文件：

- [src/GridMap.ts](/D:/babylon-renderer/src/GridMap.ts)
- [src/CubeView.ts](/D:/babylon-renderer/src/CubeView.ts)
- [src/index.ts](/D:/babylon-renderer/src/index.ts)

---

## 2. 总体目标

主项目接入时应满足以下目标：

- 可以直接 `import` 模块并实例化使用
- 模块不持有主项目的业务状态
- 模块可随着模型和相机状态持续更新
- 模块具备明确的 `dispose()` 释放能力
- 模块默认效果可直接使用，并支持少量关键参数调节

---

## 3. 模块一：Grid Map

## 3.1 模块定位

`GridMap` 是主场景中的空间参考层，用于帮助用户理解模型在世界坐标中的位置、范围和方向。

它当前负责：

- 主网格与次网格
- X/Y 坐标轴高亮
- 外边框
- 坐标值标签
- 基于模型包围盒的自适应网格
- 偏置自适应正方形网格
- 标签固定视觉大小与固定视觉边距

它不负责：

- 模型导入和导出
- 相机 `fit` 逻辑
- View Cube 同步
- 业务态管理

## 3.2 核心需求

### 3.2.1 基础显示

- 在 `XY` 平面绘制网格
- 区分主网格和次网格
- 显示 X/Y 坐标轴
- 显示正方形外边框
- 显示真实坐标值标签

### 3.2.2 模型驱动自适应

网格边界应根据当前模型在世界坐标中的 `XY` 范围动态计算，而不是固定围绕原点做对称展开。

要求：

- 根据模型包围盒计算内容范围
- `X/Y` 两个方向先独立计算
- 最终网格仍保持正方形
- 正方形位置允许偏向模型
- 支持模型外边距
- 支持最小基础范围，避免小模型时网格过小

### 3.2.3 偏置自适应正方形网格

这是当前 `GridMap` 的关键能力。

当模型整体偏在一侧时，网格不再强制以原点居中的方式展开；但与此同时，最终网格仍维持正方形视觉，而不是变成任意矩形。

这意味着：

- 内容范围由模型驱动
- 网格可以相对原点发生偏置
- 最终 `width === height`
- 模型四周会保留更大的空白区域

专题说明见：

- [docs/grid-map-biased-adaptive-grid.md](/D:/babylon-renderer/docs/grid-map-biased-adaptive-grid.md)

### 3.2.4 原点策略

当前默认策略是“模型驱动，但保留原点语义”。

含义：

- 网格范围可以偏向模型
- 世界原点 `0,0` 不要求在网格中心
- 默认仍尽量把原点包含在网格内

当前对应配置为：

```ts
includeOriginInBounds: true
```

### 3.2.5 标签显示策略

坐标值标签当前满足：

- 显示真实世界坐标对应的数值刻度
- 随网格范围变化自动重建和更新
- 只显示主刻度，不显示边界值
- 相机缩放时尽量保持固定屏幕视觉大小
- 相机缩放时尽量保持与边框固定像素边距
- 标签位置基于当前正方形边界计算

### 3.2.6 相机适配

`GridMap` 会响应当前主相机的投影结果：

- 透视模式下可用
- 正交模式下可用
- 主刻度会根据当前投影密度自动调整
- 标签缩放会根据当前投影结果动态调整
- 网格外边界在模型确定后保持稳定，不随缩放档位跳动

## 3.3 当前实现方式

### 3.3.1 实现文件

- [src/GridMap.ts](/D:/babylon-renderer/src/GridMap.ts)

### 3.3.2 当前公开 API

```ts
interface GridMapOptions {
  scene: Scene
  camera: Camera
  canvas: HTMLCanvasElement
  elevation?: number
  coordinateScale?: number
  minimumHalfRangeValue?: number
  modelPaddingRatio?: number
  squarePaddingRatio?: number
  includeOriginInBounds?: boolean
  targetMajorPixelSpacing?: number
  targetLabelPixelHeight?: number
  targetLabelOffsetPixels?: number
  minorPerMajor?: number
  minMajorValueStep?: number
  maxMajorValueStep?: number
}

class GridMap {
  constructor(options: GridMapOptions)
  fitToMeshes(meshes: AbstractMesh[]): void
  update(): void
  getState(): GridMapState
  dispose(): void
}
```

### 3.3.3 当前状态输出

`getState()` 当前会返回偏置范围相关状态，便于主项目调试或做二次联动：

```ts
interface GridMapState {
  coordinateScale: number
  minXValue: number
  maxXValue: number
  minYValue: number
  maxYValue: number
  minXWorld: number
  maxXWorld: number
  minYWorld: number
  maxYWorld: number
  widthValue: number
  heightValue: number
  widthWorld: number
  heightWorld: number
  halfRangeValue: number
  halfRangeWorld: number
  size: number
  majorValueStep: number
  minorValueStep: number
  majorWorldStep: number
  minorWorldStep: number
}
```

其中：

- `min/max X/Y` 用于判断当前网格偏置方向
- `widthValue` 和 `heightValue` 用于确认最终正方形范围
- `halfRangeValue` 和 `halfRangeWorld` 当前主要用于兼容旧调试逻辑

### 3.3.4 计算流程

当前 `GridMap` 的计算策略如下：

1. 读取模型世界包围盒
2. 提取 `XY` 平面内容范围
3. 对 `X/Y` 两个方向分别做内容 padding
4. 依据 `includeOriginInBounds` 决定是否把原点纳入范围
5. 根据当前相机投影计算主刻度间距
6. 将边界向外吸附到主刻度
7. 取更大的跨度，把两个方向统一扩成正方形
8. 按 `squarePaddingRatio` 再额外放大一圈留白
9. 在 `fitToMeshes()` 时冻结最终边界
10. 生成方形网格、轴线和标签
11. 每帧根据投影结果只更新刻度密度、标签位置和缩放

### 3.3.5 主项目接入方式

当前建议的接入方式：

```ts
import { GridMap } from './src/index'

const gridMap = new GridMap({
  scene,
  camera,
  canvas,
})

function onModelChanged(root: TransformNode) {
  const meshes = root.getChildMeshes()
  gridMap.fitToMeshes(meshes)
}

engine.runRenderLoop(() => {
  gridMap.update()
  scene.render()
})
```

## 3.4 当前实现状态

`GridMap` 已经完成以下落地：

- 已从 `index.html` 抽离为独立模块
- 已从 [src/index.ts](/D:/babylon-renderer/src/index.ts) 导出
- 已支持偏置自适应正方形网格
- 已支持更大的边缘留白
- 已支持固定视觉大小标签
- 已支持固定视觉边距标签
- 已接入 demo 页面
- 已补充 e2e 回归测试

## 3.5 后续可扩展项

- 增加 `setBounds()`，允许主项目直接输入边界而不是传 mesh
- 支持 `includeOriginInBounds: false` 的更多业务示例
- 支持负数标签显示策略切换
- 支持 2D overlay 文本标签
- 支持主题和单位系统注入

---

## 4. 模块二：View Cube

## 4.1 模块定位

`CubeView` 是独立的方向导航组件，用于控制主场景相机的观察方向和投影模式。

它当前负责：

- 显示立方体方向语义
- 响应点击、右键、拖拽
- 提供 Home 按钮
- 提供 Perspective / Orthographic 切换入口
- 将朝向变化和投影变化通过事件回传给主项目

它不直接负责主相机的最终写入，而是通过事件驱动方式与主项目协作。

## 4.2 核心需求

- 点击面、边、角切换标准视角
- 拖拽进行自由旋转
- 支持中英文切换
- 支持透视/正交模式切换
- 支持 hover 高亮
- 支持主项目反向同步当前相机朝向

## 4.3 当前实现状态

当前核心实现位于：

- [src/CubeView.ts](/D:/babylon-renderer/src/CubeView.ts)
- [src/index.ts](/D:/babylon-renderer/src/index.ts)

当前已经具备：

- `onOrientationChange`
- `onProjectionModeChange`
- `setOrientation`
- `getLocale` / `setLocale`
- `clickHome`
- `dispose`

## 4.4 建议接入方式

```ts
const cubeView = new CubeView({
  canvas: cubeCanvas,
  onOrientationChange: ({ orientation }) => {
    camera.alpha = orientation.alpha
    camera.beta = orientation.beta
  },
  onProjectionModeChange: (mode) => {
    setProjectionMode(camera, mode)
  },
})

engine.runRenderLoop(() => {
  cubeView.setOrientation({
    alpha: camera.alpha,
    beta: camera.beta,
  })
})
```

---

## 5. 两个模块的协作关系

推荐分工：

- `GridMap`
  依赖主相机和模型范围
- `CubeView`
  依赖主相机朝向和投影模式

二者都不拥有模型导入流程，也不持有主业务状态。

推荐集成流程：

1. 主项目创建 Babylon 场景和相机
2. 主项目创建 `GridMap`
3. 主项目创建 `CubeView`
4. 模型切换后，主项目调用 `gridMap.fitToMeshes(...)`
5. 渲染循环中，主项目调用 `gridMap.update()`
6. 渲染循环中，主项目将当前相机朝向同步回 `CubeView`

---

## 6. 目录建议

当前目录已经可以支持模块化复用：

```text
src/
  CubeView.ts
  GridMap.ts
  stepModelIO.js
  index.ts
```

如果后续继续扩展，也可以演进为：

```text
src/
  modules/
    CubeView.ts
    GridMap.ts
  io/
    stepModelIO.ts
  index.ts
```

---

## 7. 结论

从主项目复用角度看，这两个模块已经具备继续封装的基础：

- `GridMap` 已经完成独立化，并落地了偏置自适应正方形网格能力
- `CubeView` 已经具备稳定的事件驱动接入方式

其中 `GridMap` 当前最关键的已落地能力是：

- 偏置自适应正方形网格
- 更大的边缘留白
- 固定视觉大小的坐标标签
- 固定视觉边距的坐标标签

这意味着主项目后续只需要围绕现有 API 做装配，不需要再重写一套网格计算逻辑。
