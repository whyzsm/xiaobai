# T-MAX Shared Background / T-MAX 公共背景

## 中文

`t-max` 目录现在只保留公共背景兼容入口，不再登记多个业务仓。指定的 8 个 T-MAX 业务仓已经拆成独立项目目录，每个项目只挂一个业务仓，并统一使用 `xiaoneng` 作为背景。

独立项目：

- `dcm`
- `KPIUI`
- `max-console-ui`
- `max-operate-monitor-ui`
- `max-waybill-manage-ui`
- `operateBusiness`
- `operateSupport`
- `scan`

每个项目的标准映射位于 `workspace/projects/<project>/.loop/project.yaml`。本机挂载位于被忽略的 `workspace/.local/t-max/<project>/`，公共背景和业务仓分别位于 `mounts/background/xiaoneng` 与 `mounts/repos/<repository>`。

使用项目对应的命令刷新挂载，例如 `npm run mount:dcm` 或 `npm run mount:operateSupport`。本机绝对路径配置位于各项目的 `.loop/local.paths.yaml`，该文件不提交。

## English

The `t-max` directory now keeps only a compatibility entry for the shared background and no longer registers multiple business repositories. The selected eight T-MAX repositories are split into standalone project directories; each project mounts one repository and uses `xiaoneng` as its shared background.

Standalone projects:

- `dcm`
- `KPIUI`
- `max-console-ui`
- `max-operate-monitor-ui`
- `max-waybill-manage-ui`
- `operateBusiness`
- `operateSupport`
- `scan`

Each project's canonical mapping is in `workspace/projects/<project>/.loop/project.yaml`. Local mounts are generated under ignored `workspace/.local/t-max/<project>/`; the background and business repository are mounted at `mounts/background/xiaoneng` and `mounts/repos/<repository>`.

Run the command for the project you need, such as `npm run mount:dcm` or `npm run mount:operateSupport`. Machine-specific absolute paths are stored in each project's `.loop/local.paths.yaml`, which is never committed.
