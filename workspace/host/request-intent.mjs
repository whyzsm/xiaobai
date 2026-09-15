import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const PAGE_NOUNS = [
  '页面',
  '列表页',
  '表单',
  '弹窗',
  '抽屉',
  '看板',
  'dashboard',
  '路由',
  '菜单',
  '组件',
  '接口联调',
  '接口接线',
  '页面代码',
  '页面目录'
];

const PAGE_ACTIONS = [
  '新增',
  '添加',
  '创建',
  '生成',
  '实现',
  '开发',
  '修改',
  '改造',
  '重构',
  '补充',
  '接入',
  '联调',
  '排错',
  '分析',
  '评估',
  '排查',
  '诊断',
  '修复',
  '优化',
  '删除',
  '怎么做',
  '如何',
  '方案',
  '流程',
  '耗时',
  '卡点',
  '为什么',
  '无法',
  '不能'
];

const PAGE_PHRASES = [
  '页面需求',
  '页面生成',
  '页面流程',
  '页面卡点',
  '页面耗时',
  '页面优化',
  '前端实现',
  '页面交付',
  '页面骨架',
  '页面接口'
];

/**
 * Loads only project metadata. Business repositories and page sources are
 * intentionally outside this classifier's read boundary.
 */
export async function loadXiguaProjectCatalog(projectRoot) {
  const projectsRoot = path.join(projectRoot, 'workspace', 'projects');
  const projectDirs = (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const projects = [];

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsRoot, projectDir, '.loop', 'project.yaml');
    let project;
    try {
      project = parseYaml(await readFile(projectPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`Unable to read project metadata: ${projectPath}`, { cause: error });
    }

    if (project?.background?.runtime?.provider !== 'xigua') continue;

    const repositories = Array.isArray(project.repositories) ? project.repositories : [];
    for (const repository of repositories) {
      projects.push({
        projectId: String(project.id ?? projectDir),
        projectName: String(project.name ?? project.id ?? projectDir),
        repositoryId: String(repository.id ?? ''),
        aliases: uniqueStrings([
          project.id,
          project.name,
          repository.id,
          repository.name,
          repository.localPathKey
        ])
      });
    }

    if (repositories.length === 0) {
      projects.push({
        projectId: String(project.id ?? projectDir),
        projectName: String(project.name ?? project.id ?? projectDir),
        repositoryId: '',
        aliases: uniqueStrings([project.id, project.name])
      });
    }
  }

  return projects;
}

export async function classifyRequest({ projectRoot, targetCwd, requestText }) {
  const normalizedRequest = normalizeText(requestText);
  if (!normalizedRequest) {
    return result('skip', 'missing-request');
  }

  const catalog = await loadXiguaProjectCatalog(projectRoot);
  const projectMatches = findProjectMatches(normalizedRequest, catalog);
  const pageEvidence = findPageEvidence(normalizedRequest);

  if (projectMatches.length !== 1) {
    return {
      ...result(
        'skip',
        projectMatches.length > 1 ? 'ambiguous-xigua-project' : 'no-unique-xigua-project'
      ),
      targetCwd,
      projectCandidates: projectMatches.map((match) => match.repositoryId || match.projectId),
      evidence: {
        projectMarkers: projectMatches.flatMap((match) => match.matchedAliases),
        pageMarkers: pageEvidence
      }
    };
  }

  const projectMatch = projectMatches[0];
  const isPageTask = pageEvidence.length > 0;
  if (!isPageTask) {
    return {
      ...result('skip', 'xigua-project-without-page-intent'),
      targetCwd,
      targetProject: projectMatch.projectId,
      projectCandidates: [projectMatch.repositoryId || projectMatch.projectId],
      evidence: {
        projectMarkers: projectMatch.matchedAliases,
        pageMarkers: []
      }
    };
  }

  return {
    ...result('route-required', 'explicit-xigua-project-page-task'),
    targetCwd,
    targetProject: projectMatch.projectId,
    projectCandidates: [projectMatch.repositoryId || projectMatch.projectId],
    evidence: {
      projectMarkers: projectMatch.matchedAliases,
      pageMarkers: pageEvidence
    }
  };
}

function findProjectMatches(request, catalog) {
  return catalog
    .map((entry) => ({
      ...entry,
      matchedAliases: entry.aliases.filter((alias) => containsAlias(request, alias))
    }))
    .filter((entry) => entry.matchedAliases.length > 0)
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) => candidate.projectId === entry.projectId && candidate.repositoryId === entry.repositoryId) === index
    );
}

function findPageEvidence(request) {
  const evidence = [
    ...findMarkers(request, PAGE_PHRASES),
    ...findMarkers(request, PAGE_NOUNS).filter((marker) =>
      PAGE_ACTIONS.some((action) => isNear(request, action, marker))
    )
  ];
  return [...new Set(evidence)];
}

function isNear(request, first, second) {
  const firstIndex = request.indexOf(first);
  const secondIndex = request.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0) return false;
  return Math.abs(firstIndex - secondIndex) <= 24;
}

function findMarkers(request, markers) {
  return markers.filter((marker) => containsAlias(request, marker));
}

function containsAlias(request, alias) {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (/^[a-z0-9][a-z0-9 _-]*$/i.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ _-]+/g, '[ _-]*');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(request);
  }
  return request.includes(normalizedAlias);
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map(normalizeText))];
}

function result(decision, reason) {
  return {
    decision,
    confidence: decision === 'route-required' ? 'high' : 'high',
    reason,
    targetProject: undefined,
    projectCandidates: [],
    evidence: {
      projectMarkers: [],
      pageMarkers: []
    }
  };
}
