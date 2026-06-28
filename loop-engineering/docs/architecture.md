# Loop Engineering Architecture

The system is organized around responsibility boundaries instead of around a single agent runner.

## Engine vs Workspace

`loop-engineering/` is the reusable engine. It owns runtime code, schemas, templates, and tests.

`workspace/` is the operating space. It owns project-specific loop specs, project skills, connector config, persistent memory, worktrees, reports, agents, and budgets.

## Core Contract

A loop spec must make these steps explicit:

```text
discovery -> handoff -> verification -> persistence -> schedule
```

Each step is handled by a separate runtime package so the system can evolve without turning into one large prompt or one large orchestrator.

## Safety Defaults

- Generator and evaluator are separate agent specs.
- Dry runs do not mutate the workspace.
- Memory is disk-backed and outside the prompt context.
- Connector write permissions deny merge and repository settings changes by default.
- Human gates protect merge, auth, payment, destructive file, and major dependency actions.
- Budget limits are validated before planning any run.
