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
