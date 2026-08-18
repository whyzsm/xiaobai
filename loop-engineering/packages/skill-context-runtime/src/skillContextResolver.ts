import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AnySchema, ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import YAML from 'yaml';
import { canonicalizeJson } from '../../human-gate/src/subjectDigest';
import {
  BackgroundContextDocument,
  BackgroundContextPlan,
  JsonRecord,
  ResolvedBackgroundContext,
  SkillContextContract
} from '../../shared/src/types';

const execFileAsync = promisify(execFile);
const maximumEntryCharacters = 6_000;

interface SkillContextPolicy {
  contract: { path: string; version: string };
  entryPath: string;
  manifestPath: string;
  hashAlgorithm: string;
}

interface ExecutionMode {
  ownerAgent: string;
  ownerSkills: string[];
  [key: string]: unknown;
}

interface SkillManifest extends JsonRecord {
  name: string;
  version: string;
  orchestrator: string;
  skillContext: SkillContextPolicy;
  executionModes?: JsonRecord & {
    modes?: Record<string, ExecutionMode>;
  };
  evidenceBundles?: Record<string, EvidenceBundle>;
}

interface EvidenceBundle {
  skills?: string[];
  agents?: string[];
  references?: string[];
  schemas?: string[];
  templates?: string[];
  validators?: string[];
}

export class SkillContextResolver {
  constructor(private readonly workspaceRoot: string) {}

  async resolve(plan: BackgroundContextPlan): Promise<ResolvedBackgroundContext> {
    validatePlan(plan);
    const workspaceRoot = path.resolve(this.workspaceRoot);
    const declaredMount = path.resolve(workspaceRoot, plan.sourceMount);
    if (!containsPath(workspaceRoot, declaredMount)) {
      throw new Error('SKILL_CONTEXT_MOUNT_OUTSIDE_WORKSPACE: background mount must use the registered workspace mount');
    }

    const sourceRoot = await requireDirectoryRealPath(declaredMount, 'SKILL_CONTEXT_MOUNT_UNAVAILABLE');
    const manifestSource = await readSourceFile(sourceRoot, plan.manifestPath);
    const contractSource = await readSourceFile(sourceRoot, plan.contractPath);
    const manifest = parseManifest(manifestSource.content);
    const contractSchema = parseJsonSchema(contractSource.content, plan.contractPath);
    const policy = manifest.skillContext;

    if (
      resolveManifestContractPath(plan.manifestPath, policy.contract.path) !== plan.contractPath ||
      policy.contract.version !== plan.contractVersion
    ) {
      throw new Error('SKILL_CONTEXT_CONTRACT_MISMATCH: project declaration and manifest contract differ');
    }
    if (policy.manifestPath !== plan.manifestPath || policy.hashAlgorithm !== 'sha256') {
      throw new Error('SKILL_CONTEXT_MANIFEST_MISMATCH: source paths or hash algorithm differ from the project declaration');
    }

    const mode = plan.executionMode ? manifest.executionModes?.modes?.[plan.executionMode] : undefined;
    const evidenceSources = await readEvidenceBundleSources(sourceRoot, manifest, plan.evidenceBundles ?? []);
    const compatibilityMode: ExecutionMode = mode ?? {
      ownerAgent: manifest.orchestrator,
      ownerSkills: []
    };
    if (!mode && evidenceSources.length === 0) {
      throw new Error(`SKILL_CONTEXT_MODE_UNAVAILABLE: ${plan.executionMode ?? 'no evidence bundle'}`);
    }
    validateOwner(compatibilityMode);

    const entrySource = await readSourceFile(sourceRoot, policy.entryPath);
    const ownerAgentPath = compatibilityMode.ownerAgent === manifest.orchestrator
      ? policy.entryPath
      : `agents/${compatibilityMode.ownerAgent}/SKILL.md`;
    const ownerAgentSource = ownerAgentPath === policy.entryPath
      ? entrySource
      : await readSourceFile(sourceRoot, ownerAgentPath);
    const ownerSkillSources = await Promise.all(
      compatibilityMode.ownerSkills.map((skill) => readSourceFile(sourceRoot, `skills/${skill}/SKILL.md`))
    );
    const referencePaths = unique(ownerSkillSources.flatMap(declaredReferencePaths));
    const referenceSources = await Promise.all(referencePaths.map((referencePath) => readSourceFile(sourceRoot, referencePath)));

    const entryContent = selectRelevantMarkdown(
      entrySource.content,
      [plan.executionMode ?? '', compatibilityMode.ownerAgent, ...compatibilityMode.ownerSkills],
      maximumEntryCharacters
    );
    const manifestContent = selectManifestContent(manifest, plan.executionMode, compatibilityMode, plan.evidenceBundles ?? []);
    const documents = buildDocuments({
      entrySource,
      entryContent,
      manifestSource,
      manifestContent,
      ownerAgentSource,
      ownerAgentPath,
      ownerSkillSources,
      referenceSources,
      evidenceSources
    });
    const characters = documents.reduce((total, document) => total + document.content.length, 0);
    if (characters > plan.maxCharacters) {
      throw new Error(`SKILL_CONTEXT_BUDGET_EXCEEDED: ${characters} > ${plan.maxCharacters}`);
    }

    const skillContextWithoutDigest = {
      contractVersion: plan.contractVersion,
      skillId: manifest.orchestrator,
      skillCommit: await readGitCommit(sourceRoot),
      entryPath: policy.entryPath,
      entryHash: digest(entrySource.content),
      manifestPath: policy.manifestPath,
      manifestDigest: digest(manifestSource.content),
      executionMode: plan.executionMode ?? 'evidence-bundle',
      ownerAgent: compatibilityMode.ownerAgent,
      ownerSkills: [...compatibilityMode.ownerSkills],
      selectedReferences: referenceSources.map((reference) => ({
        id: referenceId(reference.path),
        path: reference.path,
        digest: digest(reference.content)
      })),
      ...(plan.evidenceBundles && plan.evidenceBundles.length > 0
        ? {
            contractDigest: digest(canonicalizeJson({
              evidenceBundles: plan.evidenceBundles,
              sources: evidenceSources.map((source) => ({ path: source.path, digest: digest(source.content) }))
            })),
            evidenceBundles: [...plan.evidenceBundles],
            sourceFiles: evidenceSources.map((source) => ({
              id: referenceId(source.path),
              path: source.path,
              digest: digest(source.content)
            }))
          }
        : {})
    };
    const contextDigest = digest(canonicalizeJson({
      skillContext: skillContextWithoutDigest,
      documents: documents.map(({ roles, path: sourcePath, sourceDigest, contentDigest, selection }) => ({
        roles,
        path: sourcePath,
        sourceDigest,
        contentDigest,
        selection
      }))
    }));
    const skillContext: SkillContextContract = { ...skillContextWithoutDigest, contextDigest };
    validateContract(contractSchema, skillContext, plan.contractPath);

    return {
      kind: 'skill-context',
      projectId: plan.projectId,
      backgroundId: plan.backgroundId,
      skillContext,
      documents,
      characters
    };
  }
}

interface SourceFile {
  path: string;
  content: string;
}

async function readSourceFile(sourceRoot: string, relativePath: string): Promise<SourceFile> {
  assertSafeRelativePath(relativePath);
  const declaredPath = path.resolve(sourceRoot, relativePath);
  const resolvedPath = await realpath(declaredPath).catch(() => {
    throw new Error(`SKILL_CONTEXT_SOURCE_MISSING: ${relativePath}`);
  });
  if (!containsPath(sourceRoot, resolvedPath)) {
    throw new Error(`SKILL_CONTEXT_SOURCE_OUTSIDE_BACKGROUND: ${relativePath}`);
  }
  const sourceStat = await stat(resolvedPath);
  if (!sourceStat.isFile()) throw new Error(`SKILL_CONTEXT_SOURCE_NOT_FILE: ${relativePath}`);
  return { path: relativePath, content: await readFile(resolvedPath, 'utf8') };
}

async function requireDirectoryRealPath(directory: string, code: string): Promise<string> {
  const resolved = await realpath(directory).catch(() => {
    throw new Error(`${code}: ${directory}`);
  });
  if (!(await stat(resolved)).isDirectory()) throw new Error(`${code}: ${directory}`);
  return resolved;
}

function parseManifest(content: string): SkillManifest {
  const value = YAML.parse(content) as unknown;
  if (!isRecord(value)) throw new Error('SKILL_CONTEXT_MANIFEST_INVALID: manifest must be an object');
  const skillContext = value.skillContext;
  const executionModes = value.executionModes;
  const evidenceBundles = value.evidenceBundles;
  if (
    typeof value.name !== 'string' ||
    typeof value.version !== 'string' ||
    typeof value.orchestrator !== 'string' ||
    !isSkillContextPolicy(skillContext) ||
    (!isRecord(executionModes) || !isExecutionModeRecord(executionModes.modes)) &&
    !isEvidenceBundleRecord(evidenceBundles)
  ) {
    throw new Error('SKILL_CONTEXT_MANIFEST_INVALID: required routing fields are missing');
  }
  return value as SkillManifest;
}

function parseJsonSchema(content: string, sourcePath: string): AnySchema {
  try {
    const value = JSON.parse(content) as unknown;
    if (!isRecord(value)) throw new Error('schema must be an object');
    return value as AnySchema;
  } catch (error) {
    throw new Error(`SKILL_CONTEXT_CONTRACT_INVALID: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateContract(schema: AnySchema, context: SkillContextContract, sourcePath: string): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    throw new Error(`SKILL_CONTEXT_CONTRACT_INVALID: ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!validate(context)) {
    throw new Error(`SKILL_CONTEXT_VALIDATION_FAILED: ${formatAjvErrors(validate.errors).join('; ')}`);
  }
}

function buildDocuments(input: {
  entrySource: SourceFile;
  entryContent: string;
  manifestSource: SourceFile;
  manifestContent: string;
  ownerAgentSource: SourceFile;
  ownerAgentPath: string;
  ownerSkillSources: SourceFile[];
  referenceSources: SourceFile[];
  evidenceSources: SourceFile[];
}): BackgroundContextDocument[] {
  const documents: BackgroundContextDocument[] = [
    document(
      input.entrySource,
      input.entryContent,
      input.ownerAgentPath === input.entrySource.path ? ['entry', 'owner-agent'] : ['entry'],
      input.entryContent === input.entrySource.content ? 'full' : 'relevant-sections'
    ),
    document(input.manifestSource, input.manifestContent, ['manifest'], 'selected-manifest')
  ];
  if (input.ownerAgentPath !== input.entrySource.path) {
    documents.push(document(input.ownerAgentSource, input.ownerAgentSource.content, ['owner-agent'], 'full'));
  }
  for (const ownerSkillSource of input.ownerSkillSources) {
    documents.push(document(ownerSkillSource, ownerSkillSource.content, ['owner-skill'], 'full'));
  }
  for (const referenceSource of input.referenceSources) {
    documents.push(document(referenceSource, referenceSource.content, ['reference'], 'full'));
  }
  for (const evidenceSource of input.evidenceSources) {
    documents.push(document(evidenceSource, evidenceSource.content, ['evidence'], 'evidence-bundle'));
  }
  return documents;
}

function document(
  source: SourceFile,
  content: string,
  roles: BackgroundContextDocument['roles'],
  selection: BackgroundContextDocument['selection']
): BackgroundContextDocument {
  return {
    roles,
    path: source.path,
    sourceDigest: digest(source.content),
    contentDigest: digest(content),
    selection,
    content
  };
}

function selectManifestContent(
  manifest: SkillManifest,
  executionMode: string | undefined,
  mode: ExecutionMode,
  evidenceBundles: string[]
): string {
  const selection: JsonRecord = {
    name: manifest.name,
    version: manifest.version,
    mode: manifest.mode,
    activation: manifest.activation,
    contractResolution: manifest.contractResolution,
    skillContext: manifest.skillContext,
    orchestrator: manifest.orchestrator,
    architecture: manifest.architecture,
    ...(manifest.executionModes
      ? {
          executionModes: {
            defaultMode: manifest.executionModes.defaultMode,
            fullWorkflowTrigger: manifest.executionModes.fullWorkflowTrigger,
            testTrigger: manifest.executionModes.testTrigger,
            buildTrigger: manifest.executionModes.buildTrigger,
            selfCheckScope: manifest.executionModes.selfCheckScope,
            selfCheckCannotClaim: manifest.executionModes.selfCheckCannotClaim,
            ...(executionMode ? { modes: { [executionMode]: mode } } : {})
          }
        }
      : {}),
    ...(manifest.evidenceBundles && evidenceBundles.length > 0
      ? { evidenceBundles: Object.fromEntries(evidenceBundles.map((id) => [id, manifest.evidenceBundles?.[id]])) }
      : {})
  };
  if (executionMode === 'FullWorkflow' && manifest.stages) {
    selection.stageOrder = manifest.stageOrder;
    selection.stages = manifest.stages;
  }
  return YAML.stringify(selection);
}

async function readEvidenceBundleSources(
  sourceRoot: string,
  manifest: SkillManifest,
  bundleIds: string[]
): Promise<SourceFile[]> {
  if (bundleIds.length === 0) return [];
  if (!manifest.evidenceBundles) throw new Error('XIAONENG_EVIDENCE_BUNDLE_UNAVAILABLE: manifest has no evidence bundles');
  const paths: string[] = [];
  for (const bundleId of bundleIds) {
    const bundle = manifest.evidenceBundles[bundleId];
    if (!bundle) throw new Error(`XIAONENG_EVIDENCE_BUNDLE_UNAVAILABLE: ${bundleId}`);
    for (const skill of bundle.skills ?? []) paths.push(`skills/${skill}/SKILL.md`);
    for (const agent of bundle.agents ?? []) paths.push(`agents/${agent}/SKILL.md`);
    for (const sourcePath of [
      ...(bundle.references ?? []),
      ...(bundle.schemas ?? []),
      ...(bundle.templates ?? []),
      ...(bundle.validators ?? [])
    ]) paths.push(sourcePath);
  }
  return Promise.all(unique(paths).map((sourcePath) => readSourceFile(sourceRoot, sourcePath)));
}

function selectRelevantMarkdown(content: string, needles: string[], maxCharacters: number): string {
  if (content.length <= maxCharacters) return content;
  const lines = content.split(/(?<=\n)/);
  const sections: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{2,3}\s/.test(line) && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current);

  const selected = new Set<number>([0, 1]);
  sections.forEach((section, index) => {
    const sectionText = section.join('');
    if (needles.some((needle) => sectionText.includes(needle))) selected.add(index);
  });

  let result = '';
  for (const [index, section] of sections.entries()) {
    if (!selected.has(index)) continue;
    for (const line of section) {
      if (result.length + line.length > maxCharacters) return result.trimEnd() + '\n';
      result += line;
    }
  }
  return result.trimEnd() + '\n';
}

function declaredReferencePaths(source: SourceFile): string[] {
  const references: string[] = [];
  let inReferences = false;
  for (const line of source.content.split('\n')) {
    if (/^##\s+References\s*$/i.test(line.trim())) {
      inReferences = true;
      continue;
    }
    if (inReferences && /^##\s+/.test(line)) break;
    if (!inReferences) continue;
    const match = line.match(/^\s*-\s+`([^`]+)`\s*$/);
    if (!match) continue;
    const referencePath = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), match[1]));
    assertSafeRelativePath(referencePath);
    references.push(referencePath);
  }
  return references;
}

function resolveManifestContractPath(manifestPath: string, contractPath: string): string {
  assertSafeRelativePath(contractPath);
  const harnessRoot = path.posix.dirname(path.posix.dirname(manifestPath));
  const resolved = path.posix.normalize(path.posix.join(harnessRoot, contractPath));
  assertSafeRelativePath(resolved);
  return resolved;
}

function referenceId(referencePath: string): string {
  return referencePath
    .replace(/^skills\//, '')
    .replace('/references/', ':')
    .replace(/\.md$/i, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function readGitCommit(sourceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    const commit = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`unexpected revision: ${commit}`);
    return commit;
  } catch (error) {
    throw new Error(`SKILL_CONTEXT_GIT_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validatePlan(plan: BackgroundContextPlan): void {
  if (
    plan.status !== 'planned' ||
    plan.kind !== 'skill-context' ||
    !['1.0.0', '2.0.0'].includes(plan.contractVersion) ||
    !plan.projectId ||
    !plan.backgroundId ||
    (!plan.executionMode && (!plan.evidenceBundles || plan.evidenceBundles.length === 0)) ||
    !Number.isInteger(plan.maxCharacters) ||
    plan.maxCharacters <= 0
  ) {
    throw new Error('SKILL_CONTEXT_PLAN_INVALID: required fields are missing');
  }
  assertSafeRelativePath(plan.sourceMount);
  assertSafeRelativePath(plan.manifestPath);
  assertSafeRelativePath(plan.contractPath);
  if (plan.evidenceBundles && !plan.evidenceBundles.every(isIdentifier)) {
    throw new Error('SKILL_CONTEXT_EVIDENCE_BUNDLE_INVALID: bundle identifiers must be kebab-case');
  }
}

function validateOwner(mode: ExecutionMode): void {
  if (!isIdentifier(mode.ownerAgent) || !Array.isArray(mode.ownerSkills) || !mode.ownerSkills.every(isIdentifier)) {
    throw new Error('SKILL_CONTEXT_OWNER_INVALID: owner agent and skills must be declared identifiers');
  }
}

function isSkillContextPolicy(value: unknown): value is SkillContextPolicy {
  if (!isRecord(value) || !isRecord(value.contract)) return false;
  return (
    typeof value.contract.path === 'string' &&
    typeof value.contract.version === 'string' &&
    typeof value.entryPath === 'string' &&
    typeof value.manifestPath === 'string' &&
    typeof value.hashAlgorithm === 'string'
  );
}

function isExecutionModeRecord(value: unknown): value is Record<string, ExecutionMode> {
  return isRecord(value) && Object.values(value).every((mode) => isRecord(mode));
}

function isEvidenceBundleRecord(value: unknown): value is Record<string, EvidenceBundle> {
  return isRecord(value) && Object.values(value).every((bundle) => isRecord(bundle));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function assertSafeRelativePath(value: string): void {
  if (!value || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error(`SKILL_CONTEXT_PATH_INVALID: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`SKILL_CONTEXT_PATH_INVALID: ${value}`);
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid value'}`);
}
