import type {
  Agent,
  AgentAnthropicTool,
  AgentAskOptions,
  AgentIdentity,
  AgentModelStreamEvent,
  AgentOpenAITool,
  AgentRun,
  AgentRunResult,
  AgentState,
  AgentThinkingLevel,
  AgentToolResult,
  AgentToolsOptions,
  AgentTurn,
  AgentTurnOptions,
} from '../../../../types/api';
import type { AgentApprovalRequest, AgentBatch, AgentResult, ChangedSet } from '../../../../types/agent';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { isThinkingLevel, readThinkingConfig, type ThinkingChoice } from '../../../agent/thinking';
import { AgentFailure } from '../../../shared/agent/errors';
import { nextEditorSessionId } from '../agent/session-id';
import { describeUserPlace, NOWHERE, type UserPlace } from './agent-place';
import type { DiscardOutcome } from './agent-run';
// Type only: the code loads on first use, so a bare editor never downloads it.
import type * as AgentCode from './agent-impl';

export type { UserPlace };

export class AgentTurnOpenError extends Error {
  public constructor() {
    super('An agent turn is already open. Call end() or stop() on it before begin().');
    this.name = 'AgentTurnOpenError';
  }
}

const IDLE: AgentState = { status: 'idle' };

/** What the prompt bar hears from its run. */
export interface AssistantRunHooks {
  /** 'thinking', or the tool the model calls and its input. */
  onActivity?(activity: string, input?: unknown): void;
  onStream?(event: AgentModelStreamEvent): void;
  onToolDone?(id: string, name: string, result: AgentToolResult): void;
  /** After each applied batch. */
  onExecuted?(changed: ChangedSet): void;
  onDiscarded?(outcome: DiscardOutcome): void;
  /** After the run writes another page: a sub-page's document, or its title or icon through a host hook. */
  onPageWritten?(): void;
  /** Ask the person to approve a change, such as unlocking a database. Resolve true only on their yes. */
  onApproval?(request: AgentApprovalRequest, signal: AbortSignal): Promise<boolean>;
}

/** Options only Blok's own assistant bar passes to begin(). */
export interface InternalTurnOptions {
  /** False: publish and follow, but draw no local caret, marker or pulse. */
  drawLocal: boolean;
  onExecuted?(changed: ChangedSet): void;
  onApproval?: AssistantRunHooks['onApproval'];
}

type Core = AgentCode.AgentCore;

/** A call made before the code loaded: run on the loaded turn or run, or fail with the load error. */
interface Pending<T> {
  run(target: T): void;
  fail(error: unknown): void;
}

const readIdentity = (agent: AgentIdentity | undefined): AgentIdentity => {
  if (typeof agent?.id !== 'string' || agent.id === '' || typeof agent.name !== 'string' || agent.name.trim() === '') {
    throw new TypeError('editor.agent.begin() needs agent.id and agent.name as non-empty strings.');
  }

  return { ...agent };
};

const stillLoading = (): Error =>
  new Error('editor.agent: the agent code is still loading. Await a call on this turn, such as read(), before describe().');

/**
 * The agent API. Its code (sessions, commands, tool definitions) loads on the
 * first call. Turns and runs begun before that queue their calls and replay
 * them in order once it lands.
 */
export class AgentAPI extends Module {
  private readonly current: { state: AgentState } = { state: IDLE };

  private readonly subscribers = new Set<() => void>();

  private core: Core | null = null;

  private loading: Promise<Core> | null = null;

  /** A turn or run begun before the code loaded, until it closes or the code takes it over. */
  private early: { id: string } | null = null;

  /** Turns closed before the code loaded. Their replay must not show as working again. */
  private readonly ghosts = new Set<string>();

  /** Called once the code loads, for callers that got null from inputIndexFor(). */
  private readonly onLoaded = new Set<() => void>();

  /** Signals of turns still waiting for the code. Destroy aborts them, as it stops a loaded turn. */
  private readonly waiting = new Set<AbortController>();

  private gone = false;

  constructor(options: ModuleConfig) {
    super(options);
    // Started at construction so the download overlaps the other modules' prepare().
    if (options.config.agent !== undefined) {
      this.load().catch(() => undefined);
    }
  }

  /**
   * With `agent` config, isReady waits for the code, so begin() is complete at once.
   * A failed chunk fails only the agent calls, never boot.
   */
  public async prepare(): Promise<void> {
    await this.loading?.catch(() => undefined);
  }

  /** The loaded agent code. A failed load is not kept, so the next call tries again. */
  public load(): Promise<Core> {
    if (this.core !== null) {
      return Promise.resolve(this.core);
    }
    if (this.loading !== null) {
      return this.loading;
    }

    const loading = import('./agent-impl').then((code) => {
      if (this.gone || this.isDestroyed) {
        throw new Error('editor.agent: the editor was destroyed.');
      }
      this.core ??= this.create(code);
      this.onLoaded.forEach((callback) => callback());
      this.onLoaded.clear();

      return this.core;
    });

    this.loading = loading;
    loading.catch(() => {
      if (this.loading === loading) {
        this.loading = null;
      }
    });

    return loading;
  }

  /**
   * Which input of a block edits `field`, or null. Null until the code loads;
   * the first such call starts the load and `loaded` runs once it lands.
   * @param blockId - the block
   * @param field - a data field of that block
   * @param loaded - redraw with the real answer
   */
  public inputIndexFor(blockId: string, field: string, loaded?: () => void): number | null {
    if (this.core !== null) {
      return this.core.inputIndexFor(blockId, field);
    }
    if (loaded !== undefined) {
      this.onLoaded.add(loaded);
    }
    this.load().catch(() => undefined);

    return null;
  }

  public get methods(): Agent {
    const readState = (): AgentState => this.current.state;

    return {
      tools: this.tools.bind(this),
      guidance: () => this.load().then((core) => core.guidance()),
      begin: (options: AgentTurnOptions) => this.begin(options),
      get state(): AgentState {
        return readState();
      },
      subscribe: (listener: () => void) => this.subscribe(listener),
      ask: (prompt: string, options?: AgentAskOptions) => this.ask(prompt, options),
      openAssistant: (options?: { prompt?: string }) => this.Blok.Assistant.open({ prompt: options?.prompt }),
    };
  }

  /** Whether `agent.assistant` is configured. */
  public get hasAssistant(): boolean {
    return typeof this.config.agent?.assistant?.model === 'function';
  }

  /** The host's thinking levels, or null. Throws TypeError on a bad config. */
  public thinkingChoice(): ThinkingChoice | null {
    return readThinkingConfig(this.config.agent?.assistant?.thinking);
  }

  /**
   * Where the user is: text for the model and the block ids it names. Read before focus leaves the document.
   */
  public describeUserPlace(): UserPlace {
    return describeUserPlace(this.Blok);
  }

  /**
   * Apply a batch in the open turn, without the model: its changes join the
   * run's, so Discard undoes them with the rest.
   * @param batch - the commands to apply
   */
  public executeInRun(batch: AgentBatch): Promise<AgentResult> {
    return this.core !== null ? this.core.executeInRun(batch) : this.load().then((core) => core.executeInRun(batch));
  }

  /**
   * Start an assistant run with editor context captured earlier.
   * @param prompt - the user's request
   * @param place - from describeUserPlace()
   * @param thinking - the bar's current pick, read at each prompt
   * @param hooks - the run's activity, stream, finished calls and applied batches
   */
  public startRun(
    prompt: string,
    place: UserPlace,
    thinking: () => AgentThinkingLevel | undefined,
    hooks: AssistantRunHooks = {}
  ): AgentRun {
    // The live preview stands in for the local caret and pulse. No follow: the page stays where the user left it.
    return this.ask(prompt, { context: false }, place, thinking, hooks, { drawLocal: false, onExecuted: hooks.onExecuted, onApproval: hooks.onApproval });
  }

  public destroy(): void {
    this.gone = true;
    this.core?.destroy();
    this.waiting.forEach((controller) => controller.abort());
    this.waiting.clear();
    this.subscribers.clear();
    this.onLoaded.clear();
  }

  private create(code: typeof AgentCode): Core {
    const core = new code.AgentCore({ config: this.config, eventsDispatcher: this.eventsDispatcher }, {
      opened: (id, agent) => this.opened(id, agent),
      closed: (id) => this.closed(id),
      isDestroyed: () => this.gone || this.isDestroyed,
    });

    core.state = this.Blok;

    return core;
  }

  private tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  private tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  private tools(options: AgentToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]> {
    return this.load().then((core) => core.tools(options));
  }

  private assertNoTurn(): void {
    if (this.early !== null || this.core?.hasOpenTurn === true) {
      throw new AgentTurnOpenError();
    }
  }

  private identityOf(agent: AgentIdentity | undefined): AgentIdentity {
    const given = readIdentity(agent);
    const userId = this.config.user?.id;

    // The person at this editor is who the agent acts for, unless the host named one.
    return given.onBehalfOf === undefined && typeof userId === 'string' && userId !== ''
      ? { ...given, onBehalfOf: userId }
      : given;
  }

  private begin(options: AgentTurnOptions, internal?: InternalTurnOptions): AgentTurn {
    this.assertNoTurn();

    const identity = this.identityOf(options?.agent);
    const id = nextEditorSessionId();

    if (this.core !== null) {
      return this.core.begin(identity, id, options, internal);
    }

    return this.earlyTurn(identity, id, (core) => core.begin(identity, id, options, internal));
  }

  private ask(
    prompt: string,
    options: AgentAskOptions = {},
    captured: UserPlace = NOWHERE,
    picked?: () => AgentThinkingLevel | undefined,
    hooks?: AssistantRunHooks,
    internal?: InternalTurnOptions
  ): AgentRun {
    const assistant = this.config.agent?.assistant;

    if (typeof assistant?.model !== 'function') {
      throw new TypeError('editor.agent.ask() needs agent.assistant.model in the editor config.');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new TypeError('editor.agent.ask() needs a non-empty prompt.');
    }
    if (options.thinking !== undefined && !isThinkingLevel(options.thinking)) {
      throw new TypeError(`editor.agent.ask() got an unknown thinking level: ${String(options.thinking)}.`);
    }

    const taken = (assistant.tools ?? []).find((tool) => tool.name.startsWith('blok_'));

    if (taken !== undefined) {
      throw new TypeError(`agent.assistant.tools: "${taken.name}" is taken. Names starting with blok_ belong to Blok.`);
    }
    this.assertNoTurn();

    const place = options.context === false ? captured : describeUserPlace(this.Blok);
    const agent = { id: 'blok-assistant', name: assistant.name?.trim() || 'AI' };
    const identity = this.identityOf(agent);
    const { YjsManager } = this.Blok;

    // Typing still pending would land above the base and look like a later user edit.
    YjsManager.flushPendingBlockWrites();
    const input: AgentCode.AskInput = {
      prompt,
      options,
      place,
      base: YjsManager.topUndoToken(),
      id: nextEditorSessionId(),
      agent,
      identity,
      picked,
      hooks,
      internal,
    };

    if (this.core !== null) {
      return this.core.ask(input);
    }

    return this.earlyRun(identity, input);
  }

  /**
   * Shows `working` at once and hands back the loaded turn or run to `attach`,
   * or the load error to `failed`.
   */
  private startEarly<T>(
    identity: AgentIdentity,
    id: string,
    open: (core: Core) => T,
    attach: (target: T) => void,
    failed: (error: unknown) => void
  ): { id: string } {
    const early = { id };

    this.early = early;
    this.setState({ status: 'working', turn: { id, agent: identity } });

    const release = (): void => {
      if (this.early === early) {
        this.early = null;
      }
    };

    this.load().then((core) => {
      const target = open(core);

      release();
      attach(target);
    }).catch((error: unknown) => {
      release();
      this.ghosts.delete(id);
      this.closed(id);
      failed(error);
    });

    return early;
  }

  /** Close an early turn or run in the facade: idle at once, and its replay stays hidden. */
  private closeEarly(early: { id: string }): void {
    if (this.early === early) {
      this.early = null;
    }
    this.closed(early.id);
    this.ghosts.add(early.id);
  }

  private earlyTurn(identity: AgentIdentity, id: string, open: (core: Core) => AgentTurn): AgentTurn {
    const controller = new AbortController();
    const queue: Pending<AgentTurn>[] = [];
    const box: { real: AgentTurn | null; closed: boolean } = { real: null, closed: false };

    this.waiting.add(controller);
    const early = this.startEarly(identity, id, open, (real) => {
      this.waiting.delete(controller);
      box.real = real;
      real.signal.addEventListener('abort', () => controller.abort(real.signal.reason), { once: true });
      queue.splice(0).forEach((pending) => pending.run(real));
    }, (error) => {
      this.waiting.delete(controller);
      box.closed = true;
      controller.abort(error);
      queue.splice(0).forEach((pending) => pending.fail(error));
    });

    const later = <R>(call: (turn: AgentTurn) => Promise<R>): Promise<R> => {
      if (box.real !== null) {
        return call(box.real);
      }

      return new Promise<R>((resolve, reject) => {
        queue.push({
          run: (turn) => {
            try {
              call(turn).then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          },
          fail: reject,
        });
      });
    };

    const close = (stop: boolean): void => {
      if (box.real !== null) {
        if (stop) {
          box.real.stop();
        } else {
          box.real.end();
        }

        return;
      }
      if (box.closed) {
        return;
      }
      box.closed = true;
      if (stop) {
        controller.abort();
      }
      this.closeEarly(early);
      queue.push({ run: (turn) => (stop ? turn.stop() : turn.end()), fail: () => undefined });
    };

    return {
      get id(): string {
        return box.real?.id ?? id;
      },
      get actor() {
        return box.real?.actor ?? { ...identity, kind: 'agent' as const };
      },
      signal: controller.signal,
      read: (args) => later((turn) => turn.read(args)),
      describe: (query) => {
        if (box.real !== null) {
          return box.real.describe(query);
        }
        if (box.closed) {
          throw new AgentFailure({ code: 'CANCELLED', message: 'This turn was stopped or ended. Nothing was applied.', retryable: false });
        }
        throw stillLoading();
      },
      execute: (batch) => later((turn) => turn.execute(batch)),
      log: () => box.real?.log() ?? [],
      call: (name, input) => later((turn) => turn.call(name, input)),
      close: () => close(false),
      end: () => close(false),
      stop: () => close(true),
    };
  }

  private earlyRun(identity: AgentIdentity, input: AgentCode.AskInput): AgentRun {
    const queue: Pending<AgentRun>[] = [];
    const box: { real: AgentRun | null; ended: boolean; first: (result: Promise<AgentRunResult> | AgentRunResult) => void } = {
      real: null,
      ended: false,
      first: () => undefined,
    };
    const first = new Promise<AgentRunResult>((resolve) => {
      box.first = resolve;
    });

    const early = this.startEarly(identity, input.id, (core) => core.ask(input), (real) => {
      box.real = real;
      box.first(real.result);
      queue.splice(0).forEach((pending) => pending.run(real));
    }, (error) => {
      box.first({ status: 'failed', reply: '', error: error instanceof Error ? error.message : String(error), changed: [] });
      queue.splice(0).forEach((pending) => pending.fail(error));
    });

    const queueCall = (run: (target: AgentRun) => void): void => {
      queue.push({ run, fail: () => undefined });
    };

    return {
      get result(): Promise<AgentRunResult> {
        return box.real?.result ?? first;
      },
      followUp: (prompt) => {
        if (box.real !== null) {
          return box.real.followUp(prompt);
        }
        if (box.ended) {
          throw new Error('editor.agent: this run has ended. Call editor.agent.ask() to start a new one.');
        }
        throw new Error('editor.agent: this run is still answering. Await `result` or call stop() first.');
      },
      stop: () => {
        if (box.real !== null) {
          box.real.stop();

          return;
        }
        queueCall((real) => real.stop());
      },
      discard: () => {
        if (box.real !== null) {
          return box.real.discard();
        }

        return new Promise<boolean>((resolve, reject) => {
          queue.push({ run: (real) => {
            real.discard().then(resolve, reject);
          }, fail: reject });
        });
      },
      end: () => {
        if (box.real !== null) {
          box.real.end();

          return;
        }
        if (box.ended) {
          return;
        }
        box.ended = true;
        this.closeEarly(early);
        queueCall((real) => real.end());
      },
    };
  }

  private opened(id: string, agent: AgentIdentity): void {
    const now = this.current.state;

    // A ghost's replay, or the early turn that already showed it.
    if (this.ghosts.has(id) || (now.status === 'working' && now.turn.id === id)) {
      return;
    }
    this.setState({ status: 'working', turn: { id, agent } });
  }

  private closed(id: string): void {
    if (this.ghosts.delete(id)) {
      return;
    }

    const now = this.current.state;

    if (now.status === 'working' && now.turn.id === id) {
      this.setState(IDLE);
    }
  }

  private subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);

    return () => {
      this.subscribers.delete(listener);
    };
  }

  private setState(next: AgentState): void {
    this.current.state = next;
    this.subscribers.forEach((listener) => listener());
  }
}

export default AgentAPI;
