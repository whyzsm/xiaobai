# Xiaobai Host Entry For T-MAX / T-MAX 的小白宿主入口

## 中文

从任一 T-MAX 已登记业务仓库启动新窗口时，宿主必须先把当前工作目录和原始用户消息交给这个入口。入口会调用小白工程仓的现有注册器和 Xiaoneng 上下文运行时，返回真实的项目组、目标仓库、Manifest、入口 Skill、Owner、Skill 和源码消费证据。

```bash
node workspace/host/t-max-xiaobai-entry.mjs \
  --cwd /absolute/path/to/T-MAX/operateBusiness \
  --message 'operateBusiness 任意用户消息'
```

入口只执行小白工程仓的 TypeScript 编译和 `loop route` 只读路由校验，不启动业务服务、不构建业务仓、不修改业务仓、不提交或推送。路由失败必须停止，不能退回到任何仓库本地辅助入口、旧的 `workspace/projects/<repository>` 残留或全局页面 Skill。

T-MAX 的唯一项目组源是 `workspace/projects/t-max/.loop/project.yaml`。只有其中登记的仓库才会进入共享 `xiaoneng` 背景；其他项目（例如 `harmonyWardrobe`）继续使用自己的项目背景和小白默认编排。

## English

When a new window starts from any registered T-MAX business repository, the host must pass the current working directory and the raw user message to this entry first. The entry calls Xiaobai's existing project registry and Xiaoneng context runtime, then returns evidence for the project group, target repository, Manifest, entry Skill, owner Agent, owner Skills, and consumed source files.

```bash
node workspace/host/t-max-xiaobai-entry.mjs \
  --cwd /absolute/path/to/T-MAX/operateBusiness \
  --message 'operateBusiness any user message'
```

The entry only compiles the Xiaobai engineering repository and runs the read-only `loop route` check. It does not start a business service, build a business repository, modify a business repository, commit, or push. A failed route must stop; it must not fall back to any repository-local auxiliary entry, stale `workspace/projects/<repository>` remnants, or a globally available page Skill.

The only T-MAX project-group source is `workspace/projects/t-max/.loop/project.yaml`. Only repositories registered there enter the shared `xiaoneng` background. Other projects, such as `harmonyWardrobe`, continue to use their own project background and Xiaobai's default orchestration.
