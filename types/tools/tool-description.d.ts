import type { BlockPosition } from '../api/blocks';
import type { InsertSpec, RichTextHelpers } from '../agent';
import type { RichText } from '../rich-text';
import type { ToolConfig } from './tool-config';

/** Only Blok schema-profile keywords are valid. */
export type BlokSchema = { readonly [keyword: string]: unknown };

/** 'host' covers custom prepareInsert needs that Blok cannot inspect. */
export type HostService = 'uploader' | 'linkMetadata' | 'pageBackend' | 'host';

export interface ToolActionDeclaration {
  /** camelCase; core prefixes the registry key. */
  name: string;
  summary: string;
  guidance?: string;
  /** Core adds id, parentId and position by target; do not declare them here. */
  args: BlokSchema;
  result?: BlokSchema;
  target: 'block' | 'create';
  /** Defaults to 'any'. */
  runtime?: 'any' | 'editor';
  /** Host effects must run alone in a batch. */
  effects?: 'host';
  /** The handler enforces these plain-text conditions. */
  preconditions?: string[];
  /** A missing service makes the command unavailable. */
  requires?: HostService[];
  /** Use these services when present; do not require them. */
  uses?: HostService[];
  /** Capability ids from the coverage ledger. */
  mirrors?: string[];
}

export interface BlockToolDescription {
  summary: string;
  guidance?: string;
  data: BlokSchema;
  defaultData?: Record<string, unknown>;
  examples?: Array<Record<string, unknown>>;
  summaryFields?: string[];
  /** Entry i maps DOM input i; absent: one rich field maps to input 0, else block-level. */
  inputFields?: string[];
  /** Per-person fields agents must never write. */
  viewState?: string[];
  /** Plain writes must use the mapped command instead. */
  guardedFields?: Record<string, string>;
  actions?: ToolActionDeclaration[];
}

export interface InlineToolDescription {
  summary: string;
  effect:
    | { mark: string; value: BlokSchema }
    | { marks: string[]; value: BlokSchema }
    | { embed: string; value: BlokSchema }
    | { clears: 'marks' };
}

export interface BlockTuneDescription {
  summary: string;
  /** Null when the tune saves nothing. */
  data: BlokSchema | null;
}

/** Pure and synchronous; config only narrows the schema. Output must round-trip as JSON. */
export type DescribeBlockTool = (config: ToolConfig) => BlockToolDescription;

export interface ToolActionContext {
  /** The registry key this action runs under. A create action inserts this type. */
  tool: string;
  block?: { id: string; type: string; data: Readonly<Record<string, unknown>>; children: readonly string[] };
  read(id: string): { id: string; type: string; data: unknown; parentId: string | null; children: readonly string[] } | null;
  insert(input: { type: string; data?: Record<string, unknown>; parentId?: string | null; position?: BlockPosition; children?: InsertSpec[] }): string;
  /** Null and undefined remove a key. */
  update(id: string, patch: Record<string, unknown>): void;
  setRichText(id: string, field: string, value: RichText): void;
  move(id: string, to: { parentId?: string | null; position: BlockPosition }): void;
  remove(id: string, opts?: { withChildren?: boolean }): void;
  newId(): string;
  richText: RichTextHelpers;
  fail(code: 'PRECONDITION_FAILED' | 'INVALID_ARGS', message: string): never;
}

export interface ToolActionImpl<Args = unknown, Prepared = unknown, Result = unknown> {
  /** Async host work before planning. Writes nothing. */
  prepare?(ctx: { services: Partial<Record<HostService, unknown>> }, args: Args): Promise<Prepared>;
  /** Synchronous. Records writes; reads see earlier writes. */
  run(ctx: ToolActionContext, args: Args, prepared: Prepared | undefined): Result;
}
