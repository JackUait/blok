import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'types', 'index.d.ts');
const CONSUMER = join(REPO_ROOT, 'types', 'agent-public-types.consumer.ts');

const PUBLIC_NAMES = [
  'Agent', 'AgentTurn', 'AgentToolsOptions', 'AgentAnthropicTool', 'AgentOpenAITool',
  'AgentToolName', 'AgentIdentity', 'AgentTurnOptions', 'AgentToolResult', 'AgentState',
];

const CONSUMER_SOURCE = `
import type {
  Agent, AgentTurn, AgentToolsOptions, AgentAnthropicTool, AgentOpenAITool,
  AgentToolName, AgentIdentity, AgentTurnOptions, AgentToolResult, AgentState,
  AgentActor, AgentSession, AgentBatch, AgentResult, ViewArgs, DocumentView,
  AgentContract, ContractSlice, CommandLogEntry, API, Blok,
} from '@bloklabs/core';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

export type IdentityMatchesActor = Assert<Equal<AgentIdentity, Omit<AgentActor, 'kind'>>>;
export type IdentityOmitsKind = Assert<Equal<Extract<'kind', keyof AgentIdentity>, never>>;
export type ToolNames = Assert<Equal<AgentToolName, 'blok_read' | 'blok_describe' | 'blok_execute'>>;
export type ToolsOptions = Assert<Equal<AgentToolsOptions, {
  format: 'anthropic' | 'openai';
  schema?: 'mixed' | 'envelope' | 'full';
  strict?: boolean;
}>>;
export type AnthropicShape = Assert<Equal<AgentAnthropicTool, {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}>>;
export type OpenAIShape = Assert<Equal<AgentOpenAITool, {
  type: 'function';
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}>>;
export type TurnOptions = Assert<Equal<AgentTurnOptions, {
  agent: AgentIdentity;
  follow?: boolean;
  attributeTo?: 'agent' | 'user';
}>>;
// Hand-built API objects (tool tests, mocks) need no agent member.
export type ApiAgentOptional = Assert<Equal<Pick<API, 'agent'>, { agent?: Agent }>>;
// A live editor always has it.
export type BlokAgentRequired = Assert<Equal<Pick<Blok, 'agent'>, { agent: Agent }>>;
export type ToolResult = Assert<Equal<AgentToolResult, { content: string; isError: boolean }>>;
export type State = Assert<Equal<AgentState,
  | { status: 'idle' }
  | { status: 'working'; turn: { id: string; agent: AgentIdentity } }
>>;
export type SessionInherited = Assert<Equal<Pick<AgentTurn, keyof AgentSession>, AgentSession>>;
export type TurnMethods = Assert<Equal<Pick<AgentTurn, 'signal' | 'call' | 'end' | 'stop'>, {
  readonly signal: AbortSignal;
  call(name: string, input: unknown): Promise<AgentToolResult>;
  end(): void;
  stop(): void;
}>>;
export type AgentMethods = Assert<Equal<Pick<Agent, 'tools' | 'state' | 'guidance' | 'begin' | 'subscribe'>, {
  tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  readonly state: AgentState;
  guidance(): Promise<string>;
  begin(options: AgentTurnOptions): AgentTurn;
  subscribe(listener: () => void): () => void;
}>>;

export async function consumeAgent(agent: Agent): Promise<void> {
  const identity: AgentIdentity = { id: 'assistant', name: 'Assistant' };
  const delegatedIdentity: AgentIdentity = {
    id: 'delegate', name: 'Delegate', onBehalfOf: 'user-1', color: '#888888',
  };
  const actor: AgentActor = { ...delegatedIdentity, kind: 'agent' };
  const options: AgentTurnOptions = { agent: identity, follow: true, attributeTo: 'agent' };
  const userOptions: AgentTurnOptions = { agent: delegatedIdentity, attributeTo: 'user' };
  const turn: AgentTurn = agent.begin(options);
  const session: AgentSession = turn;
  const id: string = session.id;
  const boundActor: AgentActor = session.actor;
  const signal: AbortSignal = turn.signal;
  const viewArgs: ViewArgs = { rootId: null, detail: 'full', limit: 10 };
  const defaultView: Promise<DocumentView> = turn.read();
  const detailedView: Promise<DocumentView> = turn.read(viewArgs);
  const description: AgentContract | ContractSlice = turn.describe();
  const toolDescription: AgentContract | ContractSlice = turn.describe({ tool: 'paragraph' });
  const commandDescription: AgentContract | ContractSlice = turn.describe({ command: 'doc.read' });
  const batch: AgentBatch = { commands: [{ name: 'doc.read', args: {} }] };
  const execution: Promise<AgentResult> = turn.execute(batch);
  const abortableExecution: Promise<AgentResult> = turn.execute(batch, { signal });
  const log: readonly CommandLogEntry[] = turn.log();
  const objectCall: Promise<AgentToolResult> = turn.call('blok_read', {});
  const jsonCall: Promise<AgentToolResult> = turn.call('blok_execute', JSON.stringify(batch));
  const unknownCall: Promise<AgentToolResult> = turn.call('unknown_tool', null);
  const guidance: Promise<string> = agent.guidance();
  const unsubscribe: () => void = agent.subscribe(() => {
    const state: AgentState = agent.state;

    if (state.status === 'working') {
      const activeId: string = state.turn.id;
      const activeIdentity: AgentIdentity = state.turn.agent;
    }
  });
  const anthropicOptions: AgentToolsOptions & { format: 'anthropic' } = {
    format: 'anthropic', schema: 'envelope', strict: false,
  };
  const openaiOptions: AgentToolsOptions & { format: 'openai' } = {
    format: 'openai', schema: 'full', strict: false,
  };
  const anthropic = await agent.tools(anthropicOptions);
  const openai = await agent.tools(openaiOptions);
  const defaultAnthropic = await agent.tools({ format: 'anthropic' });
  const defaultOpenAI = await agent.tools({ format: 'openai' });
  const anthropicIsExact: Assert<Equal<typeof anthropic, AgentAnthropicTool[]>> = true;
  const openaiIsExact: Assert<Equal<typeof openai, AgentOpenAITool[]>> = true;
  const defaultAnthropicIsExact: Assert<Equal<typeof defaultAnthropic, AgentAnthropicTool[]>> = true;
  const defaultOpenAIIsExact: Assert<Equal<typeof defaultOpenAI, AgentOpenAITool[]>> = true;

  for (const tool of anthropic) {
    const schema: Record<string, unknown> = tool.input_schema;
    const name: AgentToolName = tool.name;
    const strict: boolean | undefined = tool.strict;
  }

  for (const tool of openai) {
    const schema: Record<string, unknown> = tool.parameters;
    const type: 'function' = tool.type;
  }

  const result: AgentToolResult = await objectCall;
  const content: string = result.content;
  const isError: boolean = result.isError;
  const idle: AgentState = { status: 'idle' };
  const working: AgentState = { status: 'working', turn: { id, agent: identity } };

  unsubscribe();
  session.close();
  turn.end();
  turn.stop();
}
`;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: [],
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  paths: { '@bloklabs/core': [ ENTRY ] },
};

const baseHost = ts.createCompilerHost(COMPILER_OPTIONS);
const consumerHost: ts.CompilerHost = {
  ...baseHost,
  fileExists: (fileName) => fileName === CONSUMER || baseHost.fileExists(fileName),
  readFile: (fileName) => fileName === CONSUMER ? CONSUMER_SOURCE : baseHost.readFile(fileName),
  getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === CONSUMER
      ? ts.createSourceFile(fileName, CONSUMER_SOURCE, languageVersion, true)
      : baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
};

describe('editor.agent public types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const program = ts.createProgram([ ENTRY, CONSUMER ], COMPILER_OPTIONS, consumerHost);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(ENTRY);

  if (source === undefined) {
    throw new Error(`Could not load ${ENTRY}`);
  }

  const moduleSymbol = checker.getSymbolAtLocation(source);

  if (moduleSymbol === undefined) {
    throw new Error('types/index.d.ts is not a module');
  }

  const exported = checker.getExportsOfModule(moduleSymbol);
  const findExport = (name: string): ts.Symbol | undefined =>
    exported.find((symbol) => symbol.getName() === name);

  const requireExport = (name: string): ts.Symbol => {
    const symbol = findExport(name);

    if (symbol === undefined) {
      throw new Error(`types/index.d.ts does not export ${name}`);
    }

    return (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  it('exports every editor.agent type from the package entry', () => {
    const missing = PUBLIC_NAMES.filter((name) => findExport(name) === undefined);

    expect(missing, `Missing public agent exports: ${missing.join(', ')}`).toEqual([]);
  });

  it('AgentIdentity omits kind and keeps the actor identity fields', () => {
    const identity = checker.getDeclaredTypeOfSymbol(requireExport('AgentIdentity'));
    const names = checker.getPropertiesOfType(identity).map((symbol) => symbol.getName()).sort();

    expect(names).toEqual([ 'color', 'id', 'name', 'onBehalfOf' ]);
  });

  it('compiles typed consumer usage with no diagnostics', () => {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const formatted = ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => REPO_ROOT,
      getNewLine: () => '\n',
    });

    expect(diagnostics.length, formatted).toBe(0);
  });

  it('resolves the consumer without implementation source', () => {
    const implementationFiles = program.getSourceFiles()
      .filter((file) => !file.isDeclarationFile
        && file.fileName !== CONSUMER
        && !resolve(file.fileName).startsWith(join(REPO_ROOT, 'types') + sep))
      .map((file) => file.fileName);

    expect(implementationFiles).toEqual([]);
  });
});
