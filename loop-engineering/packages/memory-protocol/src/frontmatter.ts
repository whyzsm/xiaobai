import YAML from 'yaml';
import { ParsedFrontmatter } from './types';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return {
      data: {},
      body: content,
      warnings: []
    };
  }

  const raw = match[1] ?? '';
  const body = content.slice(match[0].length);
  const warnings: string[] = [];
  let data: Record<string, unknown> = {};

  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = normalizeFrontmatter(parsed as Record<string, unknown>);
    } else {
      warnings.push('Frontmatter is not an object.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Invalid frontmatter: ${message}`);
  }

  return {
    data,
    body,
    warnings
  };
}

function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    tags: normalizeStringArray(data.tags),
    domain: normalizeStringArray(data.domain)
  };
}

export function normalizeStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
}
