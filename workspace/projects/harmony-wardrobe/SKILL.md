# Harmony Wardrobe Project Skill / 鸿蒙衣橱柜项目技能

## 中文

## 目标

在当前 loop workspace 中持久化 `harmonyWardrobe` 独立单项目背景，并把它绑定到本地鸿蒙原生代码仓。

## 项目背景

- 项目名称：Harmony Wardrobe / 个人衣橱柜管理 app。
- 技术方向：鸿蒙原生开发。
- 本地挂载仓：`../../.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`。
- 项目背景挂载：`../../.local/harmony-wardrobe/mounts/background/harmonyWardrobe`。
- 远端仓库：`git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git`。
- 本机路径来自 `.loop/local.paths.yaml`，该文件不提交。

## 规则

1. 修改 `harmonyWardrobe` 前，先确认挂载存在；缺失时运行 `npm run mount:harmony-wardrobe`。
2. 业务代码只能落在 `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe` 对应的本地仓库中。
3. 工程仓只记录项目背景、挂载关系、门禁结果、需求引用和交付说明，不保存业务代码。
4. 修改前检查目标仓库当前分支和工作区状态。
5. 不要提交本机 `.loop/local.paths.yaml`、`workspace/.local/` 软链接或外部仓库内容。
6. 涉及数据删除、账号权限、支付、发布配置、证书、签名、依赖升级或构建入口变更时，先停在人工确认。
7. 交付前至少保留一种与改动风险匹配的验证证据，例如类型检查、单元测试、构建、真机/模拟器冒烟或关键流程截图。

## English

## Purpose

Persist the standalone `harmonyWardrobe` project context in this loop workspace and bind it to the local native HarmonyOS code repository.

## Project Context

- Project name: Harmony Wardrobe / personal wardrobe management app.
- Technical direction: native HarmonyOS development.
- Mounted repository: `../../.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`.
- Project context mount: `../../.local/harmony-wardrobe/mounts/background/harmonyWardrobe`.
- Remote repository: `git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git`.
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.

## Rules

1. Before changing `harmonyWardrobe`, confirm the mount exists; refresh it with `npm run mount:harmony-wardrobe` when missing.
2. Business code belongs only in the mounted local repository at `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`.
3. The engineering repository records only project context, mount mapping, gate results, requirement references, and delivery notes. It must not store business code.
4. Check the target repository branch and working tree before editing.
5. Do not commit local `.loop/local.paths.yaml`, `workspace/.local/` symlinks, or external repository contents.
6. Stop for human confirmation before data deletion, account or permission changes, payment changes, release config, certificates, signing, dependency upgrades, or build entry changes.
7. Before delivery, keep at least one verification artifact appropriate to the change risk, such as typecheck, unit tests, build, device or simulator smoke, or screenshots of critical flows.
