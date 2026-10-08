import { afterEach, beforeEach, describe, expectTypeOf, it, vi } from 'vitest';

import type {
  AgentContract,
  AgentGuidance,
  BlockToolConstructable,
  BlockToolDescription,
  BlockToolManifestEntry,
  BlockTuneConstructable,
  BlockTuneDescription,
  BlokCustomToolsFile,
  BlokSchema,
  BlokToolManifest,
  CommandEntry,
  CommandName,
  HostService,
  InlineToolConstructable,
  InlineToolDescription,
  InlineToolManifestEntry,
  ManifestAction,
  ManifestOverrides,
  SnapshotBlock,
  SnapshotBlockStatics,
  ToolActionDeclaration,
  ToolCommandName,
  ToolRegistrySnapshot,
  TuneManifestEntry,
} from '../../../types';
import type { DescribeBlockTool } from '../../../types/tools';

describe('published tool description types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows optional synchronous descriptions on block, inline and tune tools', () => {
    expectTypeOf<BlockToolConstructable['describe']>()
      .toEqualTypeOf<((config: Record<string, unknown>) => BlockToolDescription) | undefined>();
    expectTypeOf<InlineToolConstructable['describe']>()
      .toEqualTypeOf<((config: Record<string, unknown>) => InlineToolDescription) | undefined>();
    expectTypeOf<BlockTuneConstructable['describe']>()
      .toEqualTypeOf<((config: Record<string, unknown>) => BlockTuneDescription) | undefined>();
    expectTypeOf<DescribeBlockTool>()
      .toEqualTypeOf<(config: Record<string, unknown>) => BlockToolDescription>();
    expectTypeOf<Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>['describe']>()
      .toEqualTypeOf<BlockToolConstructable['describe']>();
  });

  it('keeps schemas readonly and host services closed', () => {
    expectTypeOf<BlokSchema>().toEqualTypeOf<{ readonly [keyword: string]: unknown }>();
    expectTypeOf<HostService>().toEqualTypeOf<'uploader' | 'linkMetadata' | 'pageBackend' | 'host'>();
  });

  it('declares action schemas, targets, runtime and host dependencies', () => {
    expectTypeOf<ToolActionDeclaration>().toEqualTypeOf<{
      name: string;
      summary: string;
      guidance?: string;
      args: BlokSchema;
      result?: BlokSchema;
      target: 'block' | 'create';
      runtime?: 'any' | 'editor';
      effects?: 'host';
      preconditions?: string[];
      requires?: HostService[];
      uses?: HostService[];
      mirrors?: string[];
    }>();
    expectTypeOf<ToolActionDeclaration['target']>().toEqualTypeOf<'block' | 'create'>();
  });

  it('describes block data, outline fields and protected fields', () => {
    expectTypeOf<BlockToolDescription>().toEqualTypeOf<{
      summary: string;
      guidance?: string;
      data: BlokSchema;
      defaultData?: Record<string, unknown>;
      examples?: Array<Record<string, unknown>>;
      summaryFields?: string[];
      inputFields?: string[];
      viewState?: string[];
      guardedFields?: Record<string, string>;
      actions?: ToolActionDeclaration[];
    }>();
  });

  it('supports marks, multiple marks, embeds and clearing marks', () => {
    expectTypeOf<InlineToolDescription>().toEqualTypeOf<{
      summary: string;
      effect:
        | { mark: string; value: BlokSchema }
        | { marks: string[]; value: BlokSchema }
        | { embed: string; value: BlokSchema }
        | { clears: 'marks' };
    }>();
    expectTypeOf<BlockTuneDescription>().toEqualTypeOf<{ summary: string; data: BlokSchema | null }>();
  });

  it('uses command names owned by the agent declarations', () => {
    expectTypeOf<ManifestAction>().toEqualTypeOf<{
      name: string;
      summary: string;
      guidance?: string;
      args: BlokSchema;
      result?: BlokSchema;
      target: 'block' | 'create';
      runtime?: 'any' | 'editor';
      effects?: 'host';
      preconditions?: string[];
      requires?: HostService[];
      uses?: HostService[];
      mirrors?: string[];
      command: ToolCommandName;
      available: boolean;
    }>();
    expectTypeOf<CommandEntry>().toEqualTypeOf<{
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
    }>();
  });

  it('publishes block manifest structure and available actions', () => {
    expectTypeOf<BlockToolManifestEntry>().toEqualTypeOf<{
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
    }>();
  });

  it('allows structural inline tools without an effect and tunes without saved data', () => {
    expectTypeOf<InlineToolManifestEntry>().toEqualTypeOf<{
      name: string;
      title: string;
      summary: string;
      level: 'described' | 'structural';
      effect?: InlineToolDescription['effect'];
      shortcut?: string;
    }>();
    expectTypeOf<TuneManifestEntry>().toEqualTypeOf<{
      name: string;
      summary: string;
      level: 'described' | 'structural';
      data: BlokSchema | null;
    }>();
  });

  it('records conversion support separately from string conversion fields', () => {
    expectTypeOf<SnapshotBlockStatics>().toEqualTypeOf<{
      toolbox: Array<{ name: string; title: string; data?: Record<string, unknown>; previewCaption?: string }>;
      richTextFields: string[];
      acceptsChildren: boolean;
      childTools?: { allow?: string[]; deny?: string[] };
      ownsChildren: boolean;
      isLayout: boolean;
      deletesChildren: boolean;
      selfPlacesChildren: boolean;
      restrictedInTableCell: boolean;
      conversion: { import?: string; export?: string };
      convertible: { import: boolean; export: boolean };
      assetKind?: string;
      hasPrepareInsert: boolean;
    }>();
  });

  it('records descriptions, handler availability and host services in snapshots', () => {
    expectTypeOf<SnapshotBlock>().toEqualTypeOf<{
      name: string;
      title: string;
      description: BlockToolDescription | null;
      statics: SnapshotBlockStatics;
      insertable: boolean;
      inlineTools: string[];
      tunes: string[];
      handlers: string[];
    }>();
    expectTypeOf<ToolRegistrySnapshot>().toEqualTypeOf<{
      blokVersion: string;
      readOnly: boolean;
      defaultBlock: string;
      services: HostService[];
      blocks: SnapshotBlock[];
      inlineTools: Array<{
        name: string;
        title: string;
        description: InlineToolDescription | null;
        sanitizeTags: string[];
        shortcut?: string;
      }>;
      tunes: Array<{ name: string; description: BlockTuneDescription | null }>;
    }>();
  });

  it('carries snapshot statics and optional sanitize rules in custom tools files', () => {
    expectTypeOf<BlokCustomToolsFile>().toEqualTypeOf<{
      formatVersion: 1;
      blocks: Array<{
        name: string;
        description: BlockToolDescription;
        statics: SnapshotBlockStatics;
        sanitize?: Record<string, unknown>;
      }>;
    }>();
    expectTypeOf<BlokCustomToolsFile['blocks'][number]['statics']>()
      .toEqualTypeOf<ToolRegistrySnapshot['blocks'][number]['statics']>();
  });

  it('puts the manifest and guidance inside the agent contract', () => {
    expectTypeOf<BlokToolManifest>().toEqualTypeOf<{
      formatVersion: 1;
      blokVersion: string;
      revision: string;
      readOnly: boolean;
      defaultBlock: string;
      blocks: BlockToolManifestEntry[];
      inlineTools: InlineToolManifestEntry[];
      tunes: TuneManifestEntry[];
    }>();
    expectTypeOf<AgentGuidance>().toEqualTypeOf<{
      general: string;
      commands: Record<string, string>;
      tools: Record<string, string>;
    }>();
    expectTypeOf<AgentContract>().toEqualTypeOf<{
      formatVersion: 1;
      revision: string;
      commands: CommandEntry[];
      manifest: BlokToolManifest;
      guidance: AgentGuidance;
    }>();
    expectTypeOf<AgentContract['manifest']>().toEqualTypeOf<BlokToolManifest>();
    expectTypeOf<ManifestOverrides>()
      .toEqualTypeOf<Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>>();
  });
});
