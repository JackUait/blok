import type {
  AgentActor, AgentBatch, AgentSession, AgentWarning, ChangedSet, Edit, InsertSpec, RichTextHelpers, TextRangeRef,
} from '../../../types/agent';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { RichText, RichTextLink } from '../../../types/rich-text';
import type { ToolActionImpl } from '../../../types/tools/tool-description';

export type JsonSchema = { readonly [keyword: string]: unknown };
export type SchemaValidator = (schema: JsonSchema, value: unknown) => Array<{ path: string; message: string }>;

export interface PlannerCommand {
  name: string;
  args: JsonSchema;
  readOnly: boolean;
  available: boolean;
  unavailableReason?: 'runtime' | 'service' | 'host';
  requires?: string[];
  effects?: 'host';
  source: 'core' | { tool: string; target: 'block' | 'create' };
}

export interface PlannerToolEntry {
  name: string;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: { accepts: boolean; allow?: string[]; deny?: string[]; ownedByTool: boolean; layout: boolean; deletedWithParent: boolean; annotation?: boolean };
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  summaryFields?: string[];
  fillMissing?: string[];
  findFields?: string[];
  conversion: { import?: string; export?: string };
  data: JsonSchema;
  defaultData?: Record<string, unknown>;
  insertRequires?: string[];
  /** Optional so hand-built entries may leave it out; only false refuses block.insert. */
  insertable?: boolean;
  insertUnavailableReason?: 'runtime' | 'host';
  variants?: Array<{ name: string; title: string; data: Record<string, unknown> }>;
}

export type PlannerActionImpl = ToolActionImpl;

export interface PlannerToolRuntime {
  normalize?(data: Record<string, unknown>): Record<string, unknown>;
  /** The value a removed key gets instead of being deleted, so the tool does not refill it on load. */
  cleared?: Readonly<Record<string, unknown>>;
  rejectWrite?(data: Record<string, unknown>, written: readonly string[]): string | undefined;
  defaultChildren?: InsertSpec[];
  actions: Readonly<Record<string, ToolActionImpl>>;
  /** Text fields for block.convert when the manifest entry has none, and fields its import always sets. */
  conversion?: { import?: string; export?: string; base?: Readonly<Record<string, unknown>> };
  /** A child's block.delete or block.duplicate runs this tool's action instead, so the parent keeps its invariants. */
  childCommand?: ChildCommandRoute;
}

export type ChildCommandRoute = (command: 'delete' | 'duplicate', child: { id: string; type: string }) => { action: string; args: Record<string, unknown> } | undefined;

export interface PlannerTool { entry: PlannerToolEntry; runtime: PlannerToolRuntime }

export interface AgentPorts {
  htmlToSegments(html: string): RichText;
  sanitizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown>;
  markdownToBlocks(md: string): Promise<{ blocks: OutputBlockData[]; warnings: AgentWarning[] }>;
  blocksToMarkdown(doc: OutputData): { markdown: string; warnings: AgentWarning[] };
  /** The blocks a person's paste of `html` gives. Only the editor has it: it runs the paste pipeline. */
  htmlToBlocks?(html: string): Promise<{ blocks: OutputBlockData[]; warnings: AgentWarning[] }>;
  newId(): string;
  /**
   * The host's filter for media URLs agents write (agent.assistant.allowMediaUrl). Absent: every URL loads.
   * `allows` gets the URL as written; `urlsInHtml` lists the URLs an HTML string would load.
   */
  media?: { allows(url: string): boolean; urlsInHtml(html: string): string[] };
  /** The editor's `link` config; without it a link gets the Link tool defaults. */
  resolveLink?(link: RichTextLink): RichTextLink;
  openPageDocument?(pageId: string, actor: AgentActor): Promise<AgentSession & { close(): void }>;
  /** Creates an empty page document for a new page block. Contracts list `page` as insertable only with it. */
  createPageDocument?(actor: AgentActor): Promise<{ pageId: string }>;
  /**
   * The title a page or page-link block shows now for `pageId`, when the runtime already holds it.
   * Must not fetch. A block that now shows another page answers nothing.
   */
  pageTitle?(blockId: string, pageId: string): string | undefined;
  /**
   * The name the UI shows for a user id, when the runtime holds the host's directory. Must not fetch.
   * With `databaseId`, as that database's Created by and Last edited by cells name them; without, as the block menu does.
   */
  userName?(userId: string, databaseId?: string): string | undefined;
}

export interface PlannerContext {
  tools: ReadonlyMap<string, PlannerTool>;
  commands: ReadonlyMap<string, PlannerCommand>;
  ports: AgentPorts;
  validate: SchemaValidator;
  defaultBlock: string;
  richText: RichTextHelpers;
  prepared: ReadonlyMap<number, unknown>;
  services: Partial<Record<string, unknown>>;
  /** approvalKey()s a person approved for this batch only. */
  approved?: ReadonlySet<string>;
  /** A block's title as saved before this batch. The person is shown this one, never the draft's. */
  committedTitle?: (id: string) => string | undefined;
}

export interface Plan {
  edits: Edit[];
  results: unknown[];
  refs: Record<string, string>;
  changed: ChangedSet;
  lastRange?: TextRangeRef;
  warnings: AgentWarning[];
  touched: Set<string>;
  /** Every write is a comment command: appliers keep it out of undo, as a person's comment is. */
  commentsOnly?: true;
  hostEffects?: HostEffect[];
}

/** A host hook a tool action asked for, run by `blockId`'s tool once the batch has applied. */
export interface HostEffect {
  blockId: string;
  effect: Record<string, unknown>;
}

export type { AgentBatch };
