# ANE Standard Page / ANE 标准页面

## 中文

本技能用于 T-MAX 挂载前端仓中的 ANE 标准页面新增、菜单路由调整和标准导入能力接入。小白负责任务、Loop、阶段 Owner、门禁、运行产物和最终完成判断；小能只提供规则、契约、模板、参考页面和纯校验能力。

This skill is for ANE standard-page additions, menu and route changes, and standard import behavior in mounted T-MAX frontend repositories. Xiaobai owns the task, Loop, stage owners, gates, runtime artifacts, and completion decision; Xiaoneng provides rules, contracts, templates, reference pages, and pure validators only.

## 路由边界 / Routing Boundary

普通 `StandardPage` 工作优先进入 `ane-standard-page`。跨仓复杂交付、重大视觉重构、外部 API 契约变化和明确要求完整设计评审的任务才进入 `frontend-delivery`。单文件删除、替换或既有路径明确的小改仍走 micro patch。

Ordinary `StandardPage` work enters `ane-standard-page` first. Cross-repository complex delivery, major visual redesign, external API contract changes, and explicit full design-review requests use `frontend-delivery`. A single-file deletion, replacement, or clearly bounded existing-path change remains a micro patch.

## 必须先有的证据 / Required Evidence Before Coding

编码前必须存在并锁定：`background-context.json`、`evidence-selection.json`、`page-contract.json`、`import-rule.json`、目标仓事实和需求来源。编码与验收必须复用同一 `contextDigest` 与 `contractDigest`。

Before coding, the run must contain and lock `background-context.json`, `evidence-selection.json`, `page-contract.json`, `import-rule.json`, repository facts, and the requirement source. Coding and evaluation must reuse the same `contextDigest` and `contractDigest`.

## CPYYZ-7057 约束 / CPYYZ-7057 Constraints

两个页面必须声明为 `StandardPage`，契约覆盖菜单、路由、字段、API 和导入。导入规则必须引用小能的 `tmax-standard-import`，并记录规则版本、来源 commit、来源 digest、模板引用和适用页面类型。

Both pages must be declared as `StandardPage`, with the contract covering menus, routes, fields, APIs, and import behavior. The import rule must reference Xiaoneng `tmax-standard-import` and record its version, source commit, source digest, template reference, and applicable page type.

任何 `mock/User/auth.json`、本地 mock 数据或写死的上传结果都属于阻断错误。小能目录只能作为开发证据来源，不能成为业务页面生产运行时依赖。

Any `mock/User/auth.json`, local mock data, or hardcoded upload result is a blocking error. The Xiaoneng checkout may provide development evidence, but it must not become a production runtime dependency of the business page.

## 输出 / Outputs

标准页 Loop 必须输出契约路径、证据选择、上下文与契约 digest、Generator 消费证据、导入校验、页面结构校验、独立评估和每个阶段的真实时间证据。没有真实时间事件时必须标记 `unmeasured`，不能估算。

The standard-page Loop must output the contract path, evidence selection, context and contract digests, generator-consumption evidence, import verification, page-structure verification, independent evaluation, and real timing evidence for every stage. Missing timing events must be marked `unmeasured`; they must not be estimated.
