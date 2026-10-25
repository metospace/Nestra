# Everything 检测与安装

控制中心「系统 → 全局搜索」和搜索页共享安装组件。进入页面时检测；仅在用户点击
「下载并安装 Everything」后安装。未安装、已安装未启动、已连接分别展示安装入口、
启动入口和连接状态。检测失败时允许重新检测，不把异常当作未安装。

## 安装行为

- 安装目录默认选择非 C 盘，可手动填写或选择本地文件夹；不会静默回退到 C 盘。
- 从 voidtools 官方 HTTPS 地址下载稳定版 1.4.1.1032 x64 多语言安装程序，约 2 MB。
- 下载后校验固定 SHA256，校验失败禁止执行。运行官方静默安装程序，安装索引服务、
  开始菜单入口和 Everything 开机启动，普通搜索进程不以管理员身份运行。
- 安装服务可能触发 Windows UAC，用户必须在系统提示中允许；取消会保留失败原因并允许重试。
- 安装完成后后台启动 Everything，并检测主程序运行状态；索引连接由搜索中的真实查询验证，不仅凭通知窗口存在就宣称查询可用。
- 已发现的安装只提供启动，不覆盖或重置配置。关闭设置页不终止已经开始的原生安装任务。
- 下载、校验、安装和启动使用共享进度，原生端防止多个窗口重复启动安装。
- 自动流程不会添加 Everything HTTP 服务，也不下载 SDK DLL 或 ES 命令行工具。

## 固定来源与升级

安装包：https://www.voidtools.com/Everything-1.4.1.1032.x64-Setup.exe

SHA256：`c42efad041d4c0bb4d4ac97ae7cbe89f153ec1fe078772392e749c7f5d5282d3`

清单：https://www.voidtools.com/Everything-1.4.1.1032.sha256

2026-10-25 已下载核对文件与官方清单一致，Windows Authenticode 校验有效，发布者
为 voidtools PTY LTD。发布版本升级需同时人工核对新 URL、哈希与签名，再更新常量及说明；
不解析网页后执行未经固定校验的“最新版”文件。

官方安装参数说明：https://www.voidtools.com/forum/viewtopic.php?t=5673

## 验证

`tests/everything-setup.test.mjs` 用真实 Zustand store 和模拟 IPC 检查检测、防重、异步响应、
失败重试与轮询清理。原生单元测试覆盖安装目录校验、哈希拒绝和任务状态。

浏览器验收入口 `tests/fixtures/everything-setup.html` 使用内存数据：默认未安装，
`?stopped` 已安装未启动，`?running` 已连接，`?fail` 首次下载失败、再次点击重试成功。
这些页面不访问用户配置、不下载文件、不执行安装包。

真实机器端仍需在发布程序中点击安装入口完成 UAC 和首次索引验收；自动测试不会安装服务、
更改现有 Everything 或冒充真实安装完成。
