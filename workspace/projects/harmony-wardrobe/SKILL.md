# Harmony Wardrobe Project Skill / 鸿蒙衣橱柜项目技能

## 中文

## 目标

在当前 loop workspace 中持久化 `harmonyWardrobe` 独立单项目背景，并把它绑定到本地鸿蒙原生代码仓。

## 项目背景

- 项目名称：Harmony Wardrobe / 个人衣橱柜管理 app。
- 技术方向：鸿蒙原生开发。
- 本地挂载仓：`../../.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`。
- 项目背景挂载：`../../.local/harmony-wardrobe/mounts/background/harmonyWardrobe`。
- 外部参考背景：`external-references.md` 与 `background/harmonyos-samples-repositories.json` 记录 HarmonyOS_Samples 只读示例仓清单。
- 远端仓库：`git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git`。
- 本机路径来自 `.loop/local.paths.yaml`，该文件不提交。

## 项目级 Codex 技能

`harmonyWardrobe` 任务默认叠加以下 Codex 技能。技能包安装在全局 Codex skills 中，小白工程仓只记录项目级触发关系，不复制技能源码。

- `harmony-os-ask`：用于 HarmonyOS、ArkTS、ArkUI、DevEco、hvigor、路由、生命周期、状态管理、构建或调试的问答、解释和诊断。
- `harmony-os-act`：用于在 `harmonyWardrobe` 仓内实现、修复、重构或解释鸿蒙原生代码改动。
- `generate-ui-code`：用于根据需求、截图、草图或设计说明生成或修改 ArkUI 页面、组件、资源和路由。
- `service-widget`：用于创建、修改、解释或调试鸿蒙服务卡片、万能卡片、`form_config.json`、卡片资源和卡片能力。

当任务同时命中多个技能时，先读取本项目 `SKILL.md` 和挂载背景，再按任务意图选择最窄技能组合；例如页面实现优先使用 `generate-ui-code` 并叠加 `harmony-os-act`，概念问答优先使用 `harmony-os-ask`。

## 规则

1. 修改 `harmonyWardrobe` 前，先确认挂载存在；缺失时运行 `npm run mount:harmony-wardrobe`。
2. 业务代码只能落在 `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe` 对应的本地仓库中。
3. 工程仓只记录项目背景、挂载关系、门禁结果、需求引用和交付说明，不保存业务代码。
4. 修改前检查目标仓库当前分支和工作区状态。
5. 不要提交本机 `.loop/local.paths.yaml`、`workspace/.local/` 软链接或外部仓库内容。
6. HarmonyOS_Samples 仓库只能作为只读参考背景；不要把这些仓库加入 `.loop/project.yaml` 的 `repositories`，也不要把克隆内容写入工程仓。
7. 涉及数据删除、账号权限、支付、发布配置、证书、签名、依赖升级或构建入口变更时，先停在人工确认。
8. 交付前至少保留一种与改动风险匹配的验证证据，例如类型检查、单元测试、构建、真机/模拟器冒烟或关键流程截图。

## English

## Purpose

Persist the standalone `harmonyWardrobe` project context in this loop workspace and bind it to the local native HarmonyOS code repository.

## Project Context

- Project name: Harmony Wardrobe / personal wardrobe management app.
- Technical direction: native HarmonyOS development.
- Mounted repository: `../../.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`.
- Project context mount: `../../.local/harmony-wardrobe/mounts/background/harmonyWardrobe`.
- External reference background: `external-references.md` and `background/harmonyos-samples-repositories.json` record the read-only HarmonyOS_Samples repository inventory.
- Remote repository: `git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git`.
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.

## Project-Level Codex Skills

`harmonyWardrobe` tasks should layer in the following Codex skills by default. The skill packages are installed in global Codex skills; this engineering repository records only the project-level trigger relationship and does not copy skill source code.

- `harmony-os-ask`: Use for Q&A, explanation, and diagnosis about HarmonyOS, ArkTS, ArkUI, DevEco, hvigor, routing, lifecycle, state management, builds, or debugging.
- `harmony-os-act`: Use for implementing, fixing, refactoring, or explaining native HarmonyOS code changes in the `harmonyWardrobe` repository.
- `generate-ui-code`: Use for generating or modifying ArkUI pages, components, resources, and routes from requirements, screenshots, sketches, or design specs.
- `service-widget`: Use for creating, modifying, explaining, or debugging HarmonyOS service widgets, meta-service cards, `form_config.json`, card resources, and card abilities.

When a task matches multiple skills, read this project `SKILL.md` and the mounted background first, then choose the narrowest skill combination for the task intent. For example, page implementation should prefer `generate-ui-code` layered with `harmony-os-act`, while conceptual Q&A should prefer `harmony-os-ask`.

## Rules

1. Before changing `harmonyWardrobe`, confirm the mount exists; refresh it with `npm run mount:harmony-wardrobe` when missing.
2. Business code belongs only in the mounted local repository at `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`.
3. The engineering repository records only project context, mount mapping, gate results, requirement references, and delivery notes. It must not store business code.
4. Check the target repository branch and working tree before editing.
5. Do not commit local `.loop/local.paths.yaml`, `workspace/.local/` symlinks, or external repository contents.
6. HarmonyOS_Samples repositories are read-only reference background only; do not add them to `.loop/project.yaml` `repositories`, and do not write cloned contents into the engineering repository.
7. Stop for human confirmation before data deletion, account or permission changes, payment changes, release config, certificates, signing, dependency upgrades, or build entry changes.
8. Before delivery, keep at least one verification artifact appropriate to the change risk, such as typecheck, unit tests, build, device or simulator smoke, or screenshots of critical flows.
