# Nestra — Product Context

> Inferred by `$impeccable` from the incumbent WPF app (`E:\技能包\Guidesk.App`) and the
> migration brief (Tauri 2 + Vue 3 + Volt/PrimeVue). Assumptions are labeled.

## What Nestra is

Nestra（中文名场景下用户直接叫它“桌面整理器”）是一个 Windows 桌面接管工具：
用一个贴着壁纸的常驻层替换原生桌面图标区，把文件、文件夹和快捷方式收进
可拖动、缩放、折叠的**分区面板**，并自动分类。附带便签 / 待办小组件。

- 产品自述（csproj）：*"A calm, flexible desktop organizer for Windows."*
- 全中文 UI 文案；系统入口叫「此电脑」「回收站」。

## Who it serves

中文环境的 Windows 重度桌面用户：桌面常年几十上百个图标，
想要“壁纸 + 少量分区面板”的干净桌面，但不想手动维护分类。
**假设**：单显示器、个人 PC、非企业管理环境。

## Success

- 打开即用：扫描 → 自动分类 → 面板出现在桌面上，零配置可接受。
- 用户 3 秒内能找到并打开任意原桌面项目。
- 面板布局、折叠状态、手动归类跨重启保留。
- 常驻不打扰：托盘常驻、热键 Ctrl+Alt+G 呼出管理器、层永远压在其他窗口之下。

## Surfaces

1. **desktop 层窗口**（主界面）：透明全屏层，浮在壁纸上、压在其他应用下。
   分区面板（图标网格 / 列表）+ 折叠区 + 便签/待办小组件 + 底部状态提示。
   模式：Operate——扫视与命中速度优先，克制表达。
2. **manager 管理器窗口**：普通标题栏窗口。分组管理、自定义分组、
   分类规则开关、外观设置（材质/圆角/边框/透明度）、关于。Volt 组件库。

## Visual truth

- 材质语言：磨砂玻璃感面板（清透/雾面/毛玻璃/亚克力四档），圆角 2–22px 可调，
  低饱和深浅两套底色，强调色克制。
- 图标：真实 Shell 图标（PNG 缓存），退化时用汉字字形徽标（图/码/链/夹…）。
- 字体：系统中文字体栈；数字与拉丁用默认无衬线即可。
- **迁移约束（brief 指定）**：控件一律使用 Volt (PrimeVue) 组件；
  Tailwind v4 负责布局与自定义样式。保持 WPF 版的文案与信息结构，不重写产品语义。
