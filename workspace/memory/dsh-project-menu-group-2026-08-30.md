# dsh 项目菜单分组 / dsh Project Menu Group

## 结论 / Decision

dsh `0.1.0-rc.6` 的 `@` 候选菜单按 `InputTriggerSource` 分组，source 的 `name` 就是可见分组标题；候选项本身没有分组字段。The dsh `0.1.0-rc.6` `@` candidate menu groups entries by `InputTriggerSource`, and the source `name` is the visible group title; candidates do not carry a group field.

小白项目 source 使用中文分组标题“项目”，并将该 source 名同时用于 dsh codec owner 回查；模型标记仍保持 `<xiaobai-project>`。The Xiaobai project source uses the Chinese group title “项目” as the dsh codec owner key; the model markup remains `<xiaobai-project>`.

## 实现 / Implementation

同步修改 `client/plugin-client.js` 和 `loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`，移除 rc.6 不使用的 `showGroupTitle` 字段，并更新 client contract 测试。The mirrored client bundles were updated together, the unused rc.6 `showGroupTitle` field was removed, and the client contract test was updated.

## 验证 / Verification

插件测试结果为 `86/86 passed`，两份 client bundle 字节一致，`git diff --check` 通过。The plugin suite passed with `86/86`, the two client bundles are byte-identical, and `git diff --check` passed.

当前 3080 dsh 页面没有加载小白插件，因此没有把浏览器页面检查误报为 UI 验证完成。The current dsh page on port 3080 did not load the Xiaobai plugin, so the browser inspection was not reported as a completed UI verification.
