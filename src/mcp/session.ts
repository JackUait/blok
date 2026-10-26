import type { AgentBatch, AgentExecuteOptions, AgentResult, ContractSlice, DocumentView, ViewArgs } from '../../types/agent';
import type { AgentContract } from '../../types/tool-manifest';

export type Durability = 'acknowledged' | 'best-effort' | 'saved-on-execute';

export interface Delivery {
  durable: boolean;
  pending: boolean;
  serverSequence: string | null;
  savedVersion: string | null;
}

export type McpExecuteResult = AgentResult & { delivery: Delivery };

export interface CloseSummary {
  unsavedBatches: number;
  hostRecordLags: boolean;
}

/** A command the listed blok_execute schema offers that this handle refuses. */
export interface UnavailableCommand {
  name: string;
  reason: 'runtime' | 'service' | 'host';
}

export interface HandleSession {
  readonly mode: 'live' | 'stored';
  readonly write: boolean;
  readonly durability: Durability;
  readonly contractRevision: string;
  /** Stored mode only: false when the open found no document and started an empty one. */
  readonly exists?: boolean;
  /** Listed commands this handle refuses; absent when it runs them all. */
  readonly unavailableCommands?: readonly UnavailableCommand[];
  read(args: ViewArgs): Promise<DocumentView>;
  describe(query: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch, options?: Pick<AgentExecuteOptions, 'approve'>): Promise<McpExecuteResult>;
  close(reason: 'closed' | 'expired'): Promise<CloseSummary>;
}
