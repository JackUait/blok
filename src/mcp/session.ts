import type { AgentBatch, AgentResult, ContractSlice, DocumentView, ViewArgs } from '../../types/agent';
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

export interface HandleSession {
  readonly mode: 'live' | 'stored';
  readonly write: boolean;
  readonly durability: Durability;
  readonly contractRevision: string;
  read(args: ViewArgs): Promise<DocumentView>;
  describe(query: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch): Promise<McpExecuteResult>;
  close(reason: 'closed' | 'expired'): Promise<CloseSummary>;
}
