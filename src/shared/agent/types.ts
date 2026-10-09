import type {
  AgentActor, AgentBatch, AgentSession, AgentWarning, ChangedSet, Edit, InsertSpec, RichTextHelpers, TextRangeRef,
} from '../../../types/agent';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { RichText } from '../../../types/rich-text';
import type { ToolActionImpl } from '../../../types/tools/tool-description';

export type JsonSchema = { readonly [keyword: string]: unknown };
export type SchemaValidator = (schema: JsonSchema, value: unknown) => Array<{ path: string; message: string }>;

export interface PlannerCommand {
  name: string;
  args: JsonSchema;
  readOnly: boolean;
  available: boolean;
  unavailableReason?: 'runtime' | 'service';
  requires?: string[];
  effects?: 'host';
  source: 'core' | { tool: string; target: 'block' | 'create' };
}

export interface PlannerToolEntry {
  name: string;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: { accepts: boolean; allow?: string[]; deny?: string[]; ownedByTool: boolean; layout: boolean; deletedWithParent: boolean };
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  summaryFields?: string[];
  conversion: { import?: string; export?: string };
  data: JsonSchema;
  defaultData?: Record<string, unknown>;
  insertRequires?: string[];
}

export type PlannerActionImpl = ToolActionImpl;

export interface PlannerToolRuntime {
  normalize?(data: Record<string, unknown>): Record<string, unknown>;
  defaultChildren?: InsertSpec[];
  actions: Readonly<Record<string, ToolActionImpl>>;
}

export interface PlannerTool { entry: PlannerToolEntry; runtime: PlannerToolRuntime }

export interface AgentPorts {
  htmlToSegments(html: string): RichText;
  sanitizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown>;
  markdownToBlocks(md: string): Promise<{ blocks: OutputBlockData[]; warnings: AgentWarning[] }>;
  blocksToMarkdown(doc: OutputData): { markdown: string; warnings: AgentWarning[] };
  newId(): string;
  openPageDocument?(pageId: string, actor: AgentActor): Promise<AgentSession & { close(): void }>;
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
}

export interface Plan {
  edits: Edit[];
  results: unknown[];
  refs: Record<string, string>;
  changed: ChangedSet;
  lastRange?: TextRangeRef;
  warnings: AgentWarning[];
  touched: Set<string>;
}

export type { AgentBatch };
