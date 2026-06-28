# Obsidian Memory Implementation Plan

> **For implementer:** Use TDD throughout. Write failing tests first, confirm they fail, then implement the smallest passing change. Do not mark a task complete until its verification commands pass.

**Goal:** Build a complete, engineering-grade Obsidian-backed memory system for Loop Engineering with project isolation, global indexing, search, context loading, capture, promotion, validation, and documentation.

**Architecture:** Implement the system as TypeScript packages inside `loop-engineering/packages`, connected through the existing `loop` CLI. Keep Obsidian as file-based durable storage and `memory-index.json` as the stable retrieval index.

**Tech Stack:** TypeScript, Node.js built-ins, `yaml`, existing CLI/runtime/test structure, JSON Schema, Node test runner.

## Confirmation Rules

- Every task starts unchecked: `- [ ]`.
- A task may be changed to `- [x]` only after its stated verification passes.
- The final delivery may be declared complete only when every task is checked.
- If a task is partially done, leave it unchecked and add a short note under that task.
- Do not skip tests because a task is "obvious".
- Do not rewrite or delete user-authored Obsidian files unless a task explicitly says to and the command requires `--confirm`.

## Phase 1: Protocol And Schemas

- [x] **Task 1.1: Add Memory Index JSON Schema**
  - Create `loop-engineering/schemas/memory-index.schema.json`.
  - Cover `schemaVersion`, roots, projects, notes, cases, patterns, tags, links, warnings.
  - Require stable fields for `NoteEntry`: `id`, `kind`, `title`, `path`, `vaultRelativePath`, `obsidianLink`, `tags`, `summary`, `headings`, `links`, `keywords`, `mtimeMs`, `sizeBytes`, `contentHash`.
  - Verification: schema validates a representative generated index fixture and rejects missing required fields.

- [x] **Task 1.2: Add Memory Note JSON Schema**
  - Create `loop-engineering/schemas/memory-note.schema.json`.
  - Define accepted frontmatter values for status, type, confidence, access, source.
  - Allow unknown extra fields for human flexibility.
  - Verification: valid case, pattern, project profile, and malformed note fixtures behave as expected.

- [x] **Task 1.3: Finalize Architecture Documentation**
  - Keep `loop-engineering/docs/obsidian-memory-architecture.md` aligned with implemented schemas.
  - Add examples for every command.
  - Add safety and recovery sections.
  - Verification: docs mention every CLI command and every write command's confirmation mode.

## Phase 2: Memory Protocol Package

- [x] **Task 2.1: Create Package Skeleton**
  - Create `loop-engineering/packages/memory-protocol/src`.
  - Add `types.ts`, `paths.ts`, `frontmatter.ts`, `markdown.ts`, `hash.ts`, `templates.ts`, `index.ts`.
  - Export only stable functions from `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 2.2: Implement Memory Path Resolution**
  - Implement vault root, learning root, global index root, project root, loop root, cases root, patterns root resolution.
  - Support explicit `--vault`, workspace local `memoryRoot`, and temporary test vaults.
  - Refuse paths that resolve outside allowed roots for writes.
  - Verification: tests cover absolute paths, workspace-relative paths, Chinese path segments, and outside-root rejection.

- [x] **Task 2.3: Implement Frontmatter Parser**
  - Parse YAML frontmatter using existing `yaml` dependency.
  - Return content body, parsed metadata, warnings.
  - Tolerate missing or malformed frontmatter without throwing.
  - Normalize tags to unique strings.
  - Verification: tests cover missing frontmatter, malformed YAML, scalar tags, array tags, duplicate tags.

- [x] **Task 2.4: Implement Markdown Extraction**
  - Extract title, headings, Obsidian links, summary, keywords, and markdown body.
  - Prefer frontmatter `title`; fallback to first H1; fallback to filename.
  - Summary should be deterministic and short enough for index display.
  - Verification: tests cover Chinese headings, aliases in links, no H1, empty files.

- [x] **Task 2.5: Implement Content Hash**
  - Compute deterministic content hash for files.
  - Do not follow symlinks.
  - Verification: tests show same content has same hash and changed content changes hash.

- [x] **Task 2.6: Implement Templates**
  - Provide templates for global index Markdown files, project `index.md`, `project-profile.md`, `active-context.md`, `decisions.md`, `inbox.md`, loop files, case, and pattern.
  - Templates must use controlled frontmatter tags.
  - Verification: generated templates parse through the frontmatter parser and note schema.

## Phase 3: CLI Memory Command Router

- [x] **Task 3.1: Add Memory CLI Router**
  - Create `loop-engineering/cli/memory.ts`.
  - Route subcommands: `init`, `validate`, `doctor`, `index`, `search`, `context`, `capture`, `promote`, `report`.
  - Keep `loop-engineering/cli/loop.ts` as the top-level command entry.
  - Verification: unknown memory subcommands show help and exit non-zero.

- [x] **Task 3.2: Standardize Command Output**
  - Implement shared output helpers for human and `--json` modes.
  - Standard error shape: `ok`, `command`, `errors`, `warnings`.
  - Verification: CLI tests assert JSON parseability for success and failure.

- [x] **Task 3.3: Implement Write Confirmation Contract**
  - All write-capable commands default to preview.
  - `init`, `index`, `capture`, `report` require `--write` to write.
  - `promote` requires `--confirm`.
  - Verification: tests assert preview does not create files and write flags do.

## Phase 4: Initialization

- [x] **Task 4.1: Implement `loop memory init` Preview**
  - Calculate planned global and project files.
  - Report created, existing, skipped, and warnings without writing.
  - Verification: preview leaves temp vault unchanged.

- [x] **Task 4.2: Implement `loop memory init --write`**
  - Create required directories.
  - Write missing templates only.
  - Do not overwrite existing files unless `--overwrite` is provided.
  - Verification: write creates expected tree; second write is idempotent.

- [x] **Task 4.3: Add Init Tests For Existing Vaults**
  - Cover existing `.obsidian`, missing `.obsidian`, and explicit memory roots.
  - Verification: safe behavior in all three modes.

## Phase 5: Indexer

- [x] **Task 5.1: Create Memory Indexer Package**
  - Create `loop-engineering/packages/memory-indexer/src`.
  - Add `memoryIndexer.ts`, `noteClassifier.ts`, `indexWriter.ts`, `indexSchema.ts`, `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 5.2: Implement Project Scanning**
  - Scan `88-学习/10-项目记忆/*`.
  - Identify project id from directory name and project `index.md`.
  - Do not follow symlinks.
  - Verification: tests cover multiple projects and nested loop directories.

- [x] **Task 5.3: Implement Note Classification**
  - Classify project index, project profile, active context, decision, inbox, loop state, case, pattern, report, unknown.
  - Use path and frontmatter together.
  - Verification: classification tests cover every kind.

- [x] **Task 5.4: Implement Index Generation**
  - Generate `projects`, `notes`, `cases`, `patterns`, `tags`, `links`, `warnings`.
  - Include content hash, metadata, summaries, headings, links, keywords.
  - Verification: snapshot-style tests assert deterministic output.

- [x] **Task 5.5: Implement Atomic Index Writing**
  - Write `memory-index.json.tmp`.
  - Rename to `memory-index.json`.
  - Preserve valid existing index on write failure.
  - Verification: tests simulate writer failure and confirm no corrupt final file.

- [x] **Task 5.6: Implement `loop memory index`**
  - Preview mode reports planned index path and summary counts.
  - `--write` writes the index.
  - `--json` emits generated counts and warnings.
  - Verification: CLI test confirms index file and JSON output.

## Phase 6: Validation And Doctor

- [x] **Task 6.1: Create Memory Doctor Package**
  - Create `loop-engineering/packages/memory-doctor/src`.
  - Add `validateMemory.ts`, `doctorMemory.ts`, `jsonl.ts`, `indexFreshness.ts`, `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 6.2: Implement Protocol Validation**
  - Validate required directories and files.
  - Validate `memory-index.json` against schema.
  - Validate JSONL files line by line.
  - Detect duplicate ids and broken internal links when possible.
  - Verification: tests cover valid vault, invalid JSONL, duplicate ids, missing required files.

- [x] **Task 6.3: Implement Index Freshness Check**
  - Compare indexed content hashes and file mtimes against disk.
  - Report stale, missing, and unindexed files.
  - Verification: tests mutate files after indexing and validate stale warnings.

- [x] **Task 6.4: Implement Doctor Health Report**
  - Score memory health.
  - Report oversized files, orphan notes, missing tags, missing confidence, stale active context, high-promote unreviewed cases.
  - Do not modify files.
  - Verification: tests cover each warning category.

- [x] **Task 6.5: Implement `validate` And `doctor` CLI**
  - Add `loop memory validate`.
  - Add `loop memory doctor`.
  - Support `--json`.
  - Verification: CLI tests assert exit codes and JSON output.

## Phase 7: Search

- [x] **Task 7.1: Create Memory Search Package**
  - Create `loop-engineering/packages/memory-search/src`.
  - Add `memorySearch.ts`, `scoring.ts`, `filters.ts`, `indexReader.ts`, `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 7.2: Implement Index Reader**
  - Read and validate `memory-index.json`.
  - If missing, return a clear "run index first" error.
  - Verification: tests cover missing, malformed, and valid index.

- [x] **Task 7.3: Implement Filters**
  - Filter by project, type, tag, confidence, kind, limit.
  - Verification: tests cover combined filters.

- [x] **Task 7.4: Implement Scoring**
  - Implement deterministic scoring: keyword, title, tag overlap, same project, confidence, recency, promote score.
  - Return matched fields for audit.
  - Verification: tests assert ordering and matched fields.

- [x] **Task 7.5: Implement `loop memory search`**
  - Support text query plus filters.
  - Human output shows score, title, project, path, summary.
  - JSON output includes full match data.
  - Verification: CLI tests cover successful and no-result searches.

## Phase 8: Context Loading

- [x] **Task 8.1: Create Memory Context Package**
  - Create `loop-engineering/packages/memory-context/src`.
  - Add `memoryContextLoader.ts`, `budget.ts`, `bundle.ts`, `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 8.2: Implement Context Bundle Model**
  - Define included items, omitted items, source paths, priority, character counts, warnings.
  - Verification: tests construct and serialize bundles.

- [x] **Task 8.3: Implement Core Project Loading**
  - Load project profile, active context, decisions, loop state, loop inbox.
  - Missing optional files should warn, not fail.
  - Verification: tests cover full and partial project directories.

- [x] **Task 8.4: Implement Search-Based Context Expansion**
  - Use memory search to include top local and cross-project cases/patterns.
  - Respect project and loop context.
  - Verification: tests cover relevant cross-project matches.

- [x] **Task 8.5: Implement Budgeting**
  - Fit bundle within `maxCharacters`.
  - Omit lower-priority items before truncating higher-priority Markdown.
  - Never split JSONL lines.
  - Verification: tests cover small budgets, omitted lists, and stable ordering.

- [x] **Task 8.6: Implement `loop memory context`**
  - Support `--project`, `--loop`, `--query`, `--maxCharacters`, `--json`.
  - Verification: CLI tests assert included and omitted paths.

- [x] **Task 8.7: Integrate Context Metadata Into Dry Run**
  - Extend runtime plan with memory context metadata.
  - Do not dump full memory content into dry-run output.
  - Verification: existing dry-run tests updated and pass.

## Phase 9: Capture Case

- [x] **Task 9.1: Create Memory Capture Package**
  - Create `loop-engineering/packages/memory-capture/src`.
  - Add `caseWriter.ts`, `slug.ts`, `caseTemplate.ts`, `index.ts`.
  - Verification: TypeScript build passes.

- [x] **Task 9.2: Implement Case Slug And Id Generation**
  - Generate stable date-prefixed filenames.
  - Avoid overwrites by adding suffixes.
  - Support Chinese titles by generating safe slugs.
  - Verification: tests cover collisions and non-ASCII titles.

- [x] **Task 9.3: Implement Case Template Writer**
  - Required sections: Trigger, Symptom, Rule, Anti-Pattern, Scope, Evidence, Reuse Hint.
  - Include source project, loop, run id, tags, confidence, promote score.
  - Preview by default.
  - Verification: tests assert frontmatter and sections.

- [x] **Task 9.4: Implement `loop memory capture case`**
  - Accept title, body file, source report, loop, run id.
  - `--write` writes case and refreshes index.
  - Verification: CLI test writes a case and search finds it.

## Phase 10: Promote Pattern

- [x] **Task 10.1: Implement Pattern Template**
  - Include applicability, counterexamples, stop conditions, source cases, evidence count, reuse hint.
  - Verification: template parses and validates.

- [x] **Task 10.2: Implement Pattern Promotion**
  - Promote one or more cases to a pattern.
  - Require `--confirm`.
  - Update source case links when safe.
  - Update global `patterns.md` and index.
  - Verification: tests assert created pattern, updated index, and source links.

- [x] **Task 10.3: Implement `loop memory promote`**
  - Support `--case`, `--cases`, `--title`, `--project`, `--global`, `--confirm`, `--json`.
  - Preview without `--confirm`.
  - Verification: CLI tests cover preview and confirmed write.

## Phase 11: Reports

- [x] **Task 11.1: Implement Memory Report Generator**
  - Generate Markdown report under project `reports/`.
  - Include index stats, doctor summary, recent cases, promotion candidates, stale files.
  - Preview by default.
  - Verification: tests assert report content.

- [x] **Task 11.2: Implement `loop memory report`**
  - Support `--write`, `--json`, `--project`.
  - Refresh index before report when `--write` is used.
  - Verification: CLI test writes report and validates index sees it.

## Phase 12: Simulation Runtime Integration

- [x] **Task 12.1: Route Simulation Cases To Obsidian**
  - Modify `loop-engineering/packages/simulation-runtime/src/simulationRuntime.ts`.
  - Write project case into Obsidian project `cases/`.
  - Keep repo `data/` artifacts only as local simulation/test artifacts.
  - Verification: simulation test confirms Obsidian case exists in temp memory root.

- [x] **Task 12.2: Refresh Index After Simulation**
  - Simulation should refresh memory index when it writes memory artifacts.
  - Verification: simulation test searches for the generated case through the index.

## Phase 13: Documentation

- [x] **Task 13.1: Update Root README**
  - Explain Obsidian memory workflow and commands.
  - Include quick start for a new project.
  - Verification: README references all stable commands.

- [x] **Task 13.2: Update Workspace Memory README**
  - Explain project-isolated Obsidian layout.
  - Explain which files are human-editable and which are machine logs.
  - Verification: README examples match implemented paths.

- [x] **Task 13.3: Add Migration Guide**
  - Document migrating existing `workspace/memory` into Obsidian.
  - Include rollback and validation steps.
  - Verification: guide includes exact commands and expected outputs.

## Phase 14: End-To-End Acceptance

- [x] **Task 14.1: Add E2E Test For Full Memory Lifecycle**
  - Temporary vault.
  - Init project.
  - Index.
  - Search.
  - Context.
  - Capture case.
  - Promote pattern.
  - Validate.
  - Doctor.
  - Verification: one test covers full lifecycle with no real vault access.

- [x] **Task 14.2: Run Full Test Suite**
  - Run `npm test`.
  - Fix failures at root cause.
  - Verification: all tests pass.

- [x] **Task 14.3: Verify Current Real Project Commands**
  - Run:
    ```bash
    npm run loop -- memory validate --json
    npm run loop -- memory index --write --json
    npm run loop -- memory search "Loop Engineering" --json
    npm run loop -- memory context --loop morning-triage --json
    ```
  - Verification: all commands succeed against current Obsidian project memory.

- [x] **Task 14.4: Final Checklist Review**
  - Confirm every task in this file is checked.
  - Confirm no user-authored Obsidian files were unexpectedly overwritten.
  - Confirm docs match implemented behavior.
  - Verification: final response may be sent only after all tasks are checked.
