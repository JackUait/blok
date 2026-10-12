import type {
  Agent,
  AgentAnthropicTool,
  AgentIdentity,
  AgentOpenAITool,
  AgentState,
  AgentToolsOptions,
  AgentTurn,
  AgentTurnOptions,
} from '../../../../types/api';
import type { HostService } from '../../../../types/tools/tool-description';
import { Module } from '../../__module';
import { announce } from '../../utils/announcer';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { createEditorAgentSession, liveContractSource, type ContractSource } from '../agent/editor-session';
import { inputIndexForField } from '../collaboration/agent-placement';

import { createAgentPresence, type AgentPresence } from './agent-presence';

import { createEditorServices } from './agent-services';
import { createAgentTurn } from './agent-turn';

export class AgentTurnOpenError extends Error {
  public constructor() {
    super('An agent turn is already open. Call end() or stop() on it before begin().');
    this.name = 'AgentTurnOpenError';
  }
}

const IDLE: AgentState = { status: 'idle' };

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

  private contractSource: ContractSource | null = null;

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
    };
  }

  public destroy(): void {
    this.current.turn?.stop();
    this.subscribers.clear();
  }

  private services(): Partial<Record<HostService, unknown>> {
    this.serviceCache ??= createEditorServices(this.Blok, this.config);

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

  private tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  private tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  private async tools(options: AgentToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]> {
    const { renderAgentTools } = await import('../../../agent/render-tools');
    const tools = renderAgentTools(this.source().contract(), options);

    return options.format === 'anthropic'
      ? tools.filter((tool): tool is AgentAnthropicTool => 'input_schema' in tool)
      : tools.filter((tool): tool is AgentOpenAITool => 'parameters' in tool);
  }

  private async guidance(): Promise<string> {
    const { composeGuidance } = await import('../../../agent/guidance');

    return composeGuidance(this.source().contract());
  }

  private begin(options: AgentTurnOptions): AgentTurn {
    if (this.current.turn !== null) {
      throw new AgentTurnOpenError();
    }

    const identity = readIdentity(options?.agent);
    const session = createEditorAgentSession(
      this.Blok,
      { ...identity, kind: 'agent' },
      {
        contractSource: this.source(),
        services: this.services(),
        mergeSteps: 'turn',
        attributeLastEditedBy: options.attributeTo !== 'user',
      }
    );
    this.turnLog = { agentName: identity.name, changed: new Set<string>() };

    const turn = createAgentTurn(session, {
      onExecuted: (result) => {
        const { created, updated, moved, removed } = result.changed;

        [...created, ...updated, ...moved, ...removed].forEach((id) => this.turnLog.changed.add(id));
        this.presence().show(result);
      },
      onClosed: () => this.closeTurn(turn),
      isEditorDestroyed: () => this.isDestroyed,
    });

    this.current.turn = turn;
    this.setState({ status: 'working', turn: { id: turn.id, agent: identity } });
    this.presence().start(identity, { follow: options.follow === true });

    return turn;
  }

  private closeTurn(turn: AgentTurn): void {
    if (this.current.turn !== turn) {
      return;
    }

    this.current.turn = null;
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
