# SnowDesktop 功能参考与验收顺序

用户于 2026-09-12 指定 [SnowDesktop](https://github.com/FreeFallingSnow/SnowDesktop)
作为功能参考。已查看 README 与相关源文件，源码对照固定在提交
`c626b8c77130e5cfd2a0726244f98be8fe0851af`；未安装运行 SnowDesktop，以下不是其实际体验评测。

## 功能取舍

| 参考功能 | Nestra 的采用方式 | 优先级 |
| --- | --- | --- |
| 集合、文件夹映射、桌面文件分类分别建模 | 收纳区表示真实目录；快捷启动表示引用；将来的分类视图只筛选展示，自动移动需有明确规则 | 先明确现有行为 |
| 拖放区分移动、复制、链接 | 当前拖入收纳区默认移动，拖入快捷启动只添加引用；悬停反馈应明确说明动作与目标，失败不能显示成功 | P0 |
| 文件夹内容直接展示 | 后续支持选择已有文件夹作为映射，展示真实路径；移除映射只移除视图，不能套用“解散收纳区”的移动逻辑 | P1 |
| 集合组标签页 | 同一面板切换工作、学习等分组，减少多个面板相互遮挡 | P1 |
| 文件分类与跨来源搜索 | 先补分类筛选与现有搜索；Everything 属于后续可选集成 | P1 |
| 多显示器独立布局与分页 | 为显示器保存独立布局，并处理 DPI、拔屏、恢复；当前单个 desktop 层不是完整多屏实现 | P1 |
| 布局及设置备份恢复 | 明确配置备份与用户文件备份的区别；导入必须保留路径映射，预览影响 | P1 |
| Dock、窗口预览、小组件扩展 | 在基本收纳流程验收后再扩展；当前快捷启动面板不等同于完整 Dock | P2 |

以上功能来源：[项目 README](https://github.com/FreeFallingSnow/SnowDesktop/blob/main/README.md)。
这是后续优先级，不是全功能移植完成声明。

## 源码中值得采用的规则

1. **拖拽是一段完整会话。** 来源、目标、动作与最终结果分开记录；预览不等于执行成功。
   参考 [drop_model.h](https://github.com/FreeFallingSnow/SnowDesktop/blob/c626b8c77130e5cfd2a0726244f98be8fe0851af/src/core/drop_model.h)。
   Nestra 可把内部 pointer 拖动和外部 Tauri 文件拖放归到相同的动作判定与结果反馈规则。
2. **拖动期间保留数据上下文。** 参考项目在拖拽上下文或 OLE 传输仍存活时推迟模型重载。
   参考 [drag_input_rules.h](https://github.com/FreeFallingSnow/SnowDesktop/blob/c626b8c77130e5cfd2a0726244f98be8fe0851af/src/drag_input_rules.h)。
   已调整：`rescan` 使用串行刷新队列，扫描前和提交前均检查内部/外部拖拽；手势结束后才替换条目并清理引用。连续通知触发重扫，过期结果不提交。新增测试覆盖扫描期间开始拖动、重复通知与失败后重试；实机验证仍待完成。
3. **成功后提交显示结果。** 参考实现以文件操作完成回调决定引用清理与 Shell 刷新。
   参考 [app_drop_execution.cpp](https://github.com/FreeFallingSnow/SnowDesktop/blob/c626b8c77130e5cfd2a0726244f98be8fe0851af/src/app/app_drop_execution.cpp)。
   当前 `moveItem` 已在移动成功后迁移 ID、扫描与提示；批量部分失败、操作进行中的反馈仍应重点验证。
4. **拒绝把目录放入自身。** 参考 [folder_self_drop_rules.h](https://github.com/FreeFallingSnow/SnowDesktop/blob/c626b8c77130e5cfd2a0726244f98be8fe0851af/src/folder_self_drop_rules.h)。
   Nestra 已保护包含存放区的目录；未来任意文件夹映射需扩大保护范围，并检查重解析路径。
5. **桌面宿主要确认来自 Explorer。** 参考 [desktop_window_discovery_rules.h](https://github.com/FreeFallingSnow/SnowDesktop/blob/c626b8c77130e5cfd2a0726244f98be8fe0851af/src/desktop_window_discovery_rules.h)。
   当前桌面发现按窗口类和 `SHELLDLL_DefView` 查找，可以进一步验证候选窗口所属 Shell 进程。

这些是按源码得出的设计对照，不代表它的 C++/DirectComposition 实现可直接用于 Tauri/WebView2。

## P0 实机验收门槛

- 新建空收纳区后，原生桌面图标仍可点击。
- 从原生桌面拖入测试文件：只出现一份目标文件，桌面原路径不存在，图标刷新。
- 区内单击选择、双击打开、跨区拖动；拖动取消不移动文件。
- 直接拖出和“放回桌面”分别实测，确认返回文件内容完整。
- 拖动/缩放时触发文件监控和远端状态更新，不回弹、不丢失捕获。
- 点击原生桌面、隐藏管理器、显示桌面后收纳区可用；记录瞬间隐藏与恢复延迟。
- 重启恢复位置、成员、排序；删除收纳区先返回全部文件。
- 同名、被占用、权限不足和部分失败时，反馈与磁盘结果一致。

既有实机结果见 [2026-09-12 验收记录](../tests/desktop-acceptance-20260912.md)。
尚未通过的项目继续保留为未完成，构建或单元测试不能代替这些交互验收。
