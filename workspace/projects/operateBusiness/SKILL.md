# operateBusiness 项目路由说明 / operateBusiness Project Routing

## 中文

operateBusiness 是独立 Project，不隶属 t-max 项目组。本项目的唯一目标仓是 operateBusiness，唯一背景是 xigua。

路由事实：

1. 目标请求进入小白后，operateBusiness 命中独立 Project 路由：project=operateBusiness，projectKind=Project，executor=xigua。
2. 仓库范围只有 [operateBusiness]。dcm 和其他 T-MAX 仓库不在本项目上下文中，任何任务不得读取。
3. xigua 通过 source-backed 能力加载：小白直接读取挂载真源的 `AGENT.md` 作为唯一规范入口，不要求把 xigua 安装到 operateBusiness 项目级或系统级技能目录。
4. operateBusiness 命中 xigua 后跳过小白原生页面技能，不得回退 frontend-generator。
5. 真源、入口文件或目标仓缺失时失败关闭（fail closed），不得回退到任何原生执行者。
6. 本文件只声明路由与边界，不承载 operateBusiness 业务规则；业务实现规范以 xigua `AGENT.md` 为唯一真源。

## English

operateBusiness is a standalone Project outside the t-max project group. Its only target repository is operateBusiness, and its only background is xigua.

Routing facts:

1. After a request enters Xiaobai, operateBusiness matches the standalone Project route: project=operateBusiness, projectKind=Project, executor=xigua.
2. The repository scope is exactly [operateBusiness]. dcm and all other T-MAX repositories are outside this project's context and must not be read by any task.
3. xigua is loaded as a source-backed capability: Xiaobai reads the mounted canonical `AGENT.md` as the only normative entry; installing xigua into the operateBusiness project or a system skill directory is not a prerequisite.
4. Once operateBusiness resolves to xigua, native Xiaobai page skills are skipped and frontend-generator must not be used as a fallback.
5. A missing source root, entry file, or target repository fails closed; there is no fallback to any native executor.
6. This file declares routing and boundaries only; it carries no operateBusiness business rules. The xigua `AGENT.md` is the single source of truth for implementation.
