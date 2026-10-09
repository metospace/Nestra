# Nestra Frost 视觉更新

以用户确认的第三版效果图为依据：炭灰背景、磨砂玻璃、悬浮层次、冰白与淡蓝高光。

- `src/product.css` 保留已有空间布局，在 Frost 部分统一主题变量、控件、桌面表面、搜索及覆盖层。管理中心背景由 CSS 渐变与细网格构成，无常驻动画或外部图片请求。
- 控制中心主导航为桌面空间、内容管理、设置；内容管理仍可访问文件与收纳、快捷启动、小组件和搜索。
- 新标志为折叠字母 N：界面组件 `src/components/NestraLogo.vue`；矢量资产位于 `public/assets/nestra-mark.svg` 和 `nestra-icon.svg`；应用图标及托盘默认图标资源已同步至 `src-tauri/icons`。托盘和可执行文件图标在重新构建运行后生效。
- 旧配置第一次升级采用深色、玻璃、圆润、细线、88% 不透明度。外观对象的 `styleVersion: 1` 标记防止后续启动覆盖用户改回的主题或材质。独立表面样式、布局、文件及快捷引用保留。保存仍走原有串行队列与三方合并；远端套用路径不发起回写。
- 桌面窗口保留透明背景与原生命中区域，不增加外部阴影或全屏装饰层。桌面采用内部高光，管理中心采用悬浮阴影。CSS 背景模糊作用于 WebView 内部内容；未新增 Windows 系统级壁纸模糊能力。

验证：`pnpm build`、`cargo check`、100 项 Node 测试通过。浏览器实测控制中心 1020×700、860×560；内容管理导航、设置、浅色切换及桌面面板均正常。浏览器使用已有内存 IPC 验收页，不操作真实文件。构建保留已有包体积/动态导入提示；Rust 保留已有未使用函数提示。

实际代码截图：`docs/design/nestra-frost-implementation.jpg`。

重新生成图标：`pnpm tauri icon public/assets/nestra-icon.svg --output .tmp/frost-icons`，再将根目录图标文件复制到 `src-tauri/icons`，将 `icon.png` 同步到 `app-icon.png`。
