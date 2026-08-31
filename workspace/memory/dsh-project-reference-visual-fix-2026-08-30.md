# dsh 项目引用视觉投影修复 / dsh Project Reference Visual Projection Fix

## 中文

dsh `0.1.1-rc.2` 的项目引用必须分成三层处理：草稿中的 `@项目` 仅作为结构化 occurrence 的内部显示文本；项目名称的唯一可见入口位于“创造模式”右侧的蓝色 Hero 区域；原生 `dsh-at-file` 只能显示真正的文件引用。

项目候选的 `ReferenceInsert.label` 不得包含 `@`，`clipboardText` 才使用 `@项目`。dsh 输入机由 `label` 生成草稿显示文本，因此把 `@` 放进 label 会产生双 `@@`。

当 dsh 原生输入镜像渲染项目 occurrence 时，插件使用 occurrence ID 标记项目 chip，并用透明度隐藏镜像内容但保留占位宽度。项目仍保留在输入状态中，以便提交时序列化为 `<xiaobai-project>`，而用户只在 Hero 区域看到项目。

`dsh-at-file` 根据原始草稿扫描所有 `@token`，不知道项目 occurrence。插件复现其唯一 mention 顺序，并只按 occurrence offset 与 label 匹配对应的项目行；项目行使用插件属性隐藏，普通文件行继续显示。清除项目必须按 occurrence 的完整 `length` 删除，不能只删除首字符 `@`。

验证证据：客户端合同测试 8/8 通过；两个客户端文件 `node --check` 通过；源码与发布镜像一致；`git diff --check` 通过；浏览器验证覆盖项目选择、项目与文件引用共存、项目完整清除和蓝色 Hero 位置。

## English

Project references in dsh `0.1.1-rc.2` must be handled in three layers: `@project` in the draft is only the internal display text of a structured occurrence; the only visible project entry is the blue Hero area to the right of “创造模式”; native `dsh-at-file` must display real file references only.

`ReferenceInsert.label` must not contain `@`; only `clipboardText` uses `@project`. The dsh input machine derives draft display text from `label`, so putting `@` in the label creates the duplicated `@@`.

When the native dsh input mirror renders a project occurrence, the plugin marks the project chip by occurrence ID and hides its mirror content with transparency while preserving its layout width. The project remains in input state for `<xiaobai-project>` submission serialization, while the user sees it only in the Hero area.

`dsh-at-file` scans raw draft `@token` text and does not know structured project occurrences. The plugin reproduces its unique mention order and matches only the row whose mention offset and label correspond to a project occurrence; only those rows receive plugin-owned hiding attributes, while ordinary file rows remain visible. Clearing a project must remove the occurrence's full `length`, not only the leading `@`.

Evidence: the focused client contract suite passed 8/8; both client files passed `node --check`; the source and published mirror are identical; `git diff --check` passed; browser verification covered project selection, project/file coexistence, complete project clearing, and blue Hero placement.
