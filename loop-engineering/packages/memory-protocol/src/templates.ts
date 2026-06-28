import { MemoryTemplate, MemoryTemplateOptions } from './types';

export function createMemoryTemplates(options: MemoryTemplateOptions): MemoryTemplate[] {
  const loopId = options.loopId ?? 'default-loop';
  const projectRoot = `88-学习/10-项目记忆/${options.projectId}`;

  return [
    {
      path: '88-学习/00-记忆索引/projects.md',
      content: frontmatter('项目记忆索引', 'memory-index', ['status/seed', 'type/memory-index']) + '# 项目记忆索引\n\n'
    },
    {
      path: '88-学习/00-记忆索引/cases.md',
      content: frontmatter('跨项目 Case 索引', 'case-index', ['status/seed', 'type/case-index']) + '# 跨项目 Case 索引\n\n'
    },
    {
      path: '88-学习/00-记忆索引/patterns.md',
      content: frontmatter('跨项目 Pattern 索引', 'pattern-index', ['status/seed', 'type/pattern-index']) + '# 跨项目 Pattern 索引\n\n'
    },
    {
      path: '88-学习/00-记忆索引/tags.md',
      content: frontmatter('记忆标签规范', 'tag-taxonomy', ['status/seed', 'type/tag-taxonomy']) + '# 记忆标签规范\n\n'
    },
    {
      path: `${projectRoot}/index.md`,
      content:
        frontmatter(`${options.projectId} 项目记忆`, 'project-memory', [
          'status/active',
          'type/project-memory',
          `project/${options.projectId}`
        ]) + `# ${options.projectId} 项目记忆\n\n## 项目入口\n\n- [[project-profile]]\n- [[active-context]]\n`
    },
    {
      path: `${projectRoot}/project-profile.md`,
      content:
        frontmatter(`${options.projectId} 项目画像`, 'project-profile', [
          'status/active',
          'type/project-profile',
          `project/${options.projectId}`
        ]) + `# ${options.projectId} 项目画像\n\n## 一句话\n\n待补充。\n`
    },
    {
      path: `${projectRoot}/active-context.md`,
      content:
        frontmatter(`${options.projectId} 当前上下文`, 'active-context', [
          'status/active',
          'type/active-context',
          `project/${options.projectId}`
        ]) + `# ${options.projectId} 当前上下文\n\n## 当前目标\n\n待补充。\n`
    },
    {
      path: `${projectRoot}/decisions.md`,
      content:
        frontmatter(`${options.projectId} 决策记录`, 'decision', [
          'status/active',
          'type/decision',
          `project/${options.projectId}`
        ]) + '# 决策记录\n\n'
    },
    {
      path: `${projectRoot}/inbox.md`,
      content:
        frontmatter(`${options.projectId} Inbox`, 'inbox', [
          'status/active',
          'type/inbox',
          `project/${options.projectId}`
        ]) + '# Inbox\n\n'
    },
    {
      path: `${projectRoot}/loops/${loopId}/state.md`,
      content:
        frontmatter(`${loopId} Loop State`, 'loop-state', [
          'status/active',
          'type/loop-state',
          `project/${options.projectId}`,
          `loop/${loopId}`
        ]) + `# ${loopId} State\n\n`
    },
    {
      path: `${projectRoot}/cases/${options.date}-seed-case.md`,
      content:
        frontmatter('Seed Case', 'case', ['status/seed', 'type/case', `project/${options.projectId}`]) +
        `# Seed Case\n\n## Trigger\n\n## Symptom\n\n## Rule\n\n## Anti-Pattern\n\n## Scope\n\n## Evidence\n\n## Reuse Hint\n`
    },
    {
      path: `${projectRoot}/patterns/seed-pattern.md`,
      content:
        frontmatter('Seed Pattern', 'pattern', ['status/seed', 'type/pattern', `project/${options.projectId}`]) +
        '# Seed Pattern\n\n## Applicability\n\n## Counterexamples\n\n## Stop Conditions\n\n## Source Cases\n'
    }
  ];
}

function frontmatter(title: string, type: string, tags: string[]): string {
  return `---\ntitle: ${JSON.stringify(title)}\nstatus: ${tags.includes('status/active') ? 'active' : 'seed'}\ntype: ${type}\ntags:\n${tags.map((tag) => `  - ${tag}`).join('\n')}\ndomain:\n  - ai-engineering\nsource: local\naccess: private\nconfidence: medium\n---\n\n`;
}
