export function renderCaseTemplate(input: {
  id: string;
  title: string;
  projectId: string;
  loopId?: string;
  runId?: string;
  date: string;
  body?: string;
}): string {
  return `---\nid: ${input.id}\ntitle: ${JSON.stringify(input.title)}\nstatus: draft\ntype: case\nproject: ${input.projectId}\n${input.loopId ? `loop: ${input.loopId}\n` : ''}tags:\n  - status/draft\n  - type/case\n  - project/${input.projectId}\ndomain:\n  - ai-engineering\nsource: local\naccess: private\nconfidence: medium\ncreated_at: ${input.date}\nupdated_at: ${input.date}\nsource_project: ${input.projectId}\n${input.loopId ? `source_loop: ${input.loopId}\n` : ''}${input.runId ? `source_run_id: ${input.runId}\n` : ''}promote_score: 0\nrelated_patterns: []\n---\n\n# ${input.title}\n\n${input.body ?? '## Trigger\n\n## Symptom\n\n## Rule\n\n## Anti-Pattern\n\n## Scope\n\n## Evidence\n\n## Reuse Hint\n'}\n`;
}
