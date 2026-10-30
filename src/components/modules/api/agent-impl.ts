import type {
  AgentAnthropicTool,
  AgentAskOptions,
  AgentRun,
  AgentIdentity,
  AgentOpenAITool,
  AgentThinkingLevel,
  AgentToolsOptions,
  AgentTurn,
  AgentTurnOptions,
} from '../../../../types/api';
import type { OutputData } from '../../../../types';
import type { AgentActor, AgentBatch, AgentResult, AgentSession, AgentVersionHistory } from '../../../../types/agent';
import type { HostService } from '../../../../types/tools/tool-description';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { announce } from '../../utils/announcer';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { createEditorAgentSession, liveContractSource, type ContractSource } from '../agent/editor-session';
import { inputIndexForField } from '../collaboration/agent-placement';
import { composeFirstMessage } from '../../../agent/first-message';
import { readThinkingConfig } from '../../../agent/thinking';

import { createAgentPresence, type AgentPresence } from './agent-presence';

import { deepEqual } from '../../../shared/deep-equal';
import { createEditorServices, type HostPageWrite } from './agent-services';
import { createPageDocuments, type PageDocuments } from '../agent/page-documents';
import { isBlockReadOnly } from '../../utils/read-only-blocks';
import type { Block } from '../../block';
import { AgentFailure, failure } from '../../../shared/agent/errors';
import { canRestore } from '../../../shared/agent/version-history';
import { createAgentRun, type PageRestore } from './agent-run';
import { createAgentTurn } from './agent-turn';
import { askAiSessionOptions } from './agent-session-options';
import { AgentTurnOpenError, type AssistantRunHooks, type InternalTurnOptions } from './agent';
import type { UserPlace } from './agent-place';

const DEFAULT_MAX_STEPS = 100;

/** What the eager AgentAPI facade hears from this code. */
export interface AgentHost {
  /** A turn opened. The facade owns the state its subscribers read. */
  opened(id: string, agent: AgentIdentity): void;
  closed(id: string): void;
  isDestroyed(): boolean;
}

/** One assistant prompt, checked and placed by the facade when ask() was called. */
export interface AskInput {
  prompt: string;
  options: AgentAskOptions;
  place: UserPlace;
  /** The editor's top undo token when ask() was called. */
  base: ReturnType<BlokModules['YjsManager']['topUndoToken']>;
  /** The id the facade already showed for this turn. */
  id: string;
  /** The assistant as the host named it. */
  agent: AgentIdentity;
  /** `agent` acting for this editor's user. */
  identity: AgentIdentity;
  picked?: () => AgentThinkingLevel | undefined;
  hooks?: AssistantRunHooks;
  internal?: InternalTurnOptions;
}

interface TurnPage {
  /** The page before the turn's first save. */
  original: OutputData;
  /** What the agent saved last. */
  saved?: OutputData;
  /** Someone wrote the page between two agent saves. */
  kept: boolean;
}

type ToolsOptions = AgentToolsOptions;

/** The agent API's code. The AgentAPI facade loads it on first use. */
export class AgentCore extends Module {
  private readonly current: { turn: AgentTurn | null } = { turn: null };

  private readonly host: AgentHost;

  private serviceCache: Partial<Record<HostService, unknown>> | null = null;
  /** Undefined until first asked; null when no page tool has loadDocument and saveDocument. */
  private pageDocs: PageDocuments | null | undefined;
  /** Each sub-page the open turn saved. Discard writes `original` back unless someone else changed the page. */
  private turnPages = new Map<string, TurnPage>();
  /** Each page title or icon the open turn wrote through a host hook, by `pageId field`: the first write and the last. */
  private turnHostWrites = new Map<string, { first: HostPageWrite; last: HostPageWrite }>();
  /** The open turn restored a version: a write no undo reaches, so Discard cannot take it back. */
  private turnRestored = false;
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

  constructor(options: ModuleConfig, host: AgentHost) {
    super(options);
    this.host = host;
  }

  public get hasOpenTurn(): boolean {
    return this.current.turn !== null;
  }

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

  public ask(input: AskInput): AgentRun {
    const { prompt, options, place, base, picked = () => undefined, hooks = {}, internal } = input;
    const assistant = this.config.agent?.assistant;

    if (assistant === undefined) {
      throw new TypeError('editor.agent.ask() needs agent.assistant.model in the editor config.');
    }
    const hostTools = assistant.tools ?? [];
    const choice = readThinkingConfig(assistant.thinking);
    const thinking = (): AgentThinkingLevel | undefined => options.thinking ?? picked() ?? choice?.initial;
    const { YjsManager } = this.Blok;
    const turn = this.begin(input.identity, input.id, { agent: input.agent }, internal);
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
      restored: () => this.turnRestored,
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

  public destroy(): void {
    this.current.turn?.stop();
  }

  private services(): Partial<Record<HostService, unknown>> {
    this.serviceCache ??= createEditorServices(this.Blok, this.config, () => this.actor, this.pages(), (write) => {
      const key = `${write.pageId} ${write.field}`;
      const seen = this.turnHostWrites.get(key);

      this.turnHostWrites.set(key, { first: seen?.first ?? write, last: write });
      this.turnPageWritten?.();
    });
    const history = this.config.agent?.versionHistory;
    const restore = history?.restore;

    if (history !== undefined && restore !== undefined && this.serviceCache.versionHistory === history) {
      this.serviceCache.versionHistory = {
        list: (options) => history.list(options),
        read: (version) => history.read(version),
        restore: async (version, options) => {
          const restored = await restore.call(history, version, options);

          this.turnRestored ||= restored === true;

          return restored;
        },
      } satisfies AgentVersionHistory;
    }

    return this.serviceCache;
  }

  private source(): ContractSource {
    // Keep tool definitions and every session on the same live source.
    this.contractSource ??= liveContractSource(this.Blok, {
      services: Object.keys(this.services()).filter((name): name is HostService =>
        name === 'uploader' || name === 'linkMetadata' || name === 'pageBackend' || name === 'versionHistory'
      ),
      ...(canRestore(this.services().versionHistory) && { restores: true }),
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

  public tools(options: ToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  public tools(options: ToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  public tools(options: ToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]>;
  public async tools(options: ToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]> {
    const { renderAgentTools } = await import('../../../agent/render-tools');
    const tools = renderAgentTools(this.source().contract(), { ...options, schema: options.schema ?? 'mixed', pages: this.pages() !== null });

    return options.format === 'anthropic'
      ? tools.filter((tool): tool is AgentAnthropicTool => 'input_schema' in tool)
      : tools.filter((tool): tool is AgentOpenAITool => 'parameters' in tool);
  }

  public async guidance(): Promise<string> {
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

  /** The bar's question, unless the host would refuse the change anyway: then the person is not asked. */
  private approver(ask: NonNullable<AssistantRunHooks['onApproval']>): NonNullable<AssistantRunHooks['onApproval']> {
    return (request, signal) => {
      const block = this.Blok.BlockManager.getBlockById(request.blockId);

      if (block?.toolDataReadOnly === true) {
        return Promise.reject(failure('PRECONDITION_FAILED', `Block "${request.blockId}" is read-only here: the host does not allow editing it. It stays locked.`));
      }

      return ask(request, signal);
    };
  }

  /**
   * Open a turn.
   * @param identity - checked by the facade, with onBehalfOf filled in
   * @param id - the session id the facade already showed
   * @param options - the host's begin() options
   * @param internal - options only the assistant bar passes
   */
  public begin(identity: AgentIdentity, id: string, options: AgentTurnOptions, internal: InternalTurnOptions = { drawLocal: true }): AgentTurn {
    if (this.current.turn !== null) {
      throw new AgentTurnOpenError();
    }

    this.actor = { ...identity, kind: 'agent' };
    this.turnPages = new Map();
    this.turnHostWrites = new Map();
    this.turnRestored = false;
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
      {
        ...askAiSessionOptions({
          contractSource: this.source(),
          services: this.services(),
          attributeTo: options.attributeTo,
          onPrepared: (type, data) => {
            if (type === 'page' && typeof data.pageId === 'string') {
              this.hostPageIds.add(data.pageId);
            }
          },
          onPagePointed: (pageId) => this.agentPageIds.add(pageId),
        }),
        id,
      }
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
      isEditorDestroyed: () => this.host.isDestroyed(),
      ...(this.pages() === null ? {} : { openPage: (blockId: string) => this.openPage(blockId, { ...identity, kind: 'agent' }) }),
      ...(internal.onApproval === undefined ? {} : { approve: this.approver(internal.onApproval) }),
    });

    this.current.turn = turn;
    this.host.opened(turn.id, identity);
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
    this.host.closed(turn.id);
  }
}
