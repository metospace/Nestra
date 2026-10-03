# 可用性修复与验证（2026-10-02）

本轮按用户反馈检查现有 Tauri 项目，参考用户指定的
[SnowDesktop](https://github.com/FreeFallingSnow/SnowDesktop) 的功能组织。
已读取 README，并通过 GitHub 连接器核对
[`everything_search.cpp`](https://github.com/FreeFallingSnow/SnowDesktop/blob/main/src/everything_search.cpp)、
[`quick_navigation_everything_search.cpp`](https://github.com/FreeFallingSnow/SnowDesktop/blob/main/src/quick_navigation_everything_search.cpp)
及桌面输入宿主策略。参考其异步查询与错误反馈组织，未移植其 C++ 源码。
Nestra 继续采用现有真收纳模型，现有映射与标签页功能保留。

## 已确认的代码缺陷与修复

| 问题 | 调整 |
| --- | --- |
| `applyRemoteState` / 保存完成后调用 `ensureLayouts`，无论布局是否变化都触发保存 | 仅补入新布局时保存；已有布局不产生跨窗口回写。回归测试覆盖两次无变化调用及新增布局 |
| 手动打开程序时管理器隐藏；首次空桌面提示没有交互入口 | 手动启动显示管理器；桌面增加新建、搜索、管理按钮，按钮与欢迎卡均纳入原生命中区域 |
| 多份进程可同时控制原生图标、桌面层及状态文件 | Windows 会话内使用命名 mutex；重复运行打开已有管理器并退出新进程 |
| 所有启动入口只打开解析后的 `.lnk` 目标，丢失参数、工作目录、启动元数据 | 通过 Windows Shell 打开原始快捷方式；虚拟系统入口仍使用 shell URI；打开失败显示反馈 |
| 输入挂接使用调用线程，释放线程不稳定；重复申请焦点会重新执行 WebView MoveFocus | 原生申请与释放固定在 WebView 所属线程，确认真实键盘焦点后返回；已有输入会话复用；完成原生焦点切换后恢复 DOM 输入焦点 |
| 在其他应用中使用搜索热键，搜索仍被置于其他窗口下方 | 此时使用普通管理器搜索窗口；桌面上的搜索按钮继续使用桌面弹层 |
| 显示器断开或旧坐标无效后，面板可能永久位于不可见区域 | 自动找回不可达标题栏；有效位置和隐藏状态保留；测试覆盖断屏、无效坐标与副屏布局 |
| 图标整批失败无限重试，缺失响应留住“正在解析”占位 | 32 项分批解析；失败和缺失响应使用会话负缓存；阻塞 Shell 提取移入 blocking worker；COM 初始化成对释放 |
| 桌面宿主仅按窗口子类发现 | 校验 Progman/WorkerW 所属进程与系统 Shell 一致，再确认 DefView 子窗口 |
| 搜索仅覆盖桌面快照与映射目录，未接入 Everything | “全部”合并本机 Everything 索引；新增独立 Everything 范围；未运行、查询失败及超时明确反馈；索引结果显示完整路径 |

Everything 使用官方 QUERY2W / WM_COPYDATA 协议，通过独立 worker 上的临时消息窗口接收结果。
查询发送与回复均有超时；Unicode 路径、返回数量、偏移与终止符做边界检查。
直接使用索引中的路径与目录类型，不同步读取离线磁盘的元数据、解析快捷方式或提取图标。
搜索结果只用于打开文件，不写入桌面成员列表或持久化引用。
需要运行本机 Everything 主程序并启用 IPC；无需安装 DLL、CLI 或开启 HTTP。
默认实例与旧 1.5a 默认实例可识别；自定义命名实例暂未配置。

## 验证边界

- `pnpm build` 通过；`cargo check` 通过。
- 前端及行为回归测试 44 项通过；Rust 单元测试 14 项通过。
- Everything 测试覆盖真实 Windows 消息窗口之间的协议收发、Unicode 结果、截断与恶意偏移、无回复超时和未运行回退；前端覆盖单字查询、局部范围、跨来源去重与提供者失败。
- 当前未检测到运行中的 Everything。真实索引查询尚未实机验收，协议测试使用独立测试提供者，不等价于真实 Everything 验收。
- 正式版本已运行：管理器搜索框实际输入“报告”，界面显示 Everything 未运行及当前局部搜索范围；升级后状态文件 SHA256 与升级前备份一致。管理器输入可用不等价于桌面 NOACTIVATE 层的输入验收。
- 已使用 Computer Use 查看管理器、实际桌面面板、原生图标共存和完整搜索弹层；确认隐藏管理器可用。
- 实际再启动一份进程：新进程退出，仍只有一份 Nestra，已有管理器重新显示。
- 初次窗口验收检查点的状态文件 SHA256 与备份一致，未发现保存乒乓。后续复核时 customGroups / panelLayouts / tabGroups 已有变化，未还原或覆盖这些变化。本轮 UI 操作没有移动或删除用户文件。
- 输入检查发现 UI Automation 焦点一度仍报告文档；据此补了焦点完成通知、DOM 焦点恢复、重复申请复用与真实 Win32 焦点验证。
- 后续桌面验收被其他前台应用遮挡、`coordinate input geometry is unavailable` 和窗口捕获内容不对应目标等工具问题限制；最终版桌面输入尚未完成真实键盘验收。
- 本轮没有完成新建 → 原生桌面拖入 → 打开 → 跨区移动 → 拖回桌面 → 解散 → 重启的完整实机链路；不会用单元测试代替该验收。
- `ui-test` 仅用于工具发现桌面窗口。交付的 `releases/usability-20261002/Nestra.exe` 使用正式配置，未启用该 feature。

验收前状态备份：`releases/usability-20261002/state-before-test.json`。
升级前当前状态备份：`releases/usability-20261002/state-before-upgrade.json`。
这些文件仅用于本机复核，不作为发布资源。

正式 EXE SHA256：`581CDFE28EA93DEC274E4B6EA4ECE19B7E72FE86EF69F51A4A5076C8606D5838`。
