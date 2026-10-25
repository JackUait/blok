import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { OutputBlockData, OutputData } from '../../../../types';
import type { HostService } from '../../../../types/tools/tool-description';

export type RunnerName = 'editor' | 'json' | 'store' | 'jint' | 'room' | 'mcp-stored' | 'mcp-live';
export type Expectation = 'ok' | { errorCode: string };
export type McpRunnerName = 'mcp-stored' | 'mcp-live';

/**
 * Why real blok-mcp cannot match the case. `against` compares the saved
 * document and answers with the json engine given only blok-mcp's host
 * services (none), since the golden needs one blok-mcp does not have.
 */
export type McpExemption =
  | { errorCode: string; reason: string }
  | { against: 'json-without-services'; reason: string };

type RunnerExpectations = Partial<Record<Exclude<RunnerName, McpRunnerName>, Expectation> & Record<McpRunnerName, McpExemption>>;

export interface CorpusCommand {
  name: string;
  args: Record<string, unknown>;
  ref?: string;
}

export interface CorpusBatch {
  commands: CorpusCommand[];
}

export interface ParityCase {
  name: string;
  seed: OutputData;
  batches: CorpusBatch[];
  expect?: Expectation;
  expectByRunner?: RunnerExpectations;
  /**
   * Fixed host services. Runners that cannot provide one declare it in expectByRunner.
   * The C# runners have none and skip the case (AgentParityCorpus.cs), so pair it with a case without services.
   */
  services?: CaseServices;
}

/** What a fake linkMetadata host returns for every URL. */
export type LinkPreview = Partial<Record<'title' | 'description' | 'image' | 'favicon' | 'domain', string>>;

export interface CaseServices {
  linkMetadata?: LinkPreview;
}

interface EvalFixture {
  id: string;
  seed: OutputData;
  reference: CorpusBatch[];
  referenceExpectByRunner?: RunnerExpectations;
  parityExcluded?: string;
}

export const CORPUS_ROOT: string = join(__dirname, '../../../fixtures/agent-commands');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isOutputBlock = (value: unknown): value is OutputBlockData =>
  isRecord(value) && typeof value.type === 'string' && isRecord(value.data)
  && [value.id, value.parent, value.lastEditedBy, value.createdBy]
    .every((field) => field === undefined || typeof field === 'string')
  && [value.indent, value.lastEditedAt, value.createdAt]
    .every((field) => field === undefined || typeof field === 'number')
  && (value.tunes === undefined || isRecord(value.tunes))
  && (value.content === undefined
    || (isArray(value.content) && value.content.every((id) => typeof id === 'string')));

export const isSeed = (value: unknown): value is OutputData =>
  isRecord(value) && isArray(value.blocks) && value.blocks.every(isOutputBlock)
  && [value.id, value.version, value.title]
    .every((field) => field === undefined || typeof field === 'string')
  && (value.time === undefined || typeof value.time === 'number')
  && (value.icon === undefined || (isRecord(value.icon)
    && ((value.icon.type === 'emoji' && typeof value.icon.value === 'string')
      || (value.icon.type === 'image' && typeof value.icon.url === 'string'))));

const isCommand = (value: unknown): value is CorpusCommand =>
  isRecord(value) && typeof value.name === 'string' && isRecord(value.args)
  && (value.ref === undefined || typeof value.ref === 'string');

const isBatches = (value: unknown): value is CorpusBatch[] =>
  isArray(value) && value.every((batch) =>
    isRecord(batch) && isArray(batch.commands) && batch.commands.every(isCommand));

const isExpectation = (value: unknown): value is Expectation =>
  value === 'ok' || (isRecord(value) && typeof value.errorCode === 'string');

const ENGINE_RUNNERS = new Set(['editor', 'json', 'store', 'jint', 'room']);
const MCP_RUNNERS = new Set(['mcp-stored', 'mcp-live']);

const hasReason = (value: Record<string, unknown>): boolean =>
  typeof value.reason === 'string' && value.reason.trim() !== '';

const isMcpExemption = (value: unknown): value is McpExemption =>
  isRecord(value) && hasReason(value) && Object.keys(value).length === 2
  && (typeof value.errorCode === 'string' || value.against === 'json-without-services');

const isRunnerExpectations = (value: unknown): value is RunnerExpectations =>
  isRecord(value) && Object.entries(value).every(([runner, expectation]) =>
    (ENGINE_RUNNERS.has(runner) && isExpectation(expectation))
    || (MCP_RUNNERS.has(runner) && isMcpExemption(expectation)));

const PREVIEW_KEYS = new Set(['title', 'description', 'image', 'favicon', 'domain']);

const isLinkPreview = (value: unknown): value is LinkPreview =>
  isRecord(value) && Object.entries(value).every(([key, item]) => PREVIEW_KEYS.has(key) && typeof item === 'string');

const isCaseServices = (value: unknown): value is CaseServices =>
  isRecord(value) && Object.keys(value).every((key) => key === 'linkMetadata')
  && (value.linkMetadata === undefined || isLinkPreview(value.linkMetadata));

const isParityCase = (value: unknown): value is ParityCase =>
  isRecord(value) && typeof value.name === 'string' && isSeed(value.seed)
  && isBatches(value.batches)
  && (value.expect === undefined || isExpectation(value.expect))
  && (value.expectByRunner === undefined || isRunnerExpectations(value.expectByRunner))
  && (value.services === undefined || isCaseServices(value.services));

const isEvalFixture = (value: unknown): value is EvalFixture =>
  isRecord(value) && typeof value.id === 'string' && isSeed(value.seed)
  && isBatches(value.reference)
  && (value.referenceExpectByRunner === undefined || isRunnerExpectations(value.referenceExpectByRunner))
  && (value.parityExcluded === undefined || typeof value.parityExcluded === 'string');

const readJsonDir = <T>(directory: string, validate: (value: unknown) => value is T): T[] => {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const path = join(directory, name);
    let value: unknown;

    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(`Invalid corpus fixture: ${path}`);
    }

    if (!validate(value)) {
      throw new Error(`Invalid corpus fixture: ${path}`);
    }

    return value;
  });
};

export const loadParityCases = (): ParityCase[] => [
  ...readJsonDir(join(CORPUS_ROOT, 'cases'), isParityCase),
  ...readJsonDir(join(CORPUS_ROOT, 'evals'), isEvalFixture)
    .filter((fixture) => fixture.parityExcluded === undefined).map((fixture) => ({
      name: `eval:${fixture.id}`,
      seed: fixture.seed,
      batches: fixture.reference,
      expectByRunner: fixture.referenceExpectByRunner,
    })),
];

export const mcpExemption = (c: ParityCase, runner: McpRunnerName): McpExemption | undefined =>
  c.expectByRunner?.[runner];

export const expectationFor = (c: ParityCase, runner: RunnerName): Expectation => {
  if (runner === 'mcp-stored' || runner === 'mcp-live') {
    const exemption = mcpExemption(c, runner);

    if (exemption !== undefined) {
      return 'errorCode' in exemption ? { errorCode: exemption.errorCode } : 'ok';
    }

    return c.expect ?? 'ok';
  }

  return c.expectByRunner?.[runner] ?? c.expect ?? 'ok';
};

export const goldenPath = (name: string): string =>
  join(CORPUS_ROOT, 'goldens', `${name.replace(/[^a-zA-Z0-9_-]/g, '__')}.json`);

const explicitIds = (value: unknown, ids: Set<string>): void => {
  if (isArray(value)) {
    value.forEach((item) => explicitIds(item, ids));

    return;
  }

  if (isRecord(value)) {
    if (typeof value.id === 'string') {
      ids.add(value.id);
    }

    explicitIds(value.children, ids);
  }
};

export const callerChosenIds = (c: ParityCase): Set<string> => {
  const ids = new Set<string>(c.seed.blocks.map((block) => block.id).filter((id): id is string => id !== undefined));

  c.batches.forEach((batch) => batch.commands.forEach((command) => {
    if (command.name === 'block.insert') {
      explicitIds(command.args, ids);
    }
  }));

  return ids;
};

export interface HostServices {
  /** For the contract: which services exist. */
  names: HostService[];
  /** For the session: the service objects. */
  impl: { linkMetadata?: { fetch(url: string): Promise<LinkPreview & { url: string }> } };
}

export const hostServicesFor = (c: ParityCase): HostServices => {
  const preview = c.services?.linkMetadata;

  return preview === undefined
    ? { names: [], impl: {} }
    : { names: ['linkMetadata'], impl: { linkMetadata: { fetch: async (url) => ({ url, ...preview }) } } };
};
