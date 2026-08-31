# dsh 会话项目上下文恢复与切换 / dsh Session Project Context Recovery And Switching

## 中文

当 dsh 历史会话只有标题中的 `@项目`，但会话快照没有结构化 `<xiaobai-project>` occurrence 时，插件不能把项目上下文渲染为空。客户端应先从当前 Host Workspace 的项目列表和项目候选服务解析唯一的项目引用，并在会话级缓存中保存解析结果。

项目上下文的唯一可见入口位于“创造模式”右侧，显示“当前项目：项目名”。入口必须同时支持“更换项目”和“清除项目”：更换时清理旧 occurrence 并把草稿置为单个 `@`，清除时删除 occurrence 的完整长度并设置会话级空 override，避免旧标题在后续渲染中再次恢复。

`ReferenceInsert.label` 只保存不带 `@` 的项目名称；`clipboardText` 才保存 `@项目名`。项目引用使用 `source: "项目"` 和 `appearance: "session"`，以便保留结构化序列化能力，同时由插件隐藏原生输入镜像中的重复项目 chip。普通文件引用例如 `@t-max/config` 必须继续由 dsh 原生文件引用显示，不能被项目匹配规则误判。

项目候选恢复必须按 Workspace 和 Project 的 opaque ID 校验，禁止根据本机绝对路径或显示标题直接构造项目身份。项目候选服务返回多个同名项目时不得自动选择，历史标题恢复失败时应保持无项目状态并允许用户重新选择。

验证证据：`client/plugin-client.js` 与 `loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js` 内容一致；两个客户端文件通过 `node --check`；`git diff --check` 通过；客户端合同测试 10/10 通过；真实 dsh 页面验证了历史 `@t-max` 会话恢复、切换到 `@harmony-wardrobe`、单 `@` 输入和清除项目后的空状态。

## English

When a historical dsh session has only `@project` in its title but no structured `<xiaobai-project>` occurrence in the session snapshot, the plugin must not render an empty project context. The client first resolves a unique project reference from the current Host Workspace project list and project-candidate service, then keeps the resolved reference in a session-level cache.

The only visible project entry is placed to the right of “创造模式” and displays “当前项目：项目名”. The entry must support both “更换项目” and “清除项目”: replacement removes the old occurrence and changes the draft to one `@`; clearing removes the full occurrence length and sets a session-level empty override so the old title cannot restore the project during later renders.

`ReferenceInsert.label` stores only the project name without `@`; `clipboardText` stores `@project-name`. Project references use `source: "项目"` and `appearance: "session"` so structured serialization is preserved while the plugin hides the duplicated project chip in the native input mirror. Ordinary file references such as `@t-max/config` must remain visible through the native dsh file-reference renderer and must not be misclassified as projects.

Project recovery must validate Workspace and Project opaque IDs and must never construct project identity from local absolute paths or display titles. If the candidate service returns multiple projects with the same label, the client must not select one automatically; when legacy title recovery fails, the UI remains projectless and lets the user choose again.

Evidence: `client/plugin-client.js` and `loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js` are identical; both client files pass `node --check`; `git diff --check` passes; the client contract suite passes 10/10; the real dsh page verifies legacy `@t-max` recovery, switching to `@harmony-wardrobe`, single-`@` replacement input, and the empty state after clearing the project.
