# 质量、验证与交付 / Quality, Verification, And Delivery

## 中文

### 验证分层

小白的验证要匹配改动风险：

- 纯文档或 Trellis spec 更新：检查占位模板残留、双语结构、索引链接、`git diff --check` 和相关上下文命令。
- runtime、schema、memory、workspace 配置或脚本改动：`npm run validate` 和 `npm test` 属于提交或合并前人工确认门禁，执行前必须询问用户。
- T-MAX 业务仓改动：进入目标仓自己的 Git root，按目标仓命令和小能/T-MAX 规则验证；不要用小白外层测试代替。
- OpenHands 分发改动：遵守 `deploy/openhands/README.md` 的 package、doctor、runtime 和凭据扫描边界。

用户已有偏好是不主动做业务构建。不要为了“显得完整”运行全量构建或业务包命令。

### 可信测试例子

- `loop-engineering/tests/runtime.test.ts`：验证 workspace schema、loop routing、target repository resolution、workflow stage、human gate、orchestrator 输出和 self-review 禁止。
- `loop-engineering/tests/memory-cli.test.ts`：验证 memory init、snapshot、checkpoint、audit、index、search、context、capture、promote、doctor 和 report。
- `loop-engineering/tests/control-plane.test.ts`：验证 workspace control-plane 的 preflight、path mode、API 行为和错误路径。
- `loop-engineering/tests/memory-protocol.test.ts` 与 `memory-schema.test.ts`：验证 memory 协议与 schema。

### Git 边界

- 开始和结束都要看 `git status --short -uall`。
- 不 stage、不 commit、不 push，除非用户在当前请求明确授权。
- 有不相关本地改动时，记录并避开；不要 reset、checkout 或格式化它们。
- `workspace/.local/`、`local.paths.yaml`、`.trellis/.runtime/` 和密钥类文件不得进入提交。
- 小白 `origin` 可能 fan out 到多个 push URL；提交或推送结论必须用实际 remote SHA 和分支差异证明。

### Memory 和 Trellis 收尾

形成可复用规则、架构决定、工程配置变更或跨任务复盘时，要写中英双语 summary，运行：

```bash
npm run memory:checkpoint -- --title "<中文 / English>" --body <summary.md> --write --json
npm run memory:audit-today -- --json
```

Trellis `finish-work` 不是自动提交代码的捷径。只有当前任务代码已经按 Phase 3.4 处理、用户确认的提交边界清楚时，才进入 archive 和 journal 记录。

### 交付说明

最终说明要包含：

- 改了什么，以及为什么这些文件属于当前任务。
- 实际运行的验证命令和结果。
- 未运行的验证及原因。
- 已发现但未处理的不相关本地改动。
- 是否写入 memory checkpoint 和审计是否通过。

## English

### Verification Layers

Xiaobai verification should match change risk:

- Documentation or Trellis spec updates: check for remaining template text, bilingual structure, index links, `git diff --check`, and relevant context commands.
- Runtime, schema, memory, workspace configuration, or script changes: `npm run validate` and `npm test` are human-confirmed gates before commit or merge, so ask before running them.
- T-MAX business repository changes: enter the target repository's own Git root and validate with that repository's commands plus Xiaoneng/T-MAX rules. Do not use outer Xiaobai tests as a substitute.
- OpenHands distribution changes: follow the package, doctor, runtime, and credential-scan boundaries in `deploy/openhands/README.md`.

The user has a standing preference against proactive business builds. Do not run full builds or business package commands just to make the handoff look complete.

### Trusted Test Examples

- `loop-engineering/tests/runtime.test.ts`: validates workspace schema, loop routing, target repository resolution, workflow stages, human gates, orchestrator output, and the self-review ban.
- `loop-engineering/tests/memory-cli.test.ts`: validates memory init, snapshot, checkpoint, audit, index, search, context, capture, promote, doctor, and report.
- `loop-engineering/tests/control-plane.test.ts`: validates workspace control-plane preflight, path mode, API behavior, and error paths.
- `loop-engineering/tests/memory-protocol.test.ts` and `memory-schema.test.ts`: validate memory protocol and schema behavior.

### Git Boundaries

- Check `git status --short -uall` at the beginning and end.
- Do not stage, commit, or push unless the current user request explicitly authorizes it.
- When unrelated local changes exist, record and avoid them; do not reset, checkout, or format them.
- `workspace/.local/`, `local.paths.yaml`, `.trellis/.runtime/`, and secret-bearing files must not enter a commit.
- Xiaobai `origin` may fan out to multiple push URLs. Commit or push claims must be proven with actual remote SHAs and branch divergence.

### Memory And Trellis Closeout

When work creates reusable rules, architecture decisions, engineering configuration changes, or cross-task retrospectives, write a bilingual summary and run:

```bash
npm run memory:checkpoint -- --title "<Chinese / English>" --body <summary.md> --write --json
npm run memory:audit-today -- --json
```

Trellis `finish-work` is not a shortcut for auto-committing code. Archive and journal recording should happen only after current-task code has gone through Phase 3.4 and the user-confirmed commit boundary is clear.

### Handoff Notes

The final handoff should include:

- What changed and why those files belong to the current task.
- The verification commands that actually ran and their results.
- Verification that was not run, with reasons.
- Unrelated local changes that were observed but not touched.
- Whether a memory checkpoint was written and whether the audit passed.
