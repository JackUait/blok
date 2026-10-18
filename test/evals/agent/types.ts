import type { OutputData } from '../../../types';
import type { CorpusBatch } from '../../unit/agent/parity/corpus';

export interface LogEntry { batch: number; index: number; name: string; args: unknown; result?: unknown; error?: { code: string; message?: string }; actorId: string }
export interface ChangedSet { created: string[]; updated: string[]; moved: string[]; removed: string[] }
export interface ExecuteResult {
  ok: boolean;
  changed?: ChangedSet;
  warnings?: Array<{ code: string; blockId?: string }>;
  error?: { code: string; message?: string; commandIndex?: number };
  delivery?: { durable: boolean; pending: boolean; serverSequence: string | null; savedVersion: string | null };
}
export interface Observed {
  humanId?: string;
  humanTyped?: { blockId: string; text: string };
  participants?: Array<{ id: string; name: string }>;
  participantsAfterClose?: Array<{ id: string; name: string }>;
  peerSawAgentCursorOn?: string[];
  journalActors?: string[];
  serverAckedSequences?: string[];
}
export interface GraderInput {
  seed: OutputData;
  final: OutputData;
  actorId: string;
  log: readonly LogEntry[];
  results?: readonly ExecuteResult[];
  toolCalls?: readonly string[];
  answer?: string;
  observed?: Observed;
}
export interface Verdict { pass: boolean; detail: string }
export interface Grader { name: string; check(input: GraderInput): Verdict }
export type Surface = 'in-app' | 'in-app-browser' | 'mcp-stored' | 'mcp-live';
export interface KnownBad { why: string; final: OutputData; log?: LogEntry[]; results?: ExecuteResult[]; toolCalls?: string[]; answer?: string; observed?: Observed }
export interface EvalTask {
  id: string;
  prompt: string;
  surfaces: Surface[];
  seed: OutputData;
  tools?: 'default' | 'rating-fixture';
  graders: Grader[];
  reference: CorpusBatch[];
  /** Set when the reference cannot be replayed in Node (a browser-only tool, a live room's human edits). */
  referenceFinal?: OutputData;
  referenceLog?: LogEntry[];
  referenceResults?: ExecuteResult[];
  referenceAnswer?: string;
  referenceObserved?: Observed;
  referenceToolCalls?: string[];
  docId?: string;
  knownBad: KnownBad[];
  /** Set while a real defect stops the reference; the self-test then expects it to fail. */
  referenceBlockedBy?: string;
  budget: { maxTurns: number; maxOutputTokens: number };
}
export interface EvalResults {
  model: string; effort: string; commit: string; schema: 'envelope' | 'full' | 'shipped';
  tasks: Array<{
    id: string; surface: Surface;
    trials: Array<{ outcome: 'pass' | 'fail' | 'error'; graders: Record<string, Verdict>; turns: number; inputTokens: number; outputTokens: number; errorDetail?: string }>;
    passAt1: number; passAll: boolean;
  }>;
}
