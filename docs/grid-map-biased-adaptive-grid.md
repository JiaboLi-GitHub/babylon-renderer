# 偏置自适应正方形网格说明

## 1. 目的

`GridMap` 现在支持“偏置自适应正方形网格”。

这个能力解决的问题是：模型整体偏在某一侧时，如果网格仍然严格以世界原点做对称展开，会留下大面积无效空白区域；但如果直接改成矩形网格，又会破坏原本比较稳定的正方形视觉。

因此当前目标变成：

- 网格范围仍然由模型内容驱动
- 网格仍然保持正方形
- 网格允许相对原点发生偏置
- 模型四周保留更大的空白边缘

例如模型主要位于：

- `x: 0 ~ 500`

旧版对称网格可能是：

- `x: -500 ~ 500`

现在的目标更接近：

- 网格仍是正方形
- 但其中心可以偏向模型分布
- 模型四周会保留更宽松的留白

---

## 2. 核心定义

“偏置自适应正方形网格”的含义是：

- 网格范围由模型在 `XY` 平面的 footprint 驱动
- `X/Y` 方向先独立估算内容范围
- 最终渲染结果统一收敛成正方形
- 正方形位置允许偏向模型
- 默认仍保留原点语义

换句话说，它不是“原点居中的正方形”，也不是“完全自由的矩形”，而是“内容驱动的偏置正方形”。

---

## 3. 当前默认策略

当前 `GridMap` 的边界计算流程如下：

1. 读取模型世界包围盒
2. 提取 `minX/maxX/minY/maxY`
3. 分别对 `X/Y` 做内容 padding
4. 默认保证原点 `0` 仍落在网格范围内
5. 根据当前主刻度向外吸附
6. 取 `X/Y` 中更大的跨度，统一扩成正方形
7. 再额外放大一圈方形留白

当前默认配置：

```ts
includeOriginInBounds: true
squarePaddingRatio: 1.35
```

这意味着：

- 网格会偏向模型，而不是强制居中
- 网格最终仍是正方形
- 原点默认仍可见
- 正方形边缘会比之前保留更大的空白区域
- 网格外边界在模型确定后保持稳定，不会随相机缩放反复跳动

---

## 4. 当前实现方式

实现文件：

- [src/GridMap.ts](/D:/babylon-renderer/src/GridMap.ts)

### 4.1 两阶段范围计算

当前实现采用两阶段策略：

第一阶段，先估算模型驱动的内容范围：

```ts
minXWorld
maxXWorld
minYWorld
maxYWorld
```

第二阶段，在主刻度吸附后统一扩成正方形，并输出：

```ts
minXValue
maxXValue
minYValue
maxYValue
widthValue
heightValue
```

其中：

- `World` 表示 Babylon 世界坐标
- `Value` 表示标签和刻度使用的显示数值

### 4.2 正方形收敛

`X/Y` 两个方向仍然会先分别做内容范围估算，但最终不会直接按矩形渲染，而是：

- 先求出当前 `X/Y` 中更大的已吸附跨度
- 再把两个方向都扩展到同一个跨度
- 保证最终 `widthValue === heightValue`

这样做的结果是：

- 保留模型偏置效果
- 保留正方形网格观感
- 避免一个方向明显过长、另一个方向明显过短

### 4.3 更大的边缘留白

当前新增了：

```ts
squarePaddingRatio?: number
```

默认值：

```ts
1.35
```

这个参数的作用是：在已经得到正方形主跨度之后，再额外放大一圈，让模型四周的空白区域更宽松，避免内容过于贴边。

### 4.4 标签跟随正方形边界

正方形网格落地后，标签逻辑继续保持：

- 右侧标签基于当前方形边界放置
- 底部标签基于当前方形边界放置
- 坐标标签只显示主刻度，不显示边界值
- 标签固定视觉大小
- 标签固定视觉边距

因此这次改动不会破坏原有标签可读性。

### 4.5 边界与刻度解耦

当前实现中：

- 网格边界会在 `fitToMeshes()` 时一次性稳定下来
- 相机缩放时，只更新主刻度/次刻度密度和标签布局
- 外边框不再跟着主刻度档位一起重新吸附

这可以避免缩放过程中出现“边缘跳动”。

---

## 5. API 变化

### 5.1 `GridMapOptions`

当前与该功能直接相关的配置：

```ts
interface GridMapOptions {
  modelPaddingRatio?: number
  squarePaddingRatio?: number
  includeOriginInBounds?: boolean
}
```

说明：

- `modelPaddingRatio` 控制模型内容范围的基础扩边
- `squarePaddingRatio` 控制正方形最终额外留白
- `includeOriginInBounds` 控制是否强制把原点纳入网格

### 5.2 `GridMapState`

当前状态对象包含以下关键字段：

```ts
interface GridMapState {
  minXValue: number
  maxXValue: number
  minYValue: number
  maxYValue: number
  widthValue: number
  heightValue: number
}
```

其中：

- `min/max X/Y` 用于判断偏置方向
- `widthValue` 和 `heightValue` 用于确认最终正方形范围

---

## 6. Demo 接入方式

当前 demo 接入方式不变：

```ts
const gridMap = new GridMap({
  scene,
  camera,
  canvas: mainCanvas,
})

gridMap.fitToMeshes(modelRoot.getChildMeshes())

engine.runRenderLoop(() => {
  gridMap.update()
  scene.render()
})
```

模型切换或模型位置变化后，继续调用：

```ts
gridMap.fitToMeshes(modelRoot.getChildMeshes())
```

调试状态继续通过：

```ts
gridMap.getState()
```

---

## 7. 回归验证

当前已经补充自动化回归，覆盖以下关键行为：

- 加载 STEP 后，网格会根据模型自适应
- 模型整体偏移后，网格边界会随之偏置
- 偏置后的网格仍保持正方形
- 正方形跨度会大于旧的最小基础范围，确保有更大的边缘留白
- 相机缩放时，网格边界保持稳定，只允许刻度密度变化

相关测试文件：

- [e2e/cubeview.spec.ts](/D:/babylon-renderer/e2e/cubeview.spec.ts)

---

## 8. 后续建议

后续还可以继续增强：

- 增加 `setBounds()`，允许主项目直接输入边界
- 提供更细的留白策略，例如按方向设置不同 margin
- 增加 `includeOriginInBounds: false` 的业务示例
- 改为 2D overlay 文本标签，进一步减小透视形变影响

---

## 9. 结论

现在的 `GridMap` 已经从“原点对称正方形网格”升级成“模型驱动的偏置自适应正方形网格”：

- 更贴合模型分布
- 仍保持正方形视觉
- 原点默认仍可见
- 模型四周拥有更宽松的留白

对主项目而言，继续调用以下接口即可使用这套能力：

- `fitToMeshes()`
- `update()`
- `getState()`
