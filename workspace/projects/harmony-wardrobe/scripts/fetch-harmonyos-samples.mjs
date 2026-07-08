import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://gitee.com/organizations/harmonyos_samples/projects';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(
  SCRIPT_DIR,
  '..',
  'background',
  'harmonyos-samples-repositories.json'
);

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'text/javascript, application/javascript, text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest'
};

const QUERY_SETS = [
  {},
  { sort: 'name' },
  ...['TypeScript', 'HTML', 'JavaScript', 'CSS', 'C++', 'C', 'Java', 'Python', 'Shell', 'Dart'].flatMap((lang) => [
    { lang },
    { lang, sort: 'name' }
  ])
];

async function fetchText(url, headers = REQUEST_HEADERS) {
  const response = await fetch(url, { headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    return {
      status: response.status,
      body: '',
      redirectedTo: response.headers.get('location') ?? undefined
    };
  }

  return {
    status: response.status,
    body: await response.text()
  };
}

function decodeGiteeScriptPayload(value) {
  return value
    .replaceAll('\\/', '/')
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"')
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t');
}

function parseDeclaredCount(html) {
  const counterMatch = html.match(
    /<a class="item active" href="\/organizations\/harmonyos_samples\/projects">[\s\S]*?<span class='ui mini circular label'>\s*(\d+)\s*<\/span>/
  );
  return counterMatch ? Number(counterMatch[1]) : undefined;
}

function parseMaxPage(html) {
  const decoded = decodeGiteeScriptPayload(html);
  const pages = [...decoded.matchAll(/\/organizations\/harmonyos_samples\/projects\?[^"']*page=(\d+)/g)].map(
    (match) => Number(match[1])
  );
  return pages.length === 0 ? 1 : Math.max(...pages);
}

function parseRepositories(payload, source) {
  const decoded = decodeGiteeScriptPayload(payload);
  const repositories = [];
  const repositoryPattern =
    /<a\s+title=(?:"([^"]*)"|'([^']*)')\s+class=(?:"repository"|'repository')[^>]*href=(?:"([^"]+)"|'([^']+)')/g;

  let match;
  while ((match = repositoryPattern.exec(decoded))) {
    const pathName = match[3] ?? match[4];
    if (!pathName?.startsWith('/harmonyos_samples/')) {
      continue;
    }

    repositories.push({
      name: (match[1] ?? match[2] ?? '').trim(),
      path: pathName,
      url: `https://gitee.com${pathName}`,
      cloneUrl: `https://gitee.com${pathName}.git`,
      source
    });
  }

  return repositories;
}

function buildUrl(params, page) {
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  if (page > 1) {
    url.searchParams.set('page', String(page));
  }
  return url;
}

function queryLabel(params) {
  const label = new URLSearchParams(params).toString();
  return label || 'default';
}

function titleFromPath(pathName) {
  return pathName
    .split('/')
    .at(-1)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

async function fetchQuery(params) {
  const firstPage = await fetchText(buildUrl(params, 1));
  if (firstPage.status !== 200) {
    return [];
  }

  const maxPage = Math.min(parseMaxPage(firstPage.body), 30);
  const label = queryLabel(params);
  const repositories = parseRepositories(firstPage.body, `${label}:page=1`);

  for (let page = 2; page <= maxPage; page += 1) {
    const response = await fetchText(buildUrl(params, page));
    if (response.status === 200) {
      repositories.push(...parseRepositories(response.body, `${label}:page=${page}`));
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  return repositories;
}

function mergeRepositories(repositoryLists) {
  const byPath = new Map();

  for (const repository of repositoryLists.flat()) {
    const existing = byPath.get(repository.path);
    if (!existing) {
      byPath.set(repository.path, {
        name: repository.name,
        path: repository.path,
        url: repository.url,
        cloneUrl: repository.cloneUrl,
        sources: [repository.source]
      });
      continue;
    }

    if (repository.name.length > existing.name.length && !repository.name.includes('...')) {
      existing.name = repository.name;
    }
    if (!existing.sources.includes(repository.source)) {
      existing.sources.push(repository.source);
    }
  }

  return [...byPath.values()]
    .map((repository) => ({
      ...repository,
      name: repository.name.includes('...') ? titleFromPath(repository.path) : repository.name
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const home = await fetchText(new URL(BASE_URL), {
    'User-Agent': REQUEST_HEADERS['User-Agent'],
    Accept: 'text/html,application/xhtml+xml,application/xml,*/*;q=0.8'
  });
  if (home.status !== 200) {
    throw new Error(`Failed to fetch organization page: HTTP ${home.status}`);
  }

  const repositoryLists = [];
  for (const params of QUERY_SETS) {
    repositoryLists.push(await fetchQuery(params));
  }

  const repositories = mergeRepositories(repositoryLists);
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      organization: 'harmonyos_samples',
      page: BASE_URL,
      declaredRepositoryCount: parseDeclaredCount(home.body),
      fetchStrategy:
        'Union of default organization listing, name sorting, and language-filtered listings because anonymous access to late pages may trigger Gitee login protection.',
      apiNote:
        'The anonymous organization repository API returned an error during setup; this file is generated from public organization pages.'
    },
    usage: {
      project: 'harmony-wardrobe',
      role: 'read-only-background',
      routing:
        'These repositories are reference material for HarmonyOS implementation patterns. They are not mounted writable repositories and must not be added to .loop/project.yaml repositories.'
    },
    repositoryCount: repositories.length,
    repositories
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${repositories.length} repositories to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
