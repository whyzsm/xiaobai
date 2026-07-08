# HarmonyOS Samples Background / HarmonyOS 示例背景

## 中文

`HarmonyOS_Samples` 组织下的公开示例仓库作为 `harmonyWardrobe` 的只读项目背景，用于检索 HarmonyOS、ArkTS、ArkUI、媒体、服务卡片、跨端适配和系统能力接入的实现范式。

## English

Public repositories under the `HarmonyOS_Samples` organization are read-only project background for `harmonyWardrobe`. They are used to look up implementation patterns for HarmonyOS, ArkTS, ArkUI, media, service widgets, cross-device adaptation, and system capability integration.

## 中文

机器可读清单位于 `background/harmonyos-samples-repositories.json`。该清单来自 [Gitee HarmonyOS_Samples 仓库页](https://gitee.com/organizations/harmonyos_samples/projects)，当前记录 425 个唯一仓库。

## English

The machine-readable inventory lives at `background/harmonyos-samples-repositories.json`. It is generated from the [Gitee HarmonyOS_Samples project page](https://gitee.com/organizations/harmonyos_samples/projects) and currently records 425 unique repositories.

## 中文

刷新清单时，在工程仓根目录运行：

```bash
node workspace/projects/harmony-wardrobe/scripts/fetch-harmonyos-samples.mjs
```

## English

To refresh the inventory, run this command from the engineering repository root:

```bash
node workspace/projects/harmony-wardrobe/scripts/fetch-harmonyos-samples.mjs
```

## 中文

这些仓库只作为参考资料，不是 `harmonyWardrobe` 的本机可写挂载仓。不要把它们加入 `.loop/project.yaml` 的 `repositories`，也不要把克隆后的外部仓库内容提交到本工程仓。

## English

These repositories are reference material only, not local writable mounts for `harmonyWardrobe`. Do not add them to `.loop/project.yaml` `repositories`, and do not commit cloned external repository contents into this engineering repository.

## 中文

如果需要引用某个示例仓，请优先记录仓库 URL、相关 API/能力点、适用页面或模块，以及是否已通过独立 evaluator 检查；不要把示例代码直接复制为完成证据。

## English

When referencing a sample repository, prefer recording the repository URL, relevant API or capability area, applicable page or module, and whether an independent evaluator has checked it. Do not treat copied sample code as completion evidence.
