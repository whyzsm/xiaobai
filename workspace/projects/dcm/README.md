# dcm Mounted Project / dcm 挂载项目

## 中文

`dcm` 是一个一仓一背景的独立 T-MAX 项目。公共背景统一使用 `xiaoneng`，业务代码只来自 `dcm`。

运行 `npm run mount:dcm` 创建本机挂载。挂载产物位于被忽略的 `workspace/.local/t-max/dcm/`，不会进入工程仓提交。

## English

`dcm` is a standalone T-MAX project with one repository and one background. Its shared background is `xiaoneng`, and its business code comes only from `dcm`.

Run `npm run mount:dcm` to create local mounts. Generated mounts live under ignored `workspace/.local/t-max/dcm/` and are never committed.
