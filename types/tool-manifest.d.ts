import type {
  BlockToolDescription,
  BlockTuneDescription,
  BlokSchema,
  HostService,
  InlineToolDescription,
  ToolActionDeclaration,
} from './tools/tool-description';
import type { CommandName, ToolCommandName } from './agent';

export interface ManifestAction extends ToolActionDeclaration {
  command: ToolCommandName;
  available: boolean;
}

export interface BlockToolManifestEntry {
  name: string;
  title: string;
  summary: string;
  guidance?: string;
  level: 'described' | 'structural';
  insertable: boolean;
  variants: Array<{ name: string; title: string; data: Record<string, unknown> }>;
  data: BlokSchema;
  defaultData?: Record<string, unknown>;
  examples?: Array<Record<string, unknown>>;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: {
    accepts: boolean;
    allow?: string[];
    deny?: string[];
    ownedByTool: boolean;
    layout: boolean;
    deletedWithParent: boolean;
  };
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  summaryFields?: string[];
  inputFields?: string[];
  convertsTo: string[];
  conversion: { import?: string; export?: string };
  assetKind?: 'image' | 'video' | 'audio' | 'file';
  insertRequires?: HostService[];
  inlineTools: string[];
  tunes: string[];
  actions: ManifestAction[];
  actionsWithheld?: 'reserved-namespace';
}

export interface InlineToolManifestEntry {
  name: string;
  title: string;
  summary: string;
  level: 'described' | 'structural';
  /** Structural fallback needs exactly one sanitize tag to infer an effect. */
  effect?: InlineToolDescription['effect'];
  shortcut?: string;
}

export interface TuneManifestEntry {
  name: string;
  summary: string;
  level: 'described' | 'structural';
  data: BlokSchema | null;
}

export interface BlokToolManifest {
  formatVersion: 1;
  blokVersion: string;
  revision: string;
  readOnly: boolean;
  defaultBlock: string;
  blocks: BlockToolManifestEntry[];
  inlineTools: InlineToolManifestEntry[];
  tunes: TuneManifestEntry[];
}

export interface SnapshotBlockStatics {
  toolbox: Array<{ name: string; title: string; data?: Record<string, unknown>; previewCaption?: string }>;
  richTextFields: string[];
  acceptsChildren: boolean;
  childTools?: { allow?: string[]; deny?: string[] };
  ownsChildren: boolean;
  isLayout: boolean;
  deletesChildren: boolean;
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  /** String sides only; functions are tracked by convertible. */
  conversion: { import?: string; export?: string };
  /** A side counts when it is a string or a function. */
  convertible: { import: boolean; export: boolean };
  assetKind?: string;
  hasPrepareInsert: boolean;
}

export interface SnapshotBlock {
  name: string;
  title: string;
  description: BlockToolDescription | null;
  statics: SnapshotBlockStatics;
  insertable: boolean;
  inlineTools: string[];
  tunes: string[];
  handlers: string[];
}

export interface ToolRegistrySnapshot {
  blokVersion: string;
  readOnly: boolean;
  defaultBlock: string;
  services: HostService[];
  blocks: SnapshotBlock[];
  inlineTools: Array<{ name: string; title: string; description: InlineToolDescription | null; sanitizeTags: string[]; shortcut?: string }>;
  tunes: Array<{ name: string; description: BlockTuneDescription | null }>;
}

export type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;

export interface CommandEntry {
  name: CommandName;
  summary: string;
  guidance?: string;
  args: BlokSchema;
  result?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  source: 'core' | { tool: string; target: 'block' | 'create' };
  requires?: HostService[];
  effects?: 'host';
  available: boolean;
  unavailableReason?: 'runtime' | 'service';
}

export interface AgentGuidance {
  general: string;
  commands: Record<string, string>;
  tools: Record<string, string>;
}

export interface AgentContract {
  formatVersion: 1;
  revision: string;
  commands: CommandEntry[];
  manifest: BlokToolManifest;
  guidance: AgentGuidance;
}

export interface BlokCustomToolsFile {
  formatVersion: 1;
  blocks: Array<{
    name: string;
    description: BlockToolDescription;
    statics: SnapshotBlockStatics;
    /** JSON object/boolean rules only; absent rich-field rules use global inline rules. */
    sanitize?: Record<string, unknown>;
  }>;
}
