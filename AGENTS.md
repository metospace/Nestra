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
- 加载快照时清理幽灵数据：`manualAssignments` / `foldedItems` / `itemOrders`
  中指向已不存在条目的记录要剪掉。

## 行为语义（用户数据安全）

- Nestra 是"UI 归类"模型：任何功能都不得移动/删除用户的真实文件。
- 删除分组 = 移除归类记录，项目回到自动分类；文件永远留在原位。
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

## 相关验证

- 改 Rust 后：`cargo check`（src-tauri 下）
- 改前端后：`pnpm build`
- 两者都要过再提交。
