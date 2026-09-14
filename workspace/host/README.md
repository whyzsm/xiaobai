# Xiaobai Host Entry For T-MAX / T-MAX 的小白宿主入口

## 中文

只有在 Xiaobai 工程仓（`xbaiProjectCode`）的对话上下文中，宿主才可以把目标 T-MAX 仓库和原始用户消息交给这个入口。`--host-cwd` 是当前对话宿主目录，`--cwd` 是本次要处理的目标业务仓；两者不能混用。入口会调用小白工程仓的现有注册器和路由 CLI，返回真实的独立项目、目标仓库、背景执行者、入口文件与源码消费证据。

```bash
node workspace/host/t-max-xiaobai-entry.mjs \
  --host-cwd /absolute/path/to/xbaiProjectCode \
  --cwd /absolute/path/to/T-MAX/operateBusiness \
  --message 'operateBusiness 任意用户消息'
```

入口只接受 Xiaobai 工程上下文中的调用，先校验 `--host-cwd` 的真实路径，再按需执行小白工程仓的 TypeScript 编译（仅当 `loop-engineering/cli`、`loop-engineering/packages` 或 `tsconfig.json` 比编译产物新时才重建），然后运行 `loop route` 只读路由校验。不启动业务服务、不构建业务仓、不修改业务仓、不提交或推送。直接在 Xiaobai 工程仓之外的任何项目或代码仓中调用时，都没有 Xiaobai 宿主上下文，不会建立 Xiaobai bridge；该场景由对应宿主自身的安装与项目声明决定。路由失败必须停止，不能退回到任何仓库本地辅助入口、旧的 `workspace/projects/<repository>` 残留或全局页面 Skill。

每个 T-MAX 仓库现在都是独立 Project（`workspace/projects/<repoId>/.loop/project.yaml`，executor=xigua），目标仓命中自己的独立项目路由与 xigua 背景；`workspace/projects/t-max` 项目组不登记任何仓库、不声明任何背景（旧 xiaoneng 路由已随 Batch E 下线），仅承载共享挂载脚本与 loop 基础设施。其他项目（例如 `harmonyWardrobe`）继续使用自己的项目背景和小白默认编排。

## English

Only a conversation hosted inside the Xiaobai engineering repository (`xbaiProjectCode`) may pass a T-MAX target repository and the raw user message to this entry. `--host-cwd` identifies the current conversation host and `--cwd` identifies the business repository being handled; they must not be conflated. The entry calls Xiaobai's existing project registry and route CLI, then returns evidence for the standalone project, target repository, background executor, entry file, and consumed source files.

```bash
node workspace/host/t-max-xiaobai-entry.mjs \
  --host-cwd /absolute/path/to/xbaiProjectCode \
  --cwd /absolute/path/to/T-MAX/operateBusiness \
  --message 'operateBusiness any user message'
```

The entry accepts calls only from a Xiaobai engineering context. It first verifies the real path of `--host-cwd`, then rebuilds the Xiaobai engineering repository only when `loop-engineering/cli`, `loop-engineering/packages`, or `tsconfig.json` is newer than the compiled CLI, and runs the read-only `loop route` check. It does not start a business service, build a business repository, modify a business repository, commit, or push. A direct call from any project or repository outside Xiaobai has no Xiaobai host context and does not create a Xiaobai bridge; that host's own globally or project-installed setup determines routing. A failed route must stop; it must not fall back to any repository-local auxiliary entry, stale `workspace/projects/<repository>` remnants, or a globally available page Skill.

Every T-MAX repository now runs as its own standalone Project (executor=xigua); the `t-max` group registers no repository and declares no background after Batch E. Other projects, such as `harmonyWardrobe`, continue to use their own project background and Xiaobai's default orchestration.

## Codex Xiaobai-Project Pre-Dispatch / Codex Xiaobai 工程上下文前置路由

中文：

要让 Xiaobai 工程仓中的 Codex 对话进入独立 xigua 路由，可在 Codex 用户级 hook 中注册 `UserPromptSubmit`。Codex 会把当前 turn 的 `cwd` 和原始 `prompt` 通过标准 JSON stdin 传给 hook；hook 首先检查真实 `cwd` 是否位于安装它的 Xiaobai 工程根目录，并排除 `workspace/.local` 及其软链接目标。缺少当前 prompt 时直接以退出码 `2` 阻断本轮，绝不从历史 transcript、其他 session 或业务仓推断请求。通过宿主边界后，hook 只读取已经构建的 `loop route` CLI：CLI 缺失或源码比产物新时同样阻断并提示先运行安装脚本，不在用户提交热路径中自动编译。只有返回 executor=xigua 且存在完整 handoff 时，才以 `hookSpecificOutput.additionalContext` 向当前对话注入 `[XIGUA PRE-DISPATCH LOCK]` 路由锁（旧 `[XIAONENG PRE-DISPATCH LOCK]` 随 Batch E 下线）。位于 Xiaobai 工程仓之外的任何项目或代码仓的对话都会静默跳过，不会被 Xiaobai bridge 劫持。

本机注册文件是 `~/.codex/hooks.json`，它属于 Codex 用户级配置，不属于任何业务仓，也不会在仓库中生成隐藏配置。注册内容如下，路径按实际 Xiaobai 工程位置调整：

同一台机器只保留一个小白 xigua `UserPromptSubmit` 注册点；不要再把同一个脚本重复登记到项目级 `.codex/hooks.json`，否则同一条消息会重复执行路由并增加延迟。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "XIAOBAI_PROJECT_ROOT=\"/absolute/path/to/xbaiProjectCode\" /absolute/path/to/node /absolute/path/to/xbaiProjectCode/workspace/host/xigua-codex-prompt-hook.mjs",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

新对话中，hook 输出的 `additionalContext` 含 `[XIGUA PRE-DISPATCH LOCK]` 后，当前 Agent 必须以 `xigua-frontend-agent` 作为顶层角色，使用输出的 xigua 源码根目录和绝对 `AGENT.md` 入口路径继续；缺证据就停止，不能先读用户级安装 Skill、全局页面 Skill 或直接分析业务页面。对 `harmonyWardrobe` 等独立项目，route 返回 Xiaobai 默认执行者时不注入 T-MAX 锁。

这个 hook 能覆盖支持 Codex `UserPromptSubmit` 的 Codex 对话；它不能凭仓库代码强制接管不支持该 hook 的其他 AI 工具。其他工具必须把同一个 `xigua-codex-prompt-hook.mjs` 接到自己的“用户消息提交前”插件或 wrapper 上，才能获得相同的首跳保证。

English:

To let Codex conversations hosted inside the Xiaobai engineering repository enter the standalone Xigua routes, register a `UserPromptSubmit` hook at the Codex user level. Codex passes the current turn's `cwd` and raw `prompt` to the hook through the standard JSON stdin payload. The hook checks that the real `cwd` is inside the Xiaobai project root that installed it, excluding `workspace/.local` and symlink targets. If the current prompt is missing, it exits with code `2` and blocks the turn; it never infers a request from an old transcript, another session, or a business repository. After the host boundary passes, the hook reads only an already-built `loop route` CLI: a missing or stale CLI blocks the turn with setup instructions, and the user-prompt hot path never compiles the repository. It injects a `[XIGUA PRE-DISPATCH LOCK]` routing lock through `hookSpecificOutput.additionalContext` only when the result is executor=xigua with a complete handoff (the legacy Xiaoneng lock was retired with Batch E). Conversations opened in any project or repository outside Xiaobai are silently skipped and are not taken over by the Xiaobai bridge.

The local registration file is `~/.codex/hooks.json`. It is Codex user configuration, not business-repository content, and it does not create hidden configuration inside a repository. The registration is shown above; adjust the Xiaobai project path for the machine.

Keep exactly one Xiaobai Xigua `UserPromptSubmit` registration on a machine; do not register the same script again in a project-local `.codex/hooks.json`, or one message will execute the route twice and incur extra latency.

In a new conversation, after `[XIGUA PRE-DISPATCH LOCK]` is injected through `additionalContext`, the current Agent must use `xigua-frontend-agent` as the top-level role and continue from the emitted xigua source root and the absolute `AGENT.md` entry path. Missing evidence must stop the turn; the Agent must not read user-level installed Skill sources, global page Skills, or analyze business pages first. For independent projects such as `harmonyWardrobe`, a Xiaobai route produces no T-MAX lock.

This hook covers Codex conversations that support `UserPromptSubmit`; repository files alone cannot force an unrelated AI tool that has no such hook. Other tools must attach the same `xigua-codex-prompt-hook.mjs` to their own pre-user-message plugin or wrapper to obtain the same first-hop guarantee.

## 给其他伙伴初始化 / Onboarding For Other Contributors

中文：

小白仓库不携带任何个人绝对路径，也不提交用户级 Codex 配置。伙伴 clone 小白、准备好本机的 T-MAX 与 xigua 源码仓后，在小白仓根目录执行：

```bash
npm install
cp workspace/projects/t-max/.loop/local.paths.yaml.example workspace/projects/t-max/.loop/local.paths.yaml
# Edit local.paths.yaml; standalone T-MAX projects keep their own per-repo example files.
npm run mount:tmax
npm run setup:codex
```

初始化脚本会先构建小白路由 CLI，再根据当前 clone 的真实路径幂等更新该伙伴自己的 `CODEX_HOME/hooks.json`，保留其他既有 hook，只替换小白自己的同名 hook。它不会创建业务仓库内的隐藏配置，不会安装任何外部 Skill，不会复制 xigua 源码，也不会修改任何业务仓库。执行后完全退出并重启 Codex Desktop，再新建对话即可生效。

The setup command first builds Xiaobai's routing CLI, then uses the current clone's real path to idempotently update that contributor's own `CODEX_HOME/hooks.json`. It preserves unrelated hooks and replaces only Xiaobai's hook. It does not create hidden configuration in a business repository, install an external Skill, copy Xigua source, or modify any business repository. Fully quit and restart Codex Desktop, then create a new conversation.

如果伙伴通过 `CODEX_HOME` 使用了非默认 Codex 配置目录，脚本会自动写入该目录；如果小白仓库被移动，重新执行一次 `npm run setup:codex` 即可更新路径。路由仍只读取当前小白仓的 `project.yaml` 与挂载的 xigua 真源，不依赖提交者机器的目录结构。`npm run mount:tmax` 是每台机器必须完成的一次本地挂载准备；它只生成被 Git 忽略的 `.local` 软链接。

English:

The Xiaobai repository carries no personal absolute paths and does not commit user-level Codex configuration. After cloning Xiaobai and preparing the local T-MAX repositories and Xigua source checkout, each contributor runs the following from the Xiaobai repository root:

```bash
npm install
cp workspace/projects/t-max/.loop/local.paths.yaml.example workspace/projects/t-max/.loop/local.paths.yaml
# Edit local.paths.yaml; standalone T-MAX projects keep their own per-repo example files.
npm run mount:tmax
npm run setup:codex
```

The setup command first builds Xiaobai's routing CLI, then uses the current clone's real path to idempotently update that contributor's own `CODEX_HOME/hooks.json`. It preserves unrelated hooks and replaces only Xiaobai's hook. It does not create hidden configuration in a business repository, install an external Skill, copy Xigua source, or modify any business repository. Fully quit and restart Codex Desktop, then create a new conversation.

When a contributor uses a non-default Codex directory through `CODEX_HOME`, the script writes there automatically; if the Xiaobai clone moves, run `npm run setup:codex` again. Routing still reads only Xiaobai's project registry and mounted backgrounds, and does not depend on the committer's filesystem layout. `npm run mount:tmax` is a one-time per-machine mount prerequisite; it creates only Git-ignored `.local` symlinks.

## 独立 T-MAX 项目挂载 / Standalone T-MAX Projects

中文：

KPIUI 与其余 6 个 T-MAX 仓（`max-console-ui`、`max-operate-monitor-ui`、`operateBusiness`、`operateSupport`、`dcm`、`scan`）均已迁移为独立 Project：每个仓一个 `workspace/projects/<repoId>/` 目录，持有自己的 `project.yaml`（kind: Project，executor=xigua）、`SKILL.md` 与 `local.paths.yaml`。新机器初始化时，除 `t-max` 组外，还要为用到的每个独立项目执行同样的复制：

```bash
cp workspace/projects/<repoId>/.loop/local.paths.yaml.example workspace/projects/<repoId>/.loop/local.paths.yaml
```

`npm run mount:tmax` 会把独立项目的仓库与 xigua 背景挂载到与项目组相同的 `workspace/.local/t-max/mounts/` 根下；路由、范围与执行规范以各独立项目自己的 `SKILL.md` 为准。

English:

KPIUI and the other six T-MAX repositories (`max-console-ui`, `max-operate-monitor-ui`, `operateBusiness`, `operateSupport`, `dcm`, `scan`) have all migrated to standalone Projects: one `workspace/projects/<repoId>/` directory per repository, owning its own `project.yaml` (kind: Project, executor=xigua), `SKILL.md`, and `local.paths.yaml`. When initializing a new machine, copy the example for each standalone project you use, in addition to the `t-max` group:

```bash
cp workspace/projects/<repoId>/.loop/local.paths.yaml.example workspace/projects/<repoId>/.loop/local.paths.yaml
```

`npm run mount:tmax` mounts standalone repositories and the xigua background under the same `workspace/.local/t-max/mounts/` root as the project group; routing, scope, and execution rules follow each standalone project's own `SKILL.md`.
