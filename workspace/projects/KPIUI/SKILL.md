# KPIUI 项目路由说明 / KPIUI Project Routing

## 中文

KPIUI 是独立 Project，不隶属 t-max 项目组。本项目的唯一目标仓是 KPIUI，唯一背景是 xigua。

路由事实：

1. 目标请求进入小白后，KPIUI 命中独立 Project 路由：project=KPIUI，projectKind=Project，executor=xigua。
2. 仓库范围只有 [KPIUI]。dcm 和其他 T-MAX 仓库不在本项目上下文中，任何任务不得读取。
3. xigua 通过 source-backed 能力加载：小白直接读取挂载真源的 `AGENT.md` 作为唯一规范入口，不要求把 xigua 安装到 KPIUI 项目级或系统级技能目录。
4. KPIUI 命中 xigua 后跳过小白原生页面技能，不得回退 frontend-generator。
5. 真源、入口文件或目标仓缺失时失败关闭（fail closed），不得回退到任何原生执行者。
6. 本文件只声明路由与边界，不承载 KPIUI 业务规则；业务实现规范以 xigua `AGENT.md` 为唯一真源。

## UAP 路由事实 / UAP Routing Facts

### 中文

KPIUI 页面在 UAP（统一授权平台）登记时使用以下既定事实，任务内不再向用户询问：

1. UAP 应用中文名：天象（appId `max`）。
2. KPI 一级目录（路由组 `/manage`）对应父菜单：KPI管理（资源 id `187667`）。

### English

KPIUI pages use the following established facts when registering in UAP (unified authorization platform); tasks must not ask the user for them again:

1. UAP application name: 天象 (appId `max`).
2. The KPI first-level directory (route group `/manage`) maps to parent menu: KPI管理 (resource id `187667`).

## English

KPIUI is a standalone Project outside the t-max project group. Its only target repository is KPIUI, and its only background is xigua.

Routing facts:

1. After a request enters Xiaobai, KPIUI matches the standalone Project route: project=KPIUI, projectKind=Project, executor=xigua.
2. The repository scope is exactly [KPIUI]. dcm and all other T-MAX repositories are outside this project's context and must not be read by any task.
3. xigua is loaded as a source-backed capability: Xiaobai reads the mounted canonical `AGENT.md` as the only normative entry; installing xigua into the KPIUI project or a system skill directory is not a prerequisite.
4. Once KPIUI resolves to xigua, native Xiaobai page skills are skipped and frontend-generator must not be used as a fallback.
5. A missing source root, entry file, or target repository fails closed; there is no fallback to any native executor.
6. This file declares routing and boundaries only; it carries no KPIUI business rules. The xigua `AGENT.md` is the single source of truth for implementation.
