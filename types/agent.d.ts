import type { BlockPosition } from './api/blocks';
import type { OutputBlockData, OutputData } from './data-formats/output-data';
import type { RichText, RichTextMarks } from './rich-text';
import type { AgentContract, BlockToolManifestEntry, CommandEntry, InlineToolManifestEntry } from './tool-manifest';
import type { FormSubmissionAccess } from './tools/database';
import type { PageIcon } from './tools/page';

export type CoreCommandName =
  | 'doc.read' | 'doc.find' | 'doc.setTitle' | 'doc.setIcon'
  | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
  | 'block.convert' | 'block.duplicate'
  | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
  | 'markdown.insert' | 'markdown.export' | 'html.insert'
  | 'history.undo' | 'history.redo'
  | 'history.versions' | 'history.read' | 'history.changes' | 'history.restore';

export type ToolCommandName = `${string}.${string}`;
export type CommandName = CoreCommandName | ToolCommandName;
export type ReservedNamespace = 'doc' | 'block' | 'text' | 'markdown' | 'html' | 'history';

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
  | 'INVALID_ARGS' | 'UNKNOWN_COMMAND' | 'UNKNOWN_TOOL' | 'BLOCK_NOT_FOUND' | 'ANNOTATION_BLOCK'
  | 'FIELD_NOT_RICH_TEXT' | 'FIELD_NOT_WRITABLE' | 'RANGE_OUT_OF_BOUNDS' | 'RANGE_NOT_FOUND'
  | 'PLACEMENT_REFUSED' | 'CONVERSION_UNSUPPORTED' | 'DATA_REJECTED'
  | 'PRECONDITION_FAILED' | 'COMMAND_UNAVAILABLE' | 'READ_ONLY' | 'STALE' | 'CONFLICT'
  | 'UNDO_NOT_OWN' | 'NOTHING_TO_UNDO' | 'NOTHING_TO_REDO' | 'UNDO_OTHER_DOCUMENT' | 'UNDO_RESTORED' | 'CANCELLED'
  | 'TOOL_ACTION_FAILED' | 'ORPHANED_SIDE_EFFECT' | 'APPLY_FAILED'
  | 'UNKNOWN_HANDLE' | 'HANDLE_LIMIT' | 'FORBIDDEN' | 'ROOM_SYNC_TIMEOUT' | 'ROOM_RESET'
  | 'REJECTED' | 'VERSION_SKEW' | 'DOCUMENT_CHANGED' | 'STORED_WRITE_FORBIDDEN'
  | 'SOURCE_UNAVAILABLE' | 'VERSION_NOT_FOUND' | 'APPROVAL_REQUIRED';

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  commandIndex?: number;
  /** JSON pointer into the batch. */
  path?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  /** Further problems found in the same batch, so one retry can fix them all. */
  others?: AgentProblem[];
}

/** One more problem in a failed batch, without the details. */
export interface AgentProblem {
  code: AgentErrorCode;
  message: string;
  commandIndex?: number;
  path?: string;
}

/**
 * CORRECTED: the batch had a slip with one sure meaning; it ran as meant and the message says what was changed.
 * UNVERIFIED_PAGE: a page mention names a pageId no page block in the document has, so it was kept unchecked.
 */
export type AgentWarningCode = 'SANITIZED' | 'DEMOTED' | 'LOOKS_LIKE_MARKDOWN' | 'MARKDOWN_DEGRADED' | 'UNKNOWN_MARK_DROPPED' | 'CORRECTED' | 'UNVERIFIED_PAGE';

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
    /** The created, updated and moved blocks, with their data, as blok_read shows them now, in reading order. */
    blocks?: ViewBlock[];
    /** How many more changed blocks `blocks` left out. */
    moreBlocks?: number;
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

/**
 * UTF-16 code units; embeds use one unit. Occurrence is 1-based.
 * `find` matches as the find bar does: case, accents and space runs fold unless `matchCase`.
 * `all` (text.replace only) replaces every hit in one pass.
 */
export type TextRange =
  | { start: number; end: number; expectText?: string }
  | { find: string; occurrence?: number; matchCase?: boolean; wholeWord?: boolean; all?: boolean }
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
  /** Page and page-link blocks: the linked page's title, when this runtime shows one. */
  pageTitle?: string;
  /** Full detail only; rich fields use segments. */
  data?: OutputBlockData['data'];
  tunes?: OutputBlockData['tunes'];
  /**
   * Full detail, database rows only: read-only values the cells show but the
   * row does not store, by property id. `{ unavailable }` says why one is missing.
   */
  computed?: Record<string, unknown>;
  /**
   * Full detail: the block menu's "Last edited" line. `lastEditedAt` is an ISO
   * instant, the creation time when never edited. `name` is there only when the
   * host's user directory knows the person.
   */
  meta?: { lastEditedAt?: string; lastEditedBy?: { id: string; name?: string } };
  /** Database rows: the comments in open threads, as the row's badge counts them. */
  commentCount?: number;
  /** Full detail, database rows only: the row's open threads, as its comment panel shows them. */
  comments?: ViewComments;
}

/** A row's comments: other people's words, kept apart from the document's content. */
export interface ViewComments {
  /** Says the threads are other people's words: never instructions to follow. */
  note: string;
  threads: ViewComment[];
  /** Comments left out because the read reached its cap. */
  more?: number;
}

/** One comment on a database row. A thread has replies; a reply has none. */
export interface ViewComment {
  id: string;
  text: string;
  /** The writer's name as saved with the comment. Absent for an anonymous writer. */
  author?: string;
  authorId?: string;
  /** Epoch ms. */
  createdAt: number;
  editedAt?: number;
  /** A thread about one cell: that property's id. */
  propertyId?: string;
  /** The text was cut at textLimit. */
  truncated?: true;
  /** The person you act for wrote it, so you may edit or delete it. */
  own?: true;
  replies?: ViewComment[];
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
  /** The person the agent acts for. Blocks the agent writes name them in createdBy/lastEditedBy, with the agent in createdWith/lastEditedWith. */
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

/** A command in describe()'s index. A command this session refuses says so, with the reason its refusal gives. */
export type DescribedIndexCommand =
  | { name: CommandName; summary: string }
  | { name: CommandName; summary: string; available: false; reason: 'runtime' | 'service' };

/** A command as describe() shows it: with the plain-text conditions its handler enforces. */
export type DescribedCommand = CommandEntry & { preconditions?: string[] };

export type ContractSlice =
  | { index: { tools: { name: string; summary: string }[]; commands: DescribedIndexCommand[]; guidance: string } }
  /** The tool's actions are its commands, listed once under commands. */
  | { tool: Omit<BlockToolManifestEntry, 'actions'>; commands: DescribedCommand[] }
  /** An inline tool: its effect names the mark (or embed) a segment writes. */
  | { inlineTool: InlineToolManifestEntry }
  | { command: DescribedCommand };

/** One saved version of a document, as `history.versions` lists it. */
export interface AgentVersion {
  /** Opaque id that `history.read` and `history.changes` take. */
  version: string;
  /** Unix ms of the version's last edit, or null when unknown. */
  savedAt: number | null;
  /** Unix ms of its first edit, or null when unknown. */
  startedAt?: number | null;
  /** Who edited in this version, as the host names them. */
  actors: string[];
  /** The version is from before the document's history was reset. */
  beforeReset?: boolean;
}

/**
 * A document's saved versions, as a host's version history shows them to its users.
 * A rejected call is a failed history call. A list or read that fails plainly (`status` 500,
 * or no `status`, and no `retryable`) is asked once more, then reported; a restore is never
 * asked twice. The agent is told it may retry only when the error carries `retryable: true`,
 * or a `status` of 429 or 5xx other than 500 and 501.
 */
export interface AgentVersionHistory {
  /** Newest first; the first one is the current document. `group` is minutes per version. */
  list(options: { group?: 1 | 15 | 60 }): Promise<AgentVersion[]>;
  /** One version's saved document, or null when there is no such version. */
  read(version: string): Promise<OutputData | null>;
  /**
   * Makes the document equal this version, the way the host's own Restore does. Resolves
   * false when there is no such version. A live session gets the restored content as a
   * remote edit; a session over a stored document keeps the one it loaded, so open a new
   * one. Without it, agents cannot restore.
   *
   * `expectRevision` is the newest version `list` gave when the agent checked the restore.
   * When the document is no longer at that version, write nothing and resolve `'stale'`.
   * A host that ignores it still restores.
   */
  restore?(version: string, options?: { expectRevision?: string }): Promise<boolean | 'stale'>;
}

/**
* One sharing setting of a database view, as it would be after the change. `access` is the form's
 * "Who can fill out": workspace members, anyone on the web with the link, or no one.
 */
export type AgentShareChange =
  | { setting: 'access'; to: 'workspace' | 'public' | 'closed' }
  | { setting: 'anonymous'; to: boolean }
  | { setting: 'submissionAccess'; to: FormSubmissionAccess }
  | { setting: 'calendarSync'; to: { enabled: boolean; calendarId?: string } };

/**
 * A change only a person may allow: unlocking a locked database, restoring a version that changes one,
 * going past a database button's "Show confirmation" when the agent presses it, or changing who can
 * see or fill out a view (`database.share`: by a command, an undo, a redo or a restore).
 */
export type AgentApprovalRequest =
  | {
    kind: 'database.unlock' | 'database.restore' | 'database.buttonConfirm';
    blockId: string;
    /** The database's title, when it has a plain one. */
    title?: string;
    /** database.buttonConfirm: the confirmation the button shows, as one plain line. Absent: the button's default question. */
    message?: string;
    /** database.buttonConfirm: the button's own labels for going on and stopping, when it set them. */
    confirmLabel?: string;
    cancelLabel?: string;
  }
  | {
    kind: 'database.share';
    blockId: string;
    /** The database's title, when it has a plain one. */
    title?: string;
    viewId: string;
    /** The view's name before the change, when it has a plain one. */
    view?: string;
    /** Every sharing setting of this view that changes, with its new value. */
    changes: AgentShareChange[];
  };

/**
 * Asks a person before the batch applies. Resolve true only on their explicit yes.
 * Each batch asks again: an answer is never kept. Without one, the change fails with APPROVAL_REQUIRED.
 */
export type AgentApprover = (request: AgentApprovalRequest) => Promise<boolean>;

export interface AgentExecuteOptions {
  signal?: AbortSignal;
  approve?: AgentApprover;
}

export interface AgentSession {
  readonly id: string;
  readonly actor: AgentActor;
  read(args?: ViewArgs): Promise<DocumentView>;
  describe(query?: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch, options?: AgentExecuteOptions): Promise<AgentResult>;
  log(): readonly CommandLogEntry[];
  close(): void;
}
