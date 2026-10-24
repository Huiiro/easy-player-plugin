# Easy Player 官方来源插件

本仓库维护 Easy Player 的网易云、酷狗、QQ 音乐、Bilibili 和 YouTube 来源插件。插件提供歌词、封面、元数据和媒体资源解析；文件写入、数据库、下载任务及工具进程由宿主管理。应用默认不附带或自动安装这些插件。

当前插件版本为 **1.1.0 / API v2**，需要支持 API v2 的 Easy Player 宿主。SDK、插件和来源数据协议独立版本管理；来源数据协议仍为 API 1。本仓库原有的旧版 DSP、字体和背景插件已移除。

## 开发和构建

使用 .nvmrc 指定的 Node.js 版本，在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm run build
npm test
```

构建输出位于 dist/，包括五个 .epp ZIP 包及 catalog.json。构建同时更新根目录中的 catalog.json，提交时应包含它。每个包包含 manifest.json、index.cjs 和依赖许可证。构建固定 ZIP 平台、权限、时间和许可证换行，并拒绝引用仓库外的构建输入或非 Node 运行时依赖。

- official/：平台入口和适配器。
- shared/：歌词清理、标题匹配、流派归一化和平台字典。
- vendor/：固定版本的 @easy-player/plugin-sdk npm 包，移动仓库无需应用或 SDK 源码。
- scripts/build.mjs：独立构建、许可证收集、完整性和索引生成。
- tests/：公共宿主接口夹具与平台响应测试，激活时不访问网络。
- distribution.json：官方分发仓库和 Release 标签。

上游网易云和酷狗 SDK 使用静态接口包装，不启动 HTTP 服务；它们随各自插件打包。上游 debug 的可选颜色依赖显式固定，避免从父目录解析依赖。插件通过包名导入 SDK，禁止导入应用内部源码。

## 发布

官方索引地址：

https://github.com/Huiiro/easy-player-plugin/releases/download/plugins/catalog.json

修改插件后递增相应入口版本，执行构建与测试，提交源码、锁文件和 catalog.json，再运行 GitHub Actions 的 Publish official source plugins。工作流从本仓库独立安装依赖，比较重建索引与已提交索引，先上传内容寻址的包，再上传索引。PLUGIN_RELEASE_TOKEN 可选，默认使用本仓库的 github.token。插件 Release 不标记为桌面应用的最新版。

已发布版本见 [Releases](https://github.com/Huiiro/easy-player-plugin/releases/tag/plugins)。旧版桌面应用的分发地址不变，本仓库的新索引仅供已支持 API v2 并切换官方地址的宿主使用。

## SDK 和宿主契约

SDK 源码由 [Easy Player 宿主仓库](https://github.com/Huiiro/easy-player-v4/tree/master/packages/plugin-sdk) 维护。本仓库使用 vendor 中固定版本的 .tgz；升级 SDK 时替换分发包，并更新 package.json 与锁文件，不直接引用宿主源码。

每次来源调用使用 context.host 注入 network.fetch 和可选 media.extractInfo，并通过 signal 响应取消。媒体提取只接受 URL 或查询和条数，宿主构建工具参数，插件不传命令或输出目录。播放器模式、准入、生命周期、文件标签写入和数据库同步由宿主管理。当前官方代码仍在主进程运行，API v2 不提供第三方权限沙箱或进程隔离。

## 与宿主联调

推荐将本仓库放在应用仓库同级的 easy-player-plugin 目录。在应用仓库运行 npm run build:plugins，将本项目构建的包同步到应用 build/plugins，并更新应用 resources/plugins/catalog.json 离线种子。其他路径通过 EASY_PLAYER_PLUGIN_DIR 指定。

应用的构建和运行只使用自己的 SDK 契约和离线种子，不读取本仓库。需要平台源码的集成回归才要求检出本仓库及安装本仓库依赖。宿主仍支持已发布的 API v1 包。
