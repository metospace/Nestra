# Nestra (Tauri)

A calm, flexible desktop organizer for Windows — rebuilt on **Tauri 2 + Vue 3**,
UI components by [Volt (PrimeVue)](https://volt.primevue.org) with Tailwind CSS v4.

This is the Tauri port of the original WPF app (`E:\技能包\Guidesk.App`).

## What it does

- **桌面接管层**：一个透明、置底的全屏窗口贴着壁纸运行，分区面板浮在壁纸上，
  永远压在其他应用窗口之下（Win32 `HWND_BOTTOM` 子类化强制钉底）。
- **自动分类**：移植自 WPF 版 `ClassificationService` 的全部规则——
  文件按扩展名/关键词进入「进行中 / 参考资料 / 待归档 / 快速访问 / 收件箱」；
  应用快捷方式按词典进入「设计 / 开发 / 沟通 / 办公 / 影音 / 系统 / 上网」等分区。
- **分区面板**：拖动标题栏移动，八向边缘缩放；项目可跨面板拖拽归类；
  把项目拖到标题栏「折叠」上即可收纳，折叠区保留 4 个预览徽标。
- **真实 Shell 图标**：Rust 侧通过 `IShellItemImageFactory` 提取图标缓存为 PNG
  （`%LOCALAPPDATA%\app.nestra.desktop\cache\icons`），前端经 asset 协议加载。
- **便签 / 待办小组件**：托盘菜单或热键创建，内容防抖自动保存。
- **系统托盘**：显示管理器、新建便签/待办、刷新分类、退出。
  左键单击托盘 = 切换管理器。
- **全局热键**：`Ctrl+Alt+G` 显示 / 隐藏管理器。
- **状态持久化**：`%LOCALAPPDATA%\app.nestra.desktop\state.json`（原子写入）。

## Layout of this repo

```
src/            Vue 前端（desktop 层窗口 + manager 管理器共用一套 bundle）
  volt/         volt-vue CLI 生成的 Volt 组件（属于本项目代码，可自由改）
src-tauri/      Rust 后端
  src/scanner.rs    桌面扫描 / .lnk 解析 / 系统入口
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
```

## Notes

- Volt 组件通过 shadcn 风格 CLI 添加：`pnpm dlx volt-vue add <component>`。
- 桌面层不拦截任务栏；其他窗口正常覆盖其上。
- 关闭管理器/桌面层只是隐藏，退出请走托盘菜单。
