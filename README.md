# Nestra (Tauri)

A calm, flexible desktop organizer for Windows — rebuilt on **Tauri 2 + Vue 3**,
UI components by [Nuxt UI](https://ui.nuxt.com) with Tailwind CSS v4.

This is the Tauri port of the original WPF app (`E:\技能包\Guidesk.App`).

## What it does

- **桌面共存层**：透明桌面窗口锚定在 Explorer 桌面宿主上方，压在普通应用之下；
  仅面板和操作控件所在区域接收点击，其他位置交给系统桌面。
- **真实收纳区**：文件移入 Known Folder 桌面下的 `.nestra/<区名>/`；
  拖出或“放回桌面”移回桌面顶层。删除收纳区前先放回其中所有文件。
- **文件夹映射与标签页**：展示已有文件夹，按类型筛选；多个来源可组合为拥有独立布局的文件组，支持全部来源与局部搜索。
  移除映射仅移除视图，不移动或删除其文件。
- **桌面收纳栏**：拖动标题栏移动，八向边缘缩放；按需展开搜索，更多菜单管理筛选与折叠。
  每个栏可独立设置样式、图标大小、间距和文件名行数；支持多选、框选与批量移动。
- **真实 Shell 图标**：Rust 侧通过 `IShellItemImageFactory` 提取图标缓存为 PNG
  （`%LOCALAPPDATA%\app.nestra.desktop\cache\icons`），前端经 asset 协议加载。
- **便签 / 待办 / 剪贴板 / 时钟**：控制中心统一管理，隐藏与删除独立处理；内容自动保存。
- **快捷启动与搜索**：快捷启动只保存引用；打开原始快捷方式保留启动参数。
  搜索热键 `Ctrl+Alt+F`；使用独立搜索窗口，可搜索开始菜单和已安装应用目录。
  “全部”和“Everything”通过本机 Everything IPC 查询已索引的磁盘文件；
  未连接时明确显示局部范围，桌面、收纳区和映射目录搜索仍可使用。
- **系统托盘**：显示管理器、新建便签/待办、刷新分类、退出。
  左键单击托盘 = 切换管理器。
- **全局热键**：`Ctrl+Alt+G` 显示 / 隐藏管理器。
- **状态持久化**：`%LOCALAPPDATA%\app.nestra.desktop\state.json`（原子写入）。
  跨窗口通过三方合并和条件写入保留并发修改。

## 重设计版本（2026-10-02）

运行 `releases/redesign-20261002/Nestra.exe`。控制中心包含概览、文件与收纳、快捷启动、搜索、小组件、布局、外观、数据与恢复、系统九个模块。

新建映射默认只浏览；整理规则需先预览，再手动执行本次移动。失联快捷入口保留并支持重绑，启动集合可编辑成员。配置备份仅包含设置与小组件内容，不包括原文件或剪贴板历史。恢复前会检查版本、展示目录与对象影响，并备份当前配置；磁盘上未关联的收纳目录可以重新关联。

第一阶段实现记录与验证边界见 [重设计实施记录](docs/REDESIGN_IMPLEMENTATION_20261002.md)。完整 Dock 与插件扩展属于后续阶段。

## 桌面体验更新（2026-10-03）

最新程序：`releases/desktop-polish-20261002/Nestra.exe`。新增独立收纳栏设置、简化桌面工具、多选与框选、成功移动记录及保护性撤销；快捷启动集合可从桌面直接打开，概览展示真实面板预览。搜索支持名称匹配排序、会话内最近打开排序和分批显示。

操作与验证边界见 [桌面体验更新记录](docs/DESKTOP_POLISH_20261003.md)。移动和启动历史均只保留本次运行，不包含在配置备份中。

## 使用

手动运行会打开管理器。新建收纳区后，隐藏管理器，在桌面把文件拖到收纳区内。
区内文件双击打开；快捷启动中的引用单击打开。
桌面顶部也提供新建、搜索、管理入口。隐藏面板后可在管理器重新启用。
重复运行程序会打开已有管理器；开机启动使用 `--background` 留在托盘。

索引搜索需要安装并运行 [Everything](https://www.voidtools.com/downloads/)
（1.4.1 及以上，默认实例；也识别旧 1.5a 默认实例）。仅启动 Everything Service
不等于运行搜索程序，需保留 Everything 主程序在后台，并启用 IPC。
无需 `es.exe`、SDK DLL 或 HTTP 服务。支持 Everything 查询语法，如 `ext:pdf 报告`；
搜索的是索引覆盖的文件名/路径，不代表全文检索或尚未索引的所有磁盘。
每次最多加载 200 条索引结果，分批显示；显示完整路径以区分同名文件。

早期可用性修复见 [2026-10-02 可用性修复记录](docs/USABILITY_REPAIR_20261002.md)。

## Layout of this repo

```
src/            Vue 前端（desktop 层窗口 + manager 管理器共用一套 bundle）
  ui/           Nuxt UI 兼容包装与桌面弹出层
  domain/       来源、配置与独立面板呈现规则
src-tauri/      Rust 后端
  src/scanner.rs    桌面扫描 / .lnk 解析 / 系统入口
  src/everything.rs Everything 索引查询 / IPC 超时与结果解析
  src/icons.rs      Shell 图标提取 → PNG 缓存
  src/win32.rs      置底钉扎（WM_WINDOWPOSCHANGING 子类化）
  src/lib.rs        托盘 / 热键 / 窗口生命周期
```

## Development

```powershell
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式（Vite HMR + Rust 增量编译）
pnpm tauri build      # 发布构建（NSIS 安装包）
pnpm build            # 仅前端类型检查 + 打包
cargo check           # 仅检查 Rust（在 src-tauri/ 下）
node --test tests/*.test.mjs # 前端行为回归（项目根目录）
cargo test --lib       # Rust 文件操作及原生命中区域测试（src-tauri/ 下）
```

## Notes

- 界面使用 Nuxt UI，桌面弹出层必须参与原生命中区域。
- 桌面层不拦截任务栏；其他窗口正常覆盖其上。
- 关闭管理器/桌面层只是隐藏，退出请走托盘菜单。
