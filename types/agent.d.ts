import type { BlockPosition } from './api/blocks';
import type { OutputBlockData } from './data-formats/output-data';
import type { RichText, RichTextMarks } from './rich-text';
import type { PageIcon } from './tools/page';

export type CoreCommandName =
  | 'doc.read' | 'doc.find' | 'doc.setTitle' | 'doc.setIcon'
  | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
  | 'block.convert' | 'block.duplicate'
  | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
  | 'markdown.insert' | 'markdown.export'
  | 'history.undo' | 'history.redo';

export type ToolCommandName = `${string}.${string}`;
export type CommandName = CoreCommandName | ToolCommandName;
export type ReservedNamespace = 'doc' | 'block' | 'text' | 'markdown' | 'history';

export interface AgentCommand {
  name: CommandName;
  args: Record<string, unknown>;
  ref?: string;
}

export interface AgentBatch {
  commands: AgentCommand[];
  expectRevision?: string;
}

export interface ChangedSet {
  created: string[];
  updated: string[];
  moved: string[];
  removed: string[];
}

export interface TextRangeRef {
  blockId: string;
  field: string;
  start: number;
  end: number;
}

export type AgentErrorCode =
  | 'INVALID_ARGS' | 'UNKNOWN_COMMAND' | 'UNKNOWN_TOOL' | 'BLOCK_NOT_FOUND'
  | 'FIELD_NOT_RICH_TEXT' | 'FIELD_NOT_WRITABLE' | 'RANGE_OUT_OF_BOUNDS' | 'RANGE_NOT_FOUND'
  | 'PLACEMENT_REFUSED' | 'CONVERSION_UNSUPPORTED' | 'DATA_REJECTED'
  | 'PRECONDITION_FAILED' | 'COMMAND_UNAVAILABLE' | 'READ_ONLY' | 'STALE' | 'CONFLICT'
  | 'UNDO_NOT_OWN' | 'NOTHING_TO_UNDO' | 'CANCELLED'
  | 'TOOL_ACTION_FAILED' | 'ORPHANED_SIDE_EFFECT' | 'APPLY_FAILED'
  | 'UNKNOWN_HANDLE' | 'HANDLE_LIMIT' | 'FORBIDDEN' | 'ROOM_SYNC_TIMEOUT' | 'ROOM_RESET'
  | 'REJECTED' | 'VERSION_SKEW' | 'DOCUMENT_CHANGED' | 'STORED_WRITE_FORBIDDEN'
  | 'SOURCE_UNAVAILABLE';

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  commandIndex?: number;
  /** JSON pointer into the batch. */
  path?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type AgentWarningCode = 'SANITIZED' | 'DEMOTED' | 'LOOKS_LIKE_MARKDOWN' | 'MARKDOWN_DEGRADED' | 'UNKNOWN_MARK_DROPPED';

export interface AgentWarning {
  code: AgentWarningCode;
  message: string;
  commandIndex?: number;
  blockId?: string;
  field?: string;
}

export type AgentResult =
  | {
    ok: true;
    revision: string;
    results: unknown[];
    refs: Record<string, string>;
    changed: ChangedSet;
    lastRange?: TextRangeRef;
    warnings: AgentWarning[];
  }
  | {
    ok: false;
    revision?: string;
    error: AgentError;
    warnings: AgentWarning[];
  };

export type PlacementRefusalReason =
  | 'NOT_A_CHILD' | 'OWN_SUBTREE' | 'TABLE_CELL_BOUNDARY' | 'TAKES_NO_CHILDREN'
  | 'OWNS_CHILDREN' | 'CHILD_NOT_ALLOWED' | 'RESTRICTED_IN_CELL' | 'SELF_PLACED_PARENT';

/** UTF-16 code units; embeds use one unit. Occurrence is 1-based. */
export type TextRange =
  | { start: number; end: number; expectText?: string }
  | { find: string; occurrence?: number }
  | 'all';

export interface InsertSpec {
  type: string;
  data?: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  id?: string;
  children?: InsertSpec[];
}

export interface BlockInsertArgs extends InsertSpec {
  parentId?: string | null;
  position?: BlockPosition;
  demote?: boolean;
}

export interface PlannedBlock {
  id: string;
  type: string;
  /** Sanitized and normalized; rich fields use segments. */
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  children: PlannedBlock[];
}

export type Edit =
  | { op: 'insert'; block: PlannedBlock; parentId: string | null; afterId: string | null }
  | { op: 'remove'; id: string; withChildren: boolean }
  | { op: 'move'; id: string; parentId: string | null; afterId: string | null }
  | { op: 'setData'; id: string; patch: Record<string, unknown> }
  | { op: 'setRichText'; id: string; field: string; value: RichText }
  | { op: 'setTunes'; id: string; tunes: Record<string, unknown> }
  | { op: 'replaceType'; id: string; type: string; data: Record<string, unknown> }
  | { op: 'setPageField'; key: 'title' | 'icon'; value: string | PageIcon | null };

export interface ViewArgs {
  rootId?: string | null;
  depth?: number;
  ids?: string[];
  detail?: 'outline' | 'full';
  limit?: number;
  cursor?: string;
  textLimit?: number;
}

export interface ViewBlock {
  id: string;
  type: string;
  depth: number;
  parentId?: string;
  text?: string;
  truncated?: true;
  attrs?: Record<string, unknown>;
  childCount?: number;
  opaque?: true;
  cell?: { row: number; col: number };
  /** Full detail only; rich fields use segments. */
  data?: OutputBlockData['data'];
  tunes?: OutputBlockData['tunes'];
}

export interface DocumentView {
  revision: string;
  rootId: string | null;
  page?: { title?: string; icon?: PageIcon };
  blocks: ViewBlock[];
  next?: string;
  /** Editor only. */
  selection?: TextRangeRef;
}

export interface AgentActor {
  id: string;
  name: string;
  kind: 'agent';
  onBehalfOf?: string;
  color?: string;
}

export interface CommandLogEntry {
  batch: number;
  index: number;
  name: string;
  args: unknown;
  result?: unknown;
  error?: AgentError;
  actorId: string;
}

export interface RichTextHelpers {
  plainText(value: RichText): string;
  length(value: RichText): number;
  resolve(value: RichText, range: TextRange): { start: number; end: number };
  slice(value: RichText, start: number, end: number): RichText;
  insert(value: RichText, at: number, inserted: RichText): RichText;
  remove(value: RichText, start: number, end: number): RichText;
  format(value: RichText, start: number, end: number, set?: RichTextMarks, unset?: string[]): RichText;
  canonicalize(value: RichText): RichText;
}
