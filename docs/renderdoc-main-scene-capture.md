# RenderDoc 主场景抓帧经验

最后验证时间：2026-04-28

## 结论

本项目可以把可见的 Babylon.js 主场景抓进 RenderDoc `.rdc` 文件里，但稳定路径不是 Chromium 默认 GPU 后端。

目前确认成功的路径有两条：

- 使用 Playwright Chromium 启动页面。
- 强制 ANGLE 走 OpenGL：`--use-angle=gl`。
- 或强制 ANGLE 走 Vulkan：`--use-angle=vulkan --enable-features=Vulkan`。
- 禁用 GPU sandbox。
- 使用 Chromium 的 GPU startup dialog 暂停 GPU 进程。
- 对 GPU 进程注入 RenderDoc。
- 页面渲染完成后立刻触发抓帧。

OpenGL 成功抓到主场景的文件是：

```text
D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc
```

Vulkan 成功抓到主场景的文件是：

```text
D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_frame803.rdc
```

Vulkan 默认场景、开启阴影、关闭 SSAO 后，成功抓到深度和阴影贴图的文件是：

```text
D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc
```

这些 `.rdc` 里都能看到主场景的蓝色立方体。

## 不稳定或未成功的路径

默认 Chromium/WebGL 抓帧可以生成合法 `.rdc`，但大多只抓到浏览器或 compositor 相关画面，没有抓到真正有用的 Babylon 主场景内容。

Vulkan 后端本身可以正常渲染页面：

```text
--use-angle=vulkan --enable-features=Vulkan
```

之前单纯依赖 `renderdoccmd inject` 时，自动化 Vulkan 抓帧没有稳定暴露可用 API target。现在确认可用的修正是：在启动 Chromium 前显式启用 RenderDoc Vulkan layer。

```powershell
$env:ENABLE_VULKAN_RENDERDOC_CAPTURE = '1'
$env:VK_INSTANCE_LAYERS = 'VK_LAYER_RENDERDOC_Capture'
$env:VK_LAYER_PATH = 'C:\Program Files\RenderDoc'
Remove-Item Env:DISABLE_VULKAN_RENDERDOC_CAPTURE_1_43 -ErrorAction SilentlyContinue
```

加上这些环境变量后，同一个 GPU PID 会从空 API target 变成 `Vulkan` target，可以正常触发抓帧。

另外，本项目当前使用的是 Babylon `Engine`，不是 `WebGPUEngine`。因此这里处理的是 WebGL 通过 ANGLE 的路径，不是原生 WebGPU 路径。

## OpenGL 成功命令

成功抓帧用到的辅助脚本命令：

```powershell
powershell.exe -ExecutionPolicy Bypass `
  -File "D:\babylon-renderer\output\rdc-tests\capture_chromium_backend.ps1" `
  -Name "pwchromium-angle-gl-main-fast" `
  -Port 9531 `
  -BackendArgs "--use-angle=gl" `
  -SceneWaitSeconds 10 `
  -TriggerDelaySeconds 0
```

关键点：

- `--use-angle=gl` 是最关键的后端参数。
- 脚本里会添加 `--disable-gpu-sandbox`。
- `--gpu-startup-dialog` 用来暂停 GPU 进程，方便在继续运行前完成 RenderDoc 注入。
- `TriggerDelaySeconds 0` 很重要。之前延迟触发时，OpenGL target 会在触发前断开。
- 成功时使用了 `RENDERDOC_HOOK_EGL=0`。

## Vulkan 成功命令

Vulkan 抓帧复用同一个辅助脚本，但需要先设置 RenderDoc Vulkan layer 环境变量：

```powershell
$env:ENABLE_VULKAN_RENDERDOC_CAPTURE = '1'
$env:VK_INSTANCE_LAYERS = 'VK_LAYER_RENDERDOC_Capture'
$env:VK_LAYER_PATH = 'C:\Program Files\RenderDoc'
Remove-Item Env:DISABLE_VULKAN_RENDERDOC_CAPTURE_1_43 -ErrorAction SilentlyContinue

powershell.exe -ExecutionPolicy Bypass `
  -File "D:\babylon-renderer\output\rdc-tests\capture_chromium_backend.ps1" `
  -Name "pwchromium-angle-vulkan-layer-main" `
  -Port 9541 `
  -BackendArgs "--use-angle=vulkan --enable-features=Vulkan" `
  -SceneWaitSeconds 10 `
  -TriggerDelaySeconds 0
```

页面侧验证到的 WebGL 后端：

```text
ANGLE (AMD, Vulkan 1.4.0 (AMD Radeon RX 7650 GRE (0x00007480)), AMD proprietary driver)
```

## Vulkan 成功抓帧证据

RenderDoc 元信息：

```text
Path:         D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_frame803.rdc
API:          Vulkan
Degraded:     no
Total events: 77
Total draws:  44
Driver:       Vulkan
```

主要 swapchain pass 和 present：

```text
EID 400  vkCmdBeginRendering(Load)
EID 432  draw
...
EID 468  final visible draw
EID 469  vkCmdEndRendering(Store)
EID 475  vkQueuePresentKHR(ResourceId::4141)
```

最终 draw 的 pipeline：

```text
Event:         468
API:           Vulkan
VS:            336 main
PS:            337 main
Render target: Swapchain Image 4141
Format:        B8G8R8A8_UNORM
Viewport:      1249x1364
```

导出的 render target 能看到完整浏览器窗口和主场景蓝色立方体：

```text
D:\babylon-renderer\output\rdc-tests\vulkan-layer-main-rt\rt_468_0.png
```

更早的主场景可见 draw：

```text
D:\babylon-renderer\output\rdc-tests\vulkan-layer-main-rt\rt_152_0.png
```

捕获缩略图：

```text
D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_thumb.png
```

## Vulkan 默认场景阴影贴图和深度图

这次验证使用默认场景，保持 Shadow 开启、SSAO 关闭。页面默认状态本身就是：

```text
ssaoEnabled = false
shadowsEnabled = true
```

抓帧命令：

```powershell
$env:ENABLE_VULKAN_RENDERDOC_CAPTURE = '1'
$env:VK_INSTANCE_LAYERS = 'VK_LAYER_RENDERDOC_Capture'
$env:VK_LAYER_PATH = 'C:\Program Files\RenderDoc'
Remove-Item Env:DISABLE_VULKAN_RENDERDOC_CAPTURE_1_43 -ErrorAction SilentlyContinue

powershell.exe -ExecutionPolicy Bypass `
  -File "D:\babylon-renderer\output\rdc-tests\capture_chromium_backend.ps1" `
  -Name "pwchromium-vulkan-shadow-on-ssao-off-depth" `
  -Port 9551 `
  -BackendArgs "--use-angle=vulkan --enable-features=Vulkan" `
  -SceneWaitSeconds 10 `
  -TriggerDelaySeconds 0
```

RenderDoc 元信息：

```text
Path:         D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc
API:          Vulkan
Degraded:     no
Total events: 157
Total draws:  101
Driver:       Vulkan
```

阴影贴图 pass 是 `EID 152`。这个 pass 由 `camStableShadowLight` 从上往下写 shadow map：

```text
Event:         152
API:           Vulkan
Draw indices:  36
Render target: 2D Color Attachment 2436
Color format:  R16G16B16A16_FLOAT
Depth target:  2D Depth Attachment 2440
Depth format:  D32
Viewport:      2048x2048
```

因为默认场景里只有一个立方体，并且 `updateCamShadowGround()` 会把阴影灯方向设成 `(0, 0, -1)`，所以从阴影灯视角看，深度图里应该接近一个正方形。实际导出的 shadow-map depth 非背景区域 bbox 是 `1384 x 1384`，符合这个预期。

原始 shadow-map depth 导出：

```text
D:\babylon-renderer\output\rdc-tests\depth-shadow-on-ssao-off-snapshot-e152\depth.png
```

便于查看的灰度归一化预览：

```text
D:\babylon-renderer\output\rdc-tests\depth-shadow-on-ssao-off-snapshot-e152\depth-e152-normalized-grayscale.png
```

注意不要把主相机 depth 和 shadow-map depth 混在一起。`EID 420` 是主相机视角下的深度附件，不是阴影贴图：

```text
Event:         420
API:           Vulkan
Render target: 2D Color Attachment 354
Color format:  R8G8B8A8_UNORM
Depth target:  2D Depth/Stencil Attachment 357
Depth format:  D32S8
Viewport:      1249x1221
```

主相机 depth 导出：

```text
D:\babylon-renderer\output\rdc-tests\depth-shadow-on-ssao-off-snapshot-e420\depth.png
```

便于查看的灰度归一化预览：

```text
D:\babylon-renderer\output\rdc-tests\depth-shadow-on-ssao-off-snapshot-e420\depth-e420-normalized-grayscale.png
```

RenderDoc 的 `depth.png` 是红通道深度可视化，直接打开会偏红且对比很低。为了肉眼检查，我额外把红通道归一化成灰度预览；原始 `depth.png` 仍然保留。

## OpenGL 成功抓帧证据

RenderDoc 元信息：

```text
Path:         D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc
API:          OpenGL
Degraded:     no
Total events: 50
Total draws:  44
Driver:       OpenGL
```

主要 backbuffer pass 从 `EID 82` 开始：

```text
EID 82  glClear white
EID 86  glDrawArrays()
...
EID 221 final backbuffer draw
EID 223 SwapBuffers(ResourceId::1000000000000000439)
```

最关键的可见场景 draw 是 `EID 86`：

```text
Event:     86
Type:      glDrawArrays()
Topology:  TriangleStrip
Triangles: 1
Instances: 1
Binding:   ps ro set 0 slot 0 _uuTextureSampler_0_S0
```

这个 draw 会采样一张包含页面渲染结果的纹理，并写入 backbuffer。导出的 render target 能看到主场景蓝色立方体：

```text
D:\babylon-renderer\output\rdc-tests\gl-main-fast-rt\rt_86_0.png
```

最终帧导出：

```text
D:\babylon-renderer\output\rdc-tests\gl-main-fast-rt\rt_221_0.png
```

捕获缩略图：

```text
D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_thumb.png
```

## Vulkan 主场景像素级验证

这段验证对应 `pwchromium-angle-vulkan-layer-main_frame803.rdc`。事件编号是 capture 内局部编号，不要和后面阴影贴图 capture 的 `EID 152` 混用。

我取了立方体中心附近 `(625, 820)` 这个像素。它在 `EID 121` 被写成白色，随后在 `EID 152` 被写成蓝色。

像素历史：

```text
EID 121: draw writes white
EID 152: draw writes blue cube color
```

最终 picked color：

```text
r = 0.262745
g = 0.811765
b = 0.949020
a = 1.000000
```

这个颜色和画面里的蓝色立方体一致。

## OpenGL 像素级验证

我取了立方体中心附近 `(625, 820)` 这个像素。它在 `EID 82` 被清成白色，随后在 `EID 86` 被写成蓝色。

像素历史：

```text
EID 82: clear to white
EID 86: draw writes blue cube color
```

最终 picked color：

```text
r = 0.05615
g = 0.62500
b = 0.88672
a = 1.00000
```

这个颜色和画面里的蓝色立方体一致。

## 重要限制

这次成功抓帧证明了主场景可见结果已经进入 `.rdc`，但它抓到的是 Chromium/ANGLE 合成到 backbuffer 或 swapchain 的结果。

在 OpenGL `.rdc` 中，立方体主要通过 `EID 86` 这个 compositor texture draw 可见。在 `pwchromium-angle-vulkan-layer-main_frame803.rdc` 中，立方体中心像素主要由 `EID 152` 写入，最终可见帧到 `EID 468`。这些 draw 仍然不是干净的 Babylon mesh draw，也没有直接暴露类似 `36 indices` 的原始立方体网格绘制和 Babylon 材质状态。更底层的 WebGL mesh 绘制很可能已经先发生在浏览器/WebGL drawing buffer texture 里，然后再由 Chromium/ANGLE 合成到 backbuffer 或 swapchain。

所以这份捕获适合用来：

- 确认最终可见帧是否正确。
- 检查 backbuffer 输出。
- 检查像素历史。
- 证明主场景不再只是空白 compositor capture。

它不太适合直接用来：

- 检查 Babylon 原始 mesh draw call。
- 调试 Babylon 材质 uniform。
- 把某一个 RenderDoc draw 精确映射回某一个 Babylon mesh。

## 快速解析命令

使用本地 RenderDoc CLI：

```powershell
& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc" info

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc" pass-stats

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc" pipeline -e 152

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-vulkan-shadow-on-ssao-off-depth_frame1025.rdc" snapshot 152 `
  -o "D:\babylon-renderer\output\rdc-tests\depth-shadow-on-ssao-off-snapshot-e152"

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_frame803.rdc" info

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_frame803.rdc" pass-stats

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-vulkan-layer-main_frame803.rdc" events

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc" info

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc" pass-stats

& "C:\Users\Administrator\.codex\vendor_imports\renderdoc-mcp\bin\renderdoc-cli.exe" `
  "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc" events
```

使用 `rdc` 和 RenderDoc Python module：

```powershell
$env:RENDERDOC_PYTHON_PATH = (Resolve-Path "D:\babylon-renderer\output\rdc-tests\renderdoc-py143").Path
$rdc = "D:\babylon-renderer\output\rdc-tests\rdc-venv\Scripts\rdc.exe"

& $rdc --session glmain open "D:\babylon-renderer\output\rdc-tests\pwchromium-angle-gl-main-fast_frame798.rdc" --timeout 30
& $rdc --session glmain draw 86
& $rdc --session glmain bindings 86
& $rdc --session glmain pipeline 86 --json
& $rdc --session glmain pixel 625 820 221
& $rdc --session glmain pick-pixel 625 820 221 --json
& $rdc --session glmain close
```

## 后续方向

如果后面需要看到更原始的 Babylon mesh-level WebGL draw，可以继续尝试把抓帧点往 WebGL command stream 靠近，而不是只抓 Chromium compositor 输出。

可以考虑：

- 调整 Chromium/ANGLE 启动和触发时机，让 RenderDoc 在 WebGL canvas render target 活跃时抓帧。
- 尝试 Electron 或其他更容易隔离 WebGL context 的 PC 套壳。
- 简化场景并强制连续渲染，再在 Babylon render pass 期间触发。
- 继续测试更长生命周期的 OpenGL target，减少浏览器 UI 和 compositor 干扰。

对当前目标来说，ANGLE OpenGL 和 ANGLE Vulkan 路线现在都已经有可复现的工作基线。Vulkan 路线的关键差异是必须显式启用 RenderDoc Vulkan layer。
