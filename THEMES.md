# 主题插件开发规范

本文固定 SDK **2.1**、插件 API **2**、主题数据格式 **1** 的开发约定。主题插件使用 `.epp` ZIP 包，支持配色、组件规则、图片、字体、文本槽位及 WebGL 2 背景。官方与第三方主题共用安装、更新、启停和卸载流程。

## 版本与兼容

| 项目         | 当前约定                                                   |
| ------------ | ---------------------------------------------------------- |
| 插件清单     | `apiVersion: 2`、`kind: "theme"`、`sources: []`            |
| 主题数据     | `version: 1`                                               |
| SDK          | 2.1 提供主题类型与 JSON Schema；来源插件可继续固定 SDK 2.0 |
| 宿主         | 需要包含主题插件加载能力的新版 Easy Player                 |
| 旧自定义主题 | 旧 JSON/ZIP 导入入口已移除；新主题统一制作 .epp  |

API 2 本身不能表示宿主是否支持主题；当前没有 `minAppVersion` 自动协商。发行说明必须注明所需宿主能力，官方主题索引应在支持主题的宿主交付后发布。插件版本独立于 SDK 与主题格式版本；修改已发布包的内容时递增插件 `version`，保持 `id` 不变。移除字段、改变含义或槽位行为属于契约变更，先修改 SDK、宿主、Schema、测试与文档，再同步本仓库的契约快照。

## 作者与重名

插件清单可选 author 对象，name 必填、去空白后非空、最长 120 个字符串长度单位；url 可选，必须为不含用户名/密码的 HTTPS 地址，最长 2048。旧包省略作者时显示“作者未提供”。作者表示插件维护者，素材原作者与授权继续在许可文件中声明。

插件以 id 为唯一身份；displayName、theme.displayName 和本地化名称允许重复。不同 ID 可并存；相同 ID 的导入按版本更新处理，不会因名称或作者变化而成为另一个插件。低版本被拒绝，同版本当前允许重新导入；正式发布内容变化仍需升版。插件列表显示作者与 ID，外观卡片通过悬停信息显示作者，名称重复时同时显示 ID。

作者信息是声明式展示信息，不作为发布者认证或官方标记。第三方建议使用账号/组织前缀，如 alice.nyan-cat；不要借用其他项目 ID。当前没有第三方 ID 全局注册或签名验证，导入同 ID 包时按更新语义处理。官方身份由可信索引与内容哈希确定，第三方不能使用 builtin. 前缀。

## 最小静态主题

目录示例见 [examples/midnight](examples/midnight)，只需要以下两个文件。JSON 与文本使用 UTF-8、无 BOM。

manifest.json：

```json
{
  "id": "example.midnight",
  "displayName": "Midnight",
  "author": { "name": "Your name", "url": "https://example.com" },
  "version": "1.0.0",
  "apiVersion": 2,
  "sources": [],
  "kind": "theme",
  "theme": {
    "displayName": "Midnight",
    "names": { "zh": "午夜", "en": "Midnight" }
  }
}
```

`id` 匹配 `^[a-z][a-z0-9._-]{0,95}$`，第三方不得使用 `builtin.` 前缀，建议采用自己维护的命名空间。版本使用 `主.次.修订`，可带 `-预发布标识`，长度不超过 64；不使用 `+build` 后缀。名称建议不超过 120 个 JavaScript 字符串长度单位；`theme.displayName` 与可选的 `zh/en` 名称由宿主强制检查此上限。

theme.json：

```json
{
  "version": 1,
  "colorMode": "dark",
  "accentColor": "#a5b4fc",
  "headerBackground": "#14152b",
  "footerBackground": "#101122",
  "chromeBorder": "#34365a",
  "background": "#0d0e1c",
  "tokens": { "--color-bg": "#101122", "--color-text": "#edf0ff" }
}
```

上述七个基础字段全部必填。`accentColor` 是场景强调色，`headerBackground/footerBackground/chromeBorder` 是窗口装饰颜色，支持十六进制、颜色名称、rgb(a)、hsl(a)、oklch、oklab；函数参数只使用数字与相应标点。`background` 是颜色或 CSS 渐变，也是动态背景不可用时的回退；禁止 URL、变量引用及脚本。

`colorMode` 表示设计模式，不自动修改用户的浅色/深色选择。背景仍可在其他模式显示，宿主增加相应可读性处理；tokens、rules、资源槽位和文本仅在设计模式匹配、当前背景选中且未被原生材质或自定义主题背景覆盖时应用。用户明确选择的自定义主题 tokens、同名规则属性、字体/图片槽位及文本优先；切换基础背景会关闭旧自定义主题背景。

## 变量与组件规则

沿用原第三方主题的安全 CSS 语法：

- `tokens` 最多 64 项，变量前缀只允许 `--color-`、`--btn-`、`--scrollbar-`、`--app-`、`--ep-`、`--lrc-`、`--motion-`；值允许颜色、长度、阴影、渐变与安全的变量引用。
- `rules` 最多 128 个选择器，每个最多 64 条属性。选择器只允许 `.ep-*` 组件类，可用单个空格连接后代类，每段可带一个 `:hover`、`:focus-visible` 或 `:disabled`。
- 属性名匹配 `^[a-z][a-z-]*$`；属性值交由 Chromium `CSS.supports` 校验。每个变量或属性值为 1–500 个字符串长度单位，禁止 URL、image-set、expression、CSS 转义、注释、控制字符、分号、花括号、HTML 符号及 `!important`。

宿主将 tokens 写成根级 `!important`，rules 与资源槽位生成普通 CSS。作者规则在槽位规则后应用；`background` 简写会重置槽位背景图，只修改底色时使用 `background-color`。根级变量不能跨元素覆盖后代的局部变量，组件内联样式、用户显式设置和实际 CSS 优先级仍生效。变量与组件类参考宿主仓库的 [变量文档](https://github.com/Huiiro/easy-player-v4/blob/master/docs/theme-variables.md)。

## 资源、插槽与旧主题迁移

完整示例见 [examples/nyan-cat](examples/nyan-cat)。原资源清单的 `resources/slots/text/licenses` 原样放入新 theme.json 的 `assets` 对象；原 theme.json 的 `tokens/rules` 保留。原 `background: replace/inherit` 改由外观中的插件背景选择控制。

```json
{
  "assets": {
    "resources": {
      "cute": { "type": "font", "path": "fonts/kuaile.ttf", "weight": "400" },
      "cat": { "type": "image", "path": "images/nyan-cat.png" },
      "sky": { "type": "image", "path": "images/starfield.png" }
    },
    "slots": {
      "global": { "font": "cute" },
      "appBackground": { "image": "sky" },
      "playbackThumb": { "image": "cat" }
    },
    "text": { "appTitle": "Nyan Player", "homeWelcome": "Nyan~ 今天也要开心听歌喵！" },
    "licenses": ["fonts/OFL.txt"]
  }
}
```

`assets` 存在时，`resources` 和 `slots` 必填，可为空对象。资源 ID 匹配 `^[a-z][a-z0-9-]{0,63}$`。图片支持 PNG/JPEG/WebP/GIF，字体支持 WOFF/WOFF2/TTF/OTF；宿主检查扩展名与文件头，实际可解码性以 Chromium 为准。字体可声明 `weight`（100–900 的百位值，或两个值构成的范围）和 `style: normal/italic`；不指定时为 400、normal。

| 槽位                                                        | 图片 | 字体 |
| ----------------------------------------------------------- | ---- | ---- |
| appBackground                                               | 是   | 否   |
| home、sidebar、header、footer、button、dialog、drawer、menu | 是   | 是   |
| playbackThumb                                               | 是   | 否   |
| global                                                      | 否   | 是   |

槽位只能引用已声明且类型匹配的资源。普通图片使用背景图、居中、cover、无重复；playbackThumb 使用播放进度滑块专用图片变量，支持原轨道与滑块尺寸变量。字体通过 FontFace 注册，作者不要写死宿主生成的字体族名或资源 URL。包字体不自动共享到独立的迷你播放器、桌面歌词窗口。

文本只支持 appTitle（主窗口品牌文字）与 homeWelcome（首页欢迎语），每项最多 200 个字符串长度单位，以纯文本显示，不解析 HTML。用户自定义欢迎语继续优先；空白欢迎语继续回退。授权文件随包保留，不作为运行时图片或字体提供。

## WebGL 2 动态背景

在 theme.json 中增加：

```json
{ "shader": { "fragment": "fragment.glsl", "textures": [] } }
```

片元程序使用 GLSL ES 3.00，首行以 `#version 300 es` 开头，不含 NUL。宿主提供固定全屏三角形顶点程序及以下 uniforms：

| 名称         | 类型与含义                        |
| ------------ | --------------------------------- |
| u_resolution | vec2，画布像素尺寸                |
| u_time       | float，累计活动秒数；暂停时不推进 |
| u_pointer    | vec2，归一化指针，范围 -1 到 1    |

可选最多四张纹理，每项声明 `uniform/path/width/height/format`。uniform 匹配 `^u_[a-z][a-z0-9_]{0,63}$`，各项唯一，不能使用上述保留名称。`format: rg32f` 使用 .bin，小端 Float32 双通道，字节数必须为 width × height × 8，所有浮点数有限；`format: image` 使用包内 PNG/JPEG/WebP/GIF，声明 width/height 必须与解码后的实际尺寸一致，按 RGBA8 基础像素计入预算。两者单边尺寸均为 1–2048。浮点查表使用 NEAREST 采样与 CLAMP_TO_EDGE，需要插值时由 shader 实现。

动画调度、30 FPS 上限、自适应分辨率、窗口隐藏/失焦、减少动态效果、播放器遮挡和 GPU 清理由宿主管理。编译、链接或资源加载失败时保留静态背景并提示；资源未加载完成前不初始化 GPU。GLSL 只能在背景画布运行，无法调用 Node、IPC、DOM 或网络。复杂 shader 的 GPU 开销仍需在目标硬件验证。

图片纹理在解码时翻转 Y，按 WebGL 左下原点上传，使用 LINEAR_MIPMAP_LINEAR / LINEAR 和 CLAMP_TO_EDGE，并生成 mipmap；动画图像只取解码的静态帧。shader 可用 textureSize 获取原始图片尺寸。四张纹理合计预算为 16 MiB，rg32f 按每像素 8 字节、image 按每像素 4 字节计算；mipmap 与驱动可能额外占用 GPU 内存。

shader 可选 fps（1–30 的整数），默认 30。宿主统一执行暂停、减少动态效果和清理。新增的 image 类型需要包含图片纹理能力的新版宿主，旧宿主会拒绝不支持的格式。雨夜示例位于 [themes/rainy](themes/rainy)，使用包内街景图片、24 FPS 与原雨滴算法，归属记录保留在 licenses/NOTICE.txt。

黑洞示例位于 [themes/blackhole](themes/blackhole)：构建阶段计算轨道查表，应用只执行通用背景加载器。

## 路径与容量

包内文件一律使用相对路径、正斜线和 ASCII 字母、数字、短横线、下划线；目录分段后跟单个文件扩展名，路径最多 160 个字符。不使用绝对路径、..、大小写冲突、符号链接或包外引用。只打包 manifest.json、theme.json、声明的资源/着色器/纹理/授权文件，以及可选 licenses/ 下的 .txt；图片设计源文件如 SVG 保存在源码中，不加入运行包。

| 项目                       | 上限                             |
| -------------------------- | -------------------------------- |
| .epp 压缩包                | 16 MiB                           |
| ZIP 条目（包括目录）       | 128                              |
| 解压总量                   | 32 MiB                           |
| 单文件                     | 16 MiB，另有更小限制时按下方执行 |
| manifest.json / theme.json | 各 128 KiB                       |
| GLSL                       | 256 KiB                          |
| 图片/字体资源              | 64 项                            |
| 声明的授权文件             | 8 项，路径唯一，各 64 KiB        |
| shader 纹理总量            | 16 MiB                           |

仅支持 Store 或 Deflate 压缩，禁止加密、重复条目和未声明文件。字体与图片继续按原主题导入规则校验。第三方主题不能携带 JS、CJS、Vue 或 HTML 入口。官方主题可按下节声明受限 renderer 入口。原自定义主题 ZIP 的容量与预览行为继续按原格式执行。

## Schema、构建与联调

[schemas/theme-plugin-manifest.schema.json](schemas/theme-plugin-manifest.schema.json) 和 [schemas/theme.schema.json](schemas/theme.schema.json) 随 SDK 2.1 分发，本仓库固定一份带 SDK 版本及 SHA-256 的 [契约快照](schemas/contract.json)。可在编辑器的 json.schemas 中关联它们，也可使用 JSON 的可选 $schema 字段。Schema 提供结构校验；资源引用、签名、纹理字节数、CSS 支持与 ZIP 限制仍由宿主做最终校验。

```sh
npm ci --ignore-scripts
npm run pack:theme -- examples/nyan-cat dist/examples
npm run build:examples
npm run build
npm test
```

pack:theme 校验 Schema、槽位引用、文件路径及容量，文本统一 LF，二进制保持不变，ZIP 平台/权限/时间固定。产物命名为 `id-version-sha256前12位.epp`，相同输入在 LF/CRLF 工作区生成相同哈希。路径可来自仓库外的独立主题目录；其资源必须位于该主题目录内。

build 生成官方五个来源包、黑洞、雨夜及八个个性化主题包和 catalog.json；build:examples 的第三方示例位于 dist/examples，不加入官方索引。主题包制作与运行不需要宿主源码；源码中的构建脚本只在作者机器运行。

在「设置 → 插件 → 导入本地包」选择 .epp，启用后在外观中选择主题并匹配设计明暗模式。导入不自动切换背景，也不触发旧主题格式的 10 秒预览。第三方主题更新通过重新导入更高版本包完成；当前仅官方主题提供索引更新，不访问第三方清单中的远端地址。

停用/卸载会撤销样式、字体、文本和资源访问；背景选择保留，缺失时回退至默认，重新启用或安装相同 ID 后恢复。资源 URL 包含当前包的 SHA-256，旧版本或未声明路径无法访问。安装更新先验证新包，再提交安装指针；提交失败恢复旧版本。GPU 编译失败属于显示回退，不自动回滚已安装版本。

## 发布前检查

1. 在独立目录运行 npm ci、构建与测试，确认无需引用宿主内部模块。
2. 验证明暗模式、中文/英文/数字字体、图片解码、文本回退和真实进度滑块。
3. 验证自定义主题覆盖、原生材质、减少动态效果、窗口隐藏及失焦行为。
4. 验证导入、重启、更新、停用、再启用、卸载及故障回退，保留素材授权。
5. 内容变更递增插件版本；官方包构建后提交 catalog.json，再由 Publish official plugins 工作流上传包及索引。

SDK 维护者在宿主执行 `npm run sync:theme-contract` 更新此处 Schema，`npm run test:theme-contract` 检查快照与宿主规则；随后分别提交两个仓库。普通插件开发不需要该同步命令或宿主检出。

背景资源槽位可使用 --ep-background-image-overlay 指定图片上方的安全渐变，默认透明；--ep-background-scrim 控制深色系统背景的可读性遮罩，默认使用宿主遮罩。浅色模式继续使用宿主统一遮罩。二者与其他 tokens 一样，只在相应主题生效时应用。

## 官方 Canvas / SVG / CSS 背景

极光、深海、日落、森林、矩阵、星空、星轨和 DNA 双螺旋分别位于 themes/ 下的同名目录，初始版本 1.0.0。Background.vue 保留原绘制与低开销动画，theme.json 声明 renderer: { entry: "background.js" }，与 shader 互斥。源码和 Vue 编译器仅在构建阶段使用，运行包只有清单、主题数据、脚本和许可，脚本最大 2 MiB。

此入口只允许固定官方索引或宿主种子认证的包。打包工具要求官方保留 ID，但 ID 本身不能证明身份；未被索引认证的本地包仍会被宿主拒绝。第三方继续使用数据和 shader 格式，不执行 JS。

宿主生成固定 HTML，在 sandbox="allow-scripts"、不包含 allow-same-origin 的背景框架中加载脚本。框架没有 Node、preload 或宿主 API，无法读取父文档，CSP 禁止网络连接、嵌套页面等能力。宿主只下发 paused/dispose，框架只报告 ready/failed；双方按消息来源校验。动画暂停、减少动态效果与窗口可见性继续由宿主管理，框架移除后销毁文档与图形资源。此机制不承诺独立 OS 进程或 CPU/内存硬配额。

scripts/build-renderer-themes.mjs 在本仓库编译 Vue 组件与作用域样式，将本地 SVG 图片内嵌到脚本，并记录 Vue 运行时依赖的 MIT 许可。主题不读取应用模块、应用路径或外部运行时依赖。themes/runtime.ts 与 Vue 版本变化可能影响八个包，发布后所有内容受影响的插件都应升版。

旧 aurora/ocean/sunset/forest/matrix/starfield/startrails/dna 名称不再兼容或映射，读取旧配置时回到默认无背景。用户重新选择 plugin:builtin.theme.<ID> 后，缺失插件时回退并保留该插件选择，重新启用后恢复。
