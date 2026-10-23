# Nestra 开发规则（借鉴 DustDesk 实战经验）

> 本文档记录 Windows/Tauri 平台的踩坑规则与行为约定。改动窗口、拖拽、
> 图标、持久化相关代码前，先读对应章节。

## 图标加载（性能关键）

- 桌面扫描**不得同步提取 Shell 图标**——逐项 `IShellItemImageFactory` 提取
  会把面板打开时间放大到秒级。快照必须先返回无图标结果。
- 图标通过批量命令（`resolve_icon_pairs`）异步补齐；前端必须维护内存缓存
  （`state.iconUrls`），只对缓存缺失的路径发起解析。
- 解析失败是正常情况（shell: 入口等），前端渲染字形徽章兜底，不得反复重试。

## 状态持久化

- 所有写盘走 `savePersistedState`，且必须经过 `persistChain` promise 链串行，
  禁止并发 invoke `save_state`（后一次覆盖前一次）。
- 加载快照时清理幽灵数据：`foldedItems` / `itemOrders` / `launcherIds`
  中指向已不存在条目的记录要剪掉。
- **禁止在远端套用路径里触发回写**：`applyPersisted` 必须置
  `suppressPersistWatch`，否则 deep watch → scheduleSave → emit →
  对方再套用再回写，两个窗口形成保存乒乓死循环，旧快照会随机冲掉
  新数据（"收纳区建完就消失"的根因）。
- **跨窗口写入必须三方合并**：`scheduleSave` 落盘前先读磁盘，用
  `mergePersisted(lastSynced, local, disk)` 合并（按 key 并集、尊重单边
  删除、冲突远端胜）；`applyRemoteState` 同理合并而不是整体替换，
  保住本窗口未保存的改动。新增持久化集合字段时同步扩展 mergePersisted。
- `hideNativeIcons` 迁移：旧版默认接管写死了 true，启动时
  `apply_takeover` 按 `coexistMigrated` 标记复位一次；前端快照必须
  始终携带 `coexistMigrated: true`，丢标记会导致每次启动重复复位。

## 行为语义（真收纳模型，用户数据安全）

- **收纳区 = 真实目录**：`Desktop\.nestra\<分区目录名>\`（`.nestra` 带隐藏
  属性）。把项目拖进收纳区 = 文件真实移入该目录，桌面原生图标随之消失；
  拖出 / 「放回桌面」= 移回桌面顶层。成员资格由路径决定（entry.zone），
  前端不维护归类映射。
- 收纳区目录名 = 组名净化（去非法字符 + 去重），改名时目录同步改名。
- **删除收纳区必须先 dissolve**：目录内容全部放回桌面后再删目录——
  任何删除操作都不得让用户文件消失。
- 快捷启动是纯引用例外：只存条目 id，绝不移动文件。
- 删除文件只有一条路：用户显式选择「移到回收站」（trash::delete 可撤销）。
- 托盘隐藏不是退出；退出走托盘菜单。

## Windows / Tauri 兼容性（来自 DustDesk 的血泪规则）

- 不要在同步 Tauri command 或事件回调里创建/销毁/显示/隐藏窗口——Windows 下
  可能死锁。一律 `async fn` + `tauri::async_runtime::spawn_blocking`。
- 需要接收外部文件拖放的 WebView 窗口必须以 `visible(true)` 创建；隐藏创建
  再 show() 会导致 WebView2 的 OLE DropTarget 未注册，拖入显示禁止。
- 保持 `dragDropEnabled: true`，用 Tauri 原生拖放事件拿系统路径。
- 置底窗口每次 `show()` 后都要重新 `set_always_on_bottom`，否则会被提升回前台。
- 动态窗口用稳定 label（如 `desktop-card-{id}`），优先复用而非销毁重建；
  谨慎批量创建 WebView（每个窗口都是一份 Chromium 资源）。
- 每个 webview 是独立前端 store，不共享状态；跨窗口数据一致性靠后端广播
  事件 + 各窗口自刷新 + 前端并发合并去重。
- 桌面路径一律走 Known Folder API（含 OneDrive 重定向桌面），不要拼
  `%USERPROFILE%\Desktop`。

## 桌面层输入模型（Nestra 特有，动之前先读）

- 桌面层是 `WS_EX_NOACTIVATE` + `focus:false` 的顶层窗口，锚定到实际承载
  `SHELLDLL_DefView` 的桌面宿主之上（可能是 Progman 或 WorkerW）：
  **点击永远不激活它，键盘输入不会进来**。需要打字的场景（搜索框、便签、
  待办、重命名）必须走 `grant_desktop_input` / `release_desktop_input`
  （AttachThreadInput 挂接到前台线程 + SetFocus 到 wry 的 WebView 子窗口）。
  挂接保持到 release 才断开。前端由 `focusin`/`focusout` 自动触发。
- 输入会话统一由 `desktopInputFocus` 协调：用捕获阶段监听输入框点击（标题输入框
  会 `pointerdown.stop` 防拖动），即使 DOM 焦点未变也能重新取得系统键盘焦点。
  grant/release 串行，release 的 IPC 必须等窗口线程实际归还后再完成；仅最新
  请求能恢复 DOM 焦点，WebView MoveFocus 中途失焦不能撤销尚未完成的申请。
  关闭、禁用或卸载编辑器统一清理会话，组件不要另发未经协调的 release。
- `Win+D` 的“显示桌面”还会抬升 Shell 桌面层，窗口可能仍然 visible、未最小化、
  未 cloak，不能只拦截 `SC_MINIMIZE` 或循环 `ShowWindow`。用独立隐藏底部标记
  与真实桌面宿主的相对 Z 序识别该状态；临时提升仅限桌面前台，切回普通应用、
  暂停或宿主失效时立即降回普通层级。不得把收纳层永久置顶或跨进程 `SetParent`。
  WinEvent 回调只投递消息，标记窗口、hook 和 Z 序操作在收纳层窗口线程管理。
- 前台通知可能早于桌面抬升，连续 `Win+D` 也可能不改变前台窗口：除了前台事件，
  还要监听桌面容器的 `EVENT_OBJECT_REORDER`。重排通知合并并跳过自身进程，
  防止定位形成回调循环；短期补查必须有截止时间，不能被重排事件不断续期。
  撤销临时置顶时直接锚定到普通层级，避免先经过普通应用最前方的中间位置。
- 任务栏及托盘溢出区属于桌面交互；只有当前 Shell 进程拥有且 `GA_ROOT` 类名
  精确匹配的任务栏/托盘窗口才可保留显示桌面提升。不能放行整个 Explorer 进程，
  也不能沿 owner 链扩大范围；普通文件夹窗口仍须让收纳层退回普通层级。
- Windows 11 桌面右键菜单可能把前台切到独立 XAML 宿主，且不设置经典菜单状态。
  菜单例外须同时核对当前 Shell PID、真实桌面宿主的 GUI 线程以及精确菜单类；
  文件夹复用的同名菜单线程不能放行。菜单开始/结束事件触发检查但不续期快速补查。
- 收纳区原生系统菜单由隔离辅助进程承载：仅当前存活 Menu 请求的 PID 和带专用
  属性的菜单宿主可保留桌面交互资格，请求结束/失败/超时必须撤销；Open/Pick/Icon
  辅助进程不得整体放行。窗口未绑定也属于待恢复状态，重建前清理旧点击区域，
  不能在新前端提交区域后再清空；活窗口绑定失败应重试绑定并保留现有 WebView。
- 层只在 `set_hit_rects` 推送的矩形内可点；后端用 `SetWindowRgn` 将窗口裁剪为
  这些矩形的并集，矩形外没有窗口输入目标。禁止随鼠标位置切换 `WS_EX_LAYERED` /
  `WS_EX_TRANSPARENT`（会干扰 WebView2 绘制及系统拖放）。**所有全屏/越界覆盖层（右键菜单、弹窗、确认框）必须加
  `nestra-hit` class**，否则伸出面板的部分点不到、点击穿透到桌面图标。
- 桌面层不能用 `window.confirm`——用 `confirmDialog()`（自定义确认框，
  manager 窗口里自动回退原生 confirm）。
- 覆盖层 z-index 基准：面板/小组件用共享 `nextZ()` 递增计数器（重启后从
  持久化最大值播种）；菜单 9500、重命名 9600、确认框 9700、toast 9000。
- 条目 id = `file:`/`app:shortcut:` 前缀 + 完整路径。**移动/重命名都会改
  id**：`migrateItemId` 负责迁移折叠/排序/快捷启动引用，绕过它改 id 会
  丢用户状态。
- Explorer 重启可能改变桌面宿主；层需要重新查找宿主并锚定。`lib.rs` 的
  `spawn_layer_watchdog` 每 2s 检查桌面层句柄，异常销毁时重建，别删。
- 默认共存模式（`hideNativeIcons` 默认 false）：原生桌面图标保留，收纳区
  浮在壁纸上；开启隐藏 = 全盘接管模式。

## 相关验证

- 改 Rust 后：`cargo check`（src-tauri 下）
- 改前端后：`pnpm build`
- 两者都要过再提交。
