import type {
  Agent,
  AgentAnthropicTool,
  AgentAskOptions,
  AgentRun,
  AgentIdentity,
  AgentModelStreamEvent,
  AgentOpenAITool,
  AgentState,
  AgentThinkingLevel,
  AgentToolResult,
  AgentToolsOptions,
  AgentTurn,
  AgentTurnOptions,
} from '../../../../types/api';
import type { OutputData } from '../../../../types';
import type { AgentActor, AgentBatch, AgentResult, AgentSession, ChangedSet } from '../../../../types/agent';
import type { HostService } from '../../../../types/tools/tool-description';
import { Module } from '../../__module';
import { announce } from '../../utils/announcer';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { createEditorAgentSession, liveContractSource, type ContractSource } from '../agent/editor-session';
import { inputIndexForField } from '../collaboration/agent-placement';
import { composeFirstMessage } from '../../../agent/first-message';
import { isThinkingLevel, readThinkingConfig, type ThinkingChoice } from '../../../agent/thinking';

import { createAgentPresence, type AgentPresence } from './agent-presence';

import { deepEqual } from '../../../shared/deep-equal';
import { createEditorServices, type HostPageWrite } from './agent-services';
import { createPageDocuments, type PageDocuments } from '../agent/page-documents';
import { isBlockReadOnly } from '../../utils/read-only-blocks';
import type { Block } from '../../block';
import { AgentFailure, failure } from '../../../shared/agent/errors';
import { createAgentRun, type DiscardOutcome, type PageRestore } from './agent-run';
import { createAgentTurn } from './agent-turn';
import { askAiSessionOptions } from './agent-session-options';

export class AgentTurnOpenError extends Error {
  public constructor() {
    super('An agent turn is already open. Call end() or stop() on it before begin().');
    this.name = 'AgentTurnOpenError';
  }
}

const IDLE: AgentState = { status: 'idle' };

const DEFAULT_MAX_STEPS = 100;

/** Where the user is: the text for the model and the blocks it names. */
export interface UserPlace {
  text: string;
  blockIds: string[];
}

const NOWHERE: UserPlace = { text: '', blockIds: [] };

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
}

interface TurnPage {
  /** The page before the turn's first save. */
  original: OutputData;
  /** What the agent saved last. */
  saved?: OutputData;
  /** Someone wrote the page between two agent saves. */
  kept: boolean;
}

/** Options only Blok's own assistant bar passes to begin(). */
interface InternalTurnOptions {
  /** False: publish and follow, but draw no local caret, marker or pulse. */
  drawLocal: boolean;
  onExecuted?(changed: ChangedSet): void;
}

type ToolsOptions = AgentToolsOptions;

const readIdentity = (agent: AgentIdentity | undefined): AgentIdentity => {
  if (typeof agent?.id !== 'string' || agent.id === '' || typeof agent.name !== 'string' || agent.name.trim() === '') {
    throw new TypeError('editor.agent.begin() needs agent.id and agent.name as non-empty strings.');
  }

  return { ...agent };
};

export class AgentAPI extends Module {
  private readonly current: { state: AgentState; turn: AgentTurn | null } = { state: IDLE, turn: null };

  private readonly subscribers = new Set<() => void>();

  private serviceCache: Partial<Record<HostService, unknown>> | null = null;
  /** Undefined until first asked; null when no page tool has loadDocument and saveDocument. */
  private pageDocs: PageDocuments | null | undefined;
  /** Each sub-page the open turn saved. Discard writes `original` back unless someone else changed the page. */
  private turnPages = new Map<string, TurnPage>();
  /** Each page title or icon the open turn wrote through a host hook, by `pageId field`: the first write and the last. */
  private turnHostWrites = new Map<string, { first: HostPageWrite; last: HostPageWrite }>();
  /** The open run's onPageWritten. */
  private turnPageWritten: (() => void) | undefined;
  /** PageIds an agent left on a page block. Kept across turns: such an id could name any document. */
  private readonly agentPageIds = new Set<string>();
  /** PageIds the host's create gave. Trusted though the agent's insert writes them too. */
  private readonly hostPageIds = new Set<string>();
  /** Page block id → pageId when the turn began, leaving out ids an agent wrote. */
  private startPageIds = new Map<string, string>();
  /** Who page writes are stamped with: the open turn's agent. */
  private actor: AgentActor = { id: 'agent', name: 'Agent', kind: 'agent' };

  private contractSource: ContractSource | null = null;

  /** The open turn's session, for Discard to join its steps. */
  private turnSession: { sealSteps(): void } | null = null;

  private presenceLayer: AgentPresence | null = null;

  /** What the open turn changed, for one screen reader summary when it closes. */
  private turnLog = { agentName: '', changed: new Set<string>() };

  /**
   * Which input of a block edits `field`, or null.
   * @param blockId - the block
   * @param field - a data field of that block
   */
  public inputIndexFor(blockId: string, field: string): number | null {
    const type = this.Blok.BlockManager.getBlockById(blockId)?.name;

    if (type === undefined) {
      return null;
    }

    return inputIndexForField(field, this.source().contract().manifest.blocks.find((entry) => entry.name === type));
  }

  public get methods(): Agent {
    const readState = (): AgentState => this.current.state;

    return {
      tools: this.tools.bind(this),
      guidance: () => this.guidance(),
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
    return this.editorContext();
  }

  /**
   * Apply a batch in the open turn, without the model: its changes join the
   * run's, so Discard undoes them with the rest.
   * @param batch - the commands to apply
   */
  public executeInRun(batch: AgentBatch): Promise<AgentResult> {
    const turn = this.current.turn;

    if (turn === null) {
      return Promise.reject(new Error('No agent turn is open.'));
    }

    return turn.execute(batch);
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
    return this.ask(prompt, { context: false }, place, thinking, hooks, { drawLocal: false, onExecuted: hooks.onExecuted });
  }

  private ask(
    prompt: string,
    options: AgentAskOptions = {},
    captured: UserPlace = NOWHERE,
    picked: () => AgentThinkingLevel | undefined = () => undefined,
    hooks: AssistantRunHooks = {},
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

    const hostTools = assistant.tools ?? [];
    const taken = hostTools.find((tool) => tool.name.startsWith('blok_'));

    if (taken !== undefined) {
      throw new TypeError(`agent.assistant.tools: "${taken.name}" is taken. Names starting with blok_ belong to Blok.`);
    }

    const choice = this.thinkingChoice();
    const thinking = (): AgentThinkingLevel | undefined => options.thinking ?? picked() ?? choice?.initial;

    const place = options.context === false ? captured : this.editorContext();
    const name = assistant.name?.trim() || 'AI';
    const agent = { id: 'blok-assistant', name };
    const { YjsManager } = this.Blok;

    // Typing still pending would land above the base and look like a later user edit.
    YjsManager.flushPendingBlockWrites();
    const base = YjsManager.topUndoToken();
    const turn = this.begin({ agent }, internal);
    const pagesSaved = this.turnPages;
    const hostWrites = this.turnHostWrites;

    this.turnPageWritten = hooks.onPageWritten;
    const session = this.turnSession;

    return createAgentRun(composeFirstMessage(prompt, place.text, turn.read, place.blockIds), {
      turn,
      model: assistant.model,
      maxSteps: assistant.maxSteps ?? DEFAULT_MAX_STEPS,
      thinking,
      hostTools,
      prepare: async () => {
        const [tools, system] = await Promise.all([this.tools({ format: 'anthropic', schema: 'mixed' }), this.guidance()]);
        const offered = hostTools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

        return { tools: [...tools, ...offered], system };
      },
      changed: () => [...this.turnLog.changed],
      restorePages: () => this.restorePages(pagesSaved, hostWrites),
      sealSteps: () => session?.sealSteps(),
      undoneAll: () => {
        YjsManager.flushPendingBlockWrites();

        return YjsManager.topUndoToken() === base;
      },
      onDiscarded: hooks.onDiscarded,
      onActivity: hooks.onActivity,
      onStream: hooks.onStream,
      onToolDone: hooks.onToolDone,
    });
  }

  /**
   * Where the user is, for the first message. The document view never carries
   * the selection, so it travels as text.
   */
  private editorContext(): UserPlace {
    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;

    // A block selection leaves no native range, or a stray one.
    if (selectedBlocks.length > 0) {
      const ids = selectedBlocks.map((block) => block.id);

      return {
        text: `(Editor context: the user selected whole blocks ${ids.join(', ')}. "This" in the request means those blocks.)`,
        blockIds: ids,
      };
    }

    const quotes = new Map<string, string[]>();

    // An empty share is a triple-click's end at the start of the next block.
    this.Blok.CrossBlockSelection.textSelection?.subRanges
      .map(({ block, range }) => ({ id: block.id, text: range.toString() }))
      .filter(({ text }) => text !== '')
      .forEach(({ id, text }) => quotes.set(id, [...quotes.get(id) ?? [], text]));

    if (quotes.size > 1) {
      const ids = [...quotes.keys()];
      const quoted = [...quotes].map(([id, parts]) => `In block ${id}: ${JSON.stringify(parts.join('\n'))}.`).join(' ');

      return {
        text: `(Editor context: the user selected text across blocks ${ids.join(', ')}. ${quoted} "This" in the request means that text.)`,
        blockIds: ids,
      };
    }

    const selection = document.getSelection();
    const anchor = selection?.anchorNode ?? null;

    if (selection === null || anchor === null || !this.Blok.UI.nodes.wrapper.contains(anchor)) {
      return NOWHERE;
    }

    const block = this.Blok.BlockManager.getBlockByChildNode(anchor);

    if (block === undefined) {
      return NOWHERE;
    }

    const selected = selection.isCollapsed ? '' : selection.toString();
    const text = selected === ''
      ? `(Editor context: the user's caret is in block ${block.id}.) Write new content right after this block unless the request names another place.`
      : `(Editor context: the user selected this text in block ${block.id}: ${JSON.stringify(selected)}. "This" in the request means that text.)`;

    return { text, blockIds: [block.id] };
  }

  public destroy(): void {
    this.current.turn?.stop();
    this.subscribers.clear();
  }

  private services(): Partial<Record<HostService, unknown>> {
    this.serviceCache ??= createEditorServices(this.Blok, this.config, () => this.actor, this.pages(), (write) => {
      const key = `${write.pageId} ${write.field}`;
      const seen = this.turnHostWrites.get(key);

      this.turnHostWrites.set(key, { first: seen?.first ?? write, last: write });
      this.turnPageWritten?.();
    });

    return this.serviceCache;
  }

  private source(): ContractSource {
    // Keep tool definitions and every session on the same live source.
    this.contractSource ??= liveContractSource(this.Blok, {
      services: Object.keys(this.services()).filter((name): name is HostService =>
        name === 'uploader' || name === 'linkMetadata' || name === 'pageBackend'
      ),
      overrides: this.config.agent?.overrides,
    });

    return this.contractSource;
  }

  private presence(): AgentPresence {
    this.presenceLayer ??= createAgentPresence({
      host: this.Blok.UI.nodes.wrapper,
      resolveHolder: (id) => this.Blok.BlockManager.getBlockById(id)?.holder ?? null,
      resolveInputs: (id) => this.Blok.BlockManager.getBlockById(id)?.inputs ?? [],
      inputIndexFor: (id, field) => this.inputIndexFor(id, field),
      isHidden: () => this.Blok.ReadOnly.isControlsHidden,
      publish: (cursor) => this.Blok.YjsManager.setAwarenessField('agentCursor', cursor),
      // Only the scroll half of BlocksAPI.scrollToBlock: its per-call announce
      // and pulse would flood a screen reader once per batch.
      scrollTo: (id) => {
        const holder = this.Blok.BlockManager.getBlockById(id)?.holder;

        if (holder === undefined) {
          return;
        }

        const top = holder.getBoundingClientRect().top + window.scrollY - (this.config.scrollToBlock?.topOffset ?? 0);

        window.scrollTo({ top, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
      },
    });

    return this.presenceLayer;
  }

  private tools(options: ToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  private tools(options: ToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  private async tools(options: ToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]> {
    const { renderAgentTools } = await import('../../../agent/render-tools');
    const tools = renderAgentTools(this.source().contract(), { ...options, schema: options.schema ?? 'mixed', pages: this.pages() !== null });

    return options.format === 'anthropic'
      ? tools.filter((tool): tool is AgentAnthropicTool => 'input_schema' in tool)
      : tools.filter((tool): tool is AgentOpenAITool => 'parameters' in tool);
  }

  private async guidance(): Promise<string> {
    const { composeGuidance } = await import('../../../agent/guidance');

    return composeGuidance(this.source().contract(), { pages: this.pages() !== null });
  }

  private pages(): PageDocuments | null {
    if (this.pageDocs === undefined) {
      this.pageDocs = createPageDocuments(this.Blok, this.config.documentId, {
        beforeSave: (pageId, loaded) => {
          const page = this.turnPages.get(pageId);

          if (page === undefined) {
            this.turnPages.set(pageId, { original: loaded, kept: false });

            return;
          }
          // Someone wrote the page between two agent saves: this save carries their edit.
          if (page.saved === undefined || this.pageDocs?.same(loaded, page.saved) !== true) {
            page.kept = true;
          }
        },
        saved: (pageId, saved) => {
          const page = this.turnPages.get(pageId);

          if (page !== undefined) {
            page.saved = saved;
          }
          this.turnPageWritten?.();
        },
        contractSource: () => this.source(),
        services: () => this.services(),
        onPagePointed: (pageId) => this.agentPageIds.add(pageId),
        isAgentPageId: (pageId) => this.agentPageIds.has(pageId),
      });
    }

    return this.pageDocs;
  }

  /**
   * Writes back each sub-page a turn saved, and calls the host's rename and
   * setIcon hooks again with the old value. A page someone changed after the
   * agent's last write is kept as it is, so their edit survives. A write that
   * cannot be reverted is kept too.
   */
  private async restorePages(
    pages: Map<string, TurnPage>,
    hostWrites: Map<string, { first: HostPageWrite; last: HostPageWrite }>
  ): Promise<PageRestore> {
    const docs = this.pages();
    const outcome: PageRestore = { restored: 0, kept: [] };
    const keep = (pageId: string): void => {
      if (!outcome.kept.includes(pageId)) {
        outcome.kept.push(pageId);
      }
    };
    const restoreDocument = async (pageId: string, page: TurnPage): Promise<boolean> => {
      if (docs === null || page.kept || page.saved === undefined) {
        return false;
      }
      const current = await docs.load(pageId);

      if (current === null || !docs.same(current, page.saved)) {
        return false;
      }
      await docs.save(pageId, page.original);

      return true;
    };
    const revertHostWrite = async ({ first, last }: { first: HostPageWrite; last: HostPageWrite }): Promise<boolean> => {
      const current = await last.current();

      if (first.before === undefined || current === undefined) {
        return false;
      }
      const now = last.field === 'title' ? current.title ?? '' : current.icon ?? null;

      if (!deepEqual(now, last.written)) {
        return false;
      }
      await first.revert();

      return true;
    };
    const attempt = async (pageId: string, run: () => Promise<boolean>): Promise<void> => {
      const reverted = await run().catch(() => false);

      if (reverted) {
        outcome.restored += 1;
      } else {
        keep(pageId);
      }
    };

    await Promise.all([
      ...[...pages].map(([pageId, page]) => attempt(pageId, () => restoreDocument(pageId, page))),
      ...[...hostWrites.values()].map((write) => attempt(write.last.pageId, () => revertHostWrite(write))),
    ]);
    pages.clear();
    hostWrites.clear();

    return outcome;
  }

  /** The sub-page document a page block in this document points at. */
  private async openPage(blockId: string, actor: AgentActor): Promise<AgentSession & { close(): void }> {
    const docs = this.pages();
    const block = this.Blok.BlockManager.getBlockById(blockId);

    if (docs === null) {
      throw new AgentFailure({ code: 'COMMAND_UNAVAILABLE', message: 'This editor cannot open sub-page documents. Omit `page`.', retryable: false, path: '/page' });
    }
    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `No block "${blockId}".`, { details: { blockId } });
    }
    const pageId = block.preservedData.pageId;

    if (block.name !== 'page' || typeof pageId !== 'string') {
      throw failure('INVALID_ARGS', `Block "${blockId}" is not a page block with a pageId.`, { path: '/page', details: { blockId } });
    }
    // Allowed: the id the block had before the turn, or one the host's create gave.
    if (this.startPageIds.get(blockId) !== pageId && !this.hostPageIds.has(pageId)) {
      throw failure('INVALID_ARGS', `Block "${blockId}" points at a page an agent set, not one the host created. It cannot be opened.`, { path: '/page', details: { blockId } });
    }
    const session = await docs.open(pageId, actor, { created: this.hostPageIds.has(pageId) });
    const getById = (id: string): Block | undefined => this.Blok.BlockManager.getBlockById(id);

    return {
      ...session,
      execute: (batch, options) => (isBlockReadOnly(block, getById)
        ? Promise.reject(failure('READ_ONLY', `Page block "${blockId}" is read-only.`, { details: { blockId } }))
        : session.execute(batch, options)),
    };
  }

  private begin(options: AgentTurnOptions, internal: InternalTurnOptions = { drawLocal: true }): AgentTurn {
    if (this.current.turn !== null) {
      throw new AgentTurnOpenError();
    }

    const given = readIdentity(options?.agent);
    const userId = this.config.user?.id;
    // The person at this editor is who the agent acts for, unless the host named one.
    const identity: AgentIdentity = given.onBehalfOf === undefined && typeof userId === 'string' && userId !== ''
      ? { ...given, onBehalfOf: userId }
      : given;

    this.actor = { ...identity, kind: 'agent' };
    this.turnPages = new Map();
    this.turnHostWrites = new Map();
    this.turnPageWritten = undefined;
    this.startPageIds = new Map();
    for (const block of this.Blok.BlockManager.blocks) {
      const pageId = block.name === 'page' ? block.preservedData.pageId : undefined;

      if (typeof pageId === 'string' && !this.agentPageIds.has(pageId)) {
        this.startPageIds.set(block.id, pageId);
      }
    }
    const session = createEditorAgentSession(
      this.Blok,
      { ...identity, kind: 'agent' },
      askAiSessionOptions({
        contractSource: this.source(),
        services: this.services(),
        attributeTo: options.attributeTo,
        onPrepared: (type, data) => {
          if (type === 'page' && typeof data.pageId === 'string') {
            this.hostPageIds.add(data.pageId);
          }
        },
        onPagePointed: (pageId) => this.agentPageIds.add(pageId),
      })
    );
    this.turnSession = session;
    this.turnLog = { agentName: identity.name, changed: new Set<string>() };

    const turn = createAgentTurn(session, {
      onExecuted: (result) => {
        const { created, updated, moved, removed } = result.changed;

        [...created, ...updated, ...moved, ...removed].forEach((id) => this.turnLog.changed.add(id));
        this.presence().show(result, { draw: internal.drawLocal });
        try {
          internal.onExecuted?.(result.changed);
        } catch {
          // A listener must not fail an applied batch.
        }
      },
      onClosed: () => this.closeTurn(turn),
      isEditorDestroyed: () => this.isDestroyed,
      ...(this.pages() === null ? {} : { openPage: (blockId: string) => this.openPage(blockId, { ...identity, kind: 'agent' }) }),
    });

    this.current.turn = turn;
    this.setState({ status: 'working', turn: { id: turn.id, agent: identity } });
    this.presence().start(identity, {
      follow: options.follow === true,
    });

    return turn;
  }

  private closeTurn(turn: AgentTurn): void {
    if (this.current.turn !== turn) {
      return;
    }

    this.current.turn = null;
    this.turnSession = null;
    this.presence().stop();

    const count = this.turnLog.changed.size;

    // One summary per turn: per-batch announcements would flood a screen reader.
    if (count > 0) {
      const key = count === 1 ? 'agent.changedOneBlock' : 'agent.changedBlocks';

      announce(this.Blok.I18n.t(key, { agent: this.turnLog.agentName, count }), { politeness: 'polite' });
    }
    this.setState(IDLE);
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
