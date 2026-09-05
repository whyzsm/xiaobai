import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CaseIndexEntry,
  mergeCasesIndexEntries,
  mergePatternsIndexUpdateLines,
  renderPatternsIndex
} from '../packages/simulation-runtime/src/simulationRuntime';

test('cases index merge replaces same-id entry and preserves others', () => {
  const previous = JSON.stringify([
    { id: 'tg-case-2026-06-28-loop-simulation-lifecycle', title: 'june original', path: 'data/cases/june.md' },
    { id: 'tg-case-2026-07-01-loop-simulation-lifecycle', title: 'july', path: 'data/cases/july.md' }
  ]);
  const next: CaseIndexEntry = {
    id: 'tg-case-2026-06-28-loop-simulation-lifecycle',
    title: 'june rerun',
    path: 'data/cases/june.md'
  };
  const merged = mergeCasesIndexEntries(previous, next);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((entry) => entry.id === next.id)?.title, 'june rerun');
  assert.equal(merged.find((entry) => entry.id === 'tg-case-2026-07-01-loop-simulation-lifecycle')?.title, 'july');
});

test('cases index merge appends fresh ids and falls back on corrupt or missing input', () => {
  const next: CaseIndexEntry = { id: 'tg-case-2026-09-05-loop-simulation-lifecycle' };
  assert.equal(mergeCasesIndexEntries('', next).length, 1);
  assert.equal(mergeCasesIndexEntries('not-json', next).length, 1);
  assert.equal(mergeCasesIndexEntries(JSON.stringify([{ title: 'no id field' }]), next).length, 1);
  const appended = mergeCasesIndexEntries(JSON.stringify([{ id: 'old-case' }]), next);
  assert.deepEqual(appended.map((entry) => entry.id), ['old-case', next.id]);
});

test('patterns index update lines keep newest first, dedupe repeats, and stay bounded', () => {
  const previous = '# Patterns Index\n\n## 主题目录\n\n- 暂无 active pattern。当前共 2 条 simulation case。\n\n## 最近更新\n\n- 2026-06-28: 新增 `a.md`\n- 2026-07-01: 新增 `b.md`\n';
  const merged = mergePatternsIndexUpdateLines(previous, ['- 2026-09-05: 新增 `c.md`']);
  assert.deepEqual(merged, ['- 2026-09-05: 新增 `c.md`', '- 2026-06-28: 新增 `a.md`', '- 2026-07-01: 新增 `b.md`']);

  const rerun = mergePatternsIndexUpdateLines(
    '# Patterns Index\n\n## 最近更新\n\n- 2026-09-05: 新增 `c.md`\n',
    ['- 2026-09-05: 新增 `c.md`']
  );
  assert.equal(rerun.length, 1);

  const many = Array.from({ length: 40 }, (_, index) => `- line-${index}`);
  assert.equal(mergePatternsIndexUpdateLines('', many).length, 30);
});

test('patterns index rendering reflects real case count and threshold state', () => {
  const below = renderPatternsIndex(2, ['- 2026-09-05: 新增 `c.md`']);
  assert.match(below, /当前共 2 条 simulation case/);
  assert.match(below, /未达到 3 条 case 的 pattern 归纳阈值/);

  const above = renderPatternsIndex(4, ['- 2026-09-05: 新增 `c.md`']);
  assert.match(above, /当前共 4 条 simulation case/);
  assert.match(above, /已达到 3 条 pattern 归纳阈值/);
});
