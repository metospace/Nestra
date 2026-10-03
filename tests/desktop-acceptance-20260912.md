# Windows 桌面实机验收（2026-09-12）

通过 Computer Use 操作实际 Windows 桌面层，不以命令直接移动文件来代替拖拽。

## 已实际验证

- 创建临时收纳区 `Nestra 验收`。
- 修复前：从收纳区 2 拖动测试文件到验收区，鼠标操作完成，但界面和文件位置都没有变化，复现内部 HTML 拖拽失效。
- 修复后：同样的操作使收纳区 2 数量变为 0，验收区数量变为 1。文件真实移动到 `Desktop/.nestra/Nestra 验收/`。
- 再次拖回收纳区 2 成功；磁盘最终只有一份测试文件，内容与原始 56 字节测试内容一致。
- 拖动收纳区 2 标题栏后，位置从 `(368,18)` 变成约 `(418,63.33)`；等待和重启后保持新位置。
- 管理器隐藏、系统执行“显示桌面”后，桌面层重新显示。显示桌面瞬间存在短暂隐藏，本次未量化恢复延迟。
- 管理器可见开关的实际显示与当前分区状态一致。

## 验证范围与限制

- 为让 Computer Use 选择桌面层，验收构建开启 `ui-test`，仅改变工具窗口/任务栏可发现性；原生命中区域、NOACTIVATE 和桌面层级逻辑保持相同。
- 正式构建不包含 `ui-test`。
- 从原生桌面拖入的本次文件由用户先前操作完成；本轮亲自完成的是收纳区之间的往返拖动。
- 右键“放回桌面”及修复后的直接拖出桌面尚未完成实机验收。电脑控制接口多次返回 `failed to activate captured window` / `GetCursorPos failed: 拒绝访问。 (0x80070005)`，恢复连接后仍有失败。
- 正式版启动也被同一接口错误阻断；未声称已经运行正式版。原启动路径 `releases/desktop-region-rewrite/Nestra.exe` 和 `releases/desktop-acceptance/Nestra.exe` 均已更新，旧版保存在 `Nestra.before-pointer-fix.exe`。
- 临时验收区和测试文件保留用于复核，未改动用户文件。

## 自动验证

- `pnpm build`：通过。
- `cargo check`：通过。
- `node --test tests/item-drag.test.mjs tests/drop-paths.test.mjs tests/persistence.test.mjs`：15 项通过。
- `cargo build --release --features tauri/custom-protocol`：通过。
- 正式版 SHA256：`59315D6F1BD0390B22256520A48C929C9865DFC547DF220935614CD0D55EC045`。
