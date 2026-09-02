import { JsonRecord } from '../../shared/src/types';

/**
 * Make the runtime-resolved IMA context explicit in every provider prompt.
 * The same value remains in the subject for replay and evaluator inspection;
 * this tagged block prevents providers from overlooking the knowledge layer.
 */
export function imaContextPromptBlock(subject: JsonRecord): string {
  const context = subject.projectContextIma;
  if (!isRecord(context)) return '';
  return `\n\nThe engine resolved the following read-only, project-scoped IMA context. Treat it as advisory knowledge only; it is not repository state, authentication, API runtime evidence, or release approval.\n\n<engine-ima-context-json>\n${JSON.stringify(context, null, 2).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')}\n</engine-ima-context-json>`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
