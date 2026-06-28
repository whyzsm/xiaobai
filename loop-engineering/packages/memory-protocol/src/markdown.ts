import path from 'node:path';
import { normalizeStringArray } from './frontmatter';
import { MarkdownExtraction, MarkdownExtractionInput } from './types';

const HEADING_RE = /^#{1,6}\s+(.+)$/gm;
const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const WORD_RE = /[\p{Script=Han}]{2,}|[a-zA-Z0-9][a-zA-Z0-9_-]+/gu;

export function extractMarkdown(input: MarkdownExtractionInput): MarkdownExtraction {
  const headings = extractHeadings(input.body);
  const frontmatterTitle = stringValue(input.frontmatter.title);
  const title = frontmatterTitle || headings[0] || path.basename(input.filePath, path.extname(input.filePath));
  const links = extractLinks(input.body);
  const summary = extractSummary(input.body);
  const keywords = extractKeywords([title, ...headings, ...normalizeStringArray(input.frontmatter.tags), summary].join('\n'));

  return {
    title,
    headings,
    links,
    summary,
    keywords
  };
}

function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const match of body.matchAll(HEADING_RE)) {
    const heading = (match[1] ?? '').trim();
    if (heading) {
      headings.push(heading);
    }
  }
  return headings;
}

function extractLinks(body: string): string[] {
  const links: string[] = [];
  for (const match of body.matchAll(LINK_RE)) {
    const link = (match[1] ?? '').trim();
    if (link && !links.includes(link)) {
      links.push(link);
    }
  }
  return links;
}

function extractSummary(body: string, maxChars = 240): string {
  const withoutFrontHeading = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('---'))
    .join(' ');
  return withoutFrontHeading.length <= maxChars ? withoutFrontHeading : `${withoutFrontHeading.slice(0, maxChars).trimEnd()}...`;
}

function extractKeywords(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const keyword = match[0].toLowerCase();
    if (keyword.length < 2 || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    keywords.push(keyword);
    if (keywords.length >= limit) {
      break;
    }
  }
  return keywords;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
