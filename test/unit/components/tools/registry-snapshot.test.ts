import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetKind,
  BlokConfig,
  BlockTool,
  BlockToolData,
  BlockToolDescription,
  BlockTune,
  BlockTuneDescription,
  ConversionConfig,
  InlineToolDescription,
  MenuConfig,
  SanitizerConfig,
  SnapshotBlock,
  ToolActionImpl,
  ToolConfig,
  ToolRegistrySnapshot,
  ToolSanitizerConfig,
} from '../../../../types';
import type { ChildToolRestrictions } from '../../../../types/tools';
import { Core } from '../../../../src/components/core';
import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { ItalicInlineTool } from '../../../../src/components/inline-tools/inline-tool-italic';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { snapshotFromTools, runtimesFromTools } from '../../../../src/components/tools/registry-snapshot';
import * as logger from '../../../../src/components/utils/logger';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { BUILT_IN_RUNTIME_PARTS } from '../../../../src/shared/tool-actions';
import { describeTable } from '../../../../src/shared/tool-descriptions/table';
import { buildToolManifest } from '../../../../src/shared/tool-manifest';
import { Callout, Header, Paragraph, Table } from '../../../../src/tools';

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null &&
  'markDestroyed' in value && typeof value.markDestroyed === 'function';

const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';

const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  typeof value === 'object' && value !== null && 'listeners' in value &&
  typeof value.listeners === 'object' && value.listeners !== null &&
  'removeAll' in value.listeners && typeof value.listeners.removeAll === 'function';

const destroyCore = async (core: Core): Promise<void> => {
  const modules: unknown[] = Object.values(core.moduleInstances);
  const pending: Array<void | Promise<void>> = [];

  // Mark every module before any destroy hook runs.
  modules.filter(hasMarkDestroyed).forEach(instance => instance.markDestroyed());

  for (const instance of modules) {
    if (hasDestroy(instance)) {
      pending.push(instance.destroy());
    }
    if (hasListeners(instance)) {
      instance.listeners.removeAll();
    }
  }

  destroyTooltip();
  await Promise.all(pending);
};

const blockNamed = (snapshot: ToolRegistrySnapshot, name: string): SnapshotBlock => {
  const block = snapshot.blocks.find(entry => entry.name === name);

  if (block === undefined) {
    throw new Error(`Snapshot does not contain block "${name}".`);
  }

  return block;
};

const snapshotOf = (core: Core): ToolRegistrySnapshot => snapshotFromTools(core.moduleInstances.Tools, {
  blokVersion: 'test',
  readOnly: false,
  defaultBlock: 'paragraph',
  services: [],
  i18n: core.moduleInstances.I18n,
});

class BareBlock implements BlockTool {
  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): BlockToolData {
    return {};
  }
}

class BadgeTune implements BlockTune {
  public static isTune = true;

  public static get sanitize(): SanitizerConfig {
    return { small: {} };
  }

  public static describe(config: ToolConfig): BlockTuneDescription {
    return {
      summary: typeof config.label === 'string' ? config.label : 'Badge tune',
      data: { type: 'object', additionalProperties: true },
    };
  }

  public render(): MenuConfig {
    return { title: 'Badge', onActivate: () => undefined };
  }
}

class FieldBlock extends Paragraph {
  public static get sanitize(): ToolSanitizerConfig {
    return { text: {} };
  }
}

class ContractBlock extends Paragraph {
  public static get childTools(): ChildToolRestrictions {
    return { allow: ['paragraph'], deny: ['header'] };
  }

  public static get acceptsChildren(): boolean {
    return false;
  }

  public static get ownsChildren(): boolean {
    return true;
  }

  public static get isLayout(): boolean {
    return true;
  }

  public static get deletesChildren(): boolean {
    return true;
  }

  public static get assetKind(): AssetKind {
    return 'image';
  }

  public static get conversionConfig(): ConversionConfig {
    return { import: (text: string) => ({ text: [{ text }] }), export: 'text' };
  }

  public static prepareInsert(): BlockToolData {
    return { text: [] };
  }
}

class ActionBlock extends Paragraph {
  public static actionHandlers: Readonly<Record<string, ToolActionImpl>> = {
    apply: { run: () => undefined },
    extra: { run: () => undefined },
  };

  public static describe = (): BlockToolDescription => ({
    summary: 'A block with named actions',
    data: { type: 'object', additionalProperties: true },
    actions: [
      { name: 'apply', summary: 'Apply a change', args: { type: 'object' }, target: 'block' },
      { name: 'missing', summary: 'An unavailable change', args: { type: 'object' }, target: 'block' },
    ],
  });
}

class BorrowedTableDescription extends Paragraph {
  public static describe = describeTable;
}

class DerivedTable extends Table {}

class DerivedCallout extends Callout {}

describe('browser tool registry snapshot', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await destroyCore(core);
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
      vi.restoreAllMocks();
    }
  });

  const boot = async (config: BlokConfig = {}): Promise<Core> => {
    if (holder === undefined) {
      throw new Error('The test holder is missing.');
    }

    const instance = new Core({
      holder,
      tabSync: false,
      i18n: { locale: 'en' },
      tools: { paragraph: Paragraph },
      ...config,
    });

    core = instance;
    await instance.isReady;

    return instance;
  };

  it('preserves the supplied registry context', async () => {
    const instance = await boot();
    const snapshot = snapshotFromTools(instance.moduleInstances.Tools, {
      blokVersion: 'test-version',
      readOnly: true,
      defaultBlock: 'paragraph',
      services: ['host'],
      i18n: instance.moduleInstances.I18n,
    });

    expect(snapshot).toMatchObject({
      blokVersion: 'test-version',
      readOnly: true,
      defaultBlock: 'paragraph',
      services: ['host'],
    });
  });

  it('uses localized, config-filtered heading variants and the configured description', async () => {
    const instance = await boot({
      tools: {
        paragraph: Paragraph,
        header: { class: Header, levels: [1, 3], defaultLevel: 3 },
      },
      i18n: {
        locale: 'en',
        messages: {
          'tools.header.heading1': 'Level one',
          'tools.header.heading3': 'Level three',
          'tools.header.toggleHeading1': 'Toggle one',
          'tools.header.toggleHeading3': 'Toggle three',
          'toolbox.preview.heading1': 'First heading caption',
          'toolbox.preview.heading3': 'Third heading caption',
          'toolbox.preview.toggleHeading': 'Toggle caption',
        },
      },
    });
    const snapshot = snapshotOf(instance);
    const header = blockNamed(snapshot, 'header');

    expect(header.statics.toolbox).toEqual([
      { name: 'header-1', title: 'Level one', data: { level: 1 }, previewCaption: 'First heading caption' },
      { name: 'header-3', title: 'Level three', data: { level: 3 }, previewCaption: 'Third heading caption' },
      { name: 'toggle-header-1', title: 'Toggle one', data: { level: 1, isToggleable: true }, previewCaption: 'Toggle caption' },
      { name: 'toggle-header-3', title: 'Toggle three', data: { level: 3, isToggleable: true }, previewCaption: 'Toggle caption' },
    ]);
    expect(header.title).toBe('Level one');
    expect(header.description?.data).toMatchObject({ properties: { level: { type: 'integer', enum: [1, 3] } } });
    expect(header.description?.defaultData).toEqual({ text: [], level: 3 });
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'header')?.level).toBe('described');
  });

  it('keeps a hidden tool in the registry but removes its insertion variants', async () => {
    const instance = await boot({
      tools: { paragraph: Paragraph, header: { class: Header, toolbox: false } },
    });
    const snapshot = snapshotOf(instance);
    const header = blockNamed(snapshot, 'header');

    expect(header.insertable).toBe(false);
    expect(header.statics.toolbox).toEqual([]);
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'header')).toMatchObject({
      insertable: false,
      variants: [],
      level: 'described',
    });
    expect(runtimesFromTools(instance.moduleInstances.Tools).has('header')).toBe(true);
  });

  it('does not treat a tool without a toolbox declaration as host-hidden', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, bare: BareBlock } });
    const snapshot = snapshotOf(instance);
    const bare = blockNamed(snapshot, 'bare');

    expect(bare.statics.convertible).toEqual({ import: false, export: false });
    expect(bare.statics.conversion).toEqual({});
    expect(bare.insertable).toBe(true);
    expect(bare.statics.toolbox).toEqual([]);
    expect(bare.description).toBeNull();
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'bare')).toMatchObject({
      level: 'structural',
      data: { type: 'object', additionalProperties: true },
      convertsTo: [],
    });
  });

  it('projects one-way conversion flags and their manifest relationships', async () => {
    class ImportOnlyBlock extends Paragraph {
      public static get conversionConfig(): ConversionConfig {
        return { import: 'text' };
      }
    }
    class ExportOnlyBlock extends Paragraph {
      public static get conversionConfig(): ConversionConfig {
        return { export: () => 'exported text' };
      }
    }
    const instance = await boot({
      tools: { paragraph: Paragraph, bare: BareBlock, importOnly: ImportOnlyBlock, exportOnly: ExportOnlyBlock },
    });
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'importOnly').statics.convertible).toEqual({ import: true, export: false });
    expect(blockNamed(snapshot, 'exportOnly').statics.convertible).toEqual({ import: false, export: true });
    expect(blockNamed(snapshot, 'importOnly').statics.conversion).toEqual({ import: 'text' });
    expect(blockNamed(snapshot, 'exportOnly').statics.conversion).toEqual({});

    const manifest = buildToolManifest(snapshot);

    expect(manifest.blocks.find(block => block.name === 'exportOnly')?.convertsTo).toEqual(['paragraph', 'importOnly']);
    expect(manifest.blocks.find(block => block.name === 'importOnly')?.convertsTo).toEqual([]);
    expect(manifest.blocks.find(block => block.name === 'bare')?.convertsTo).toEqual([]);
    expect(manifest.blocks.find(block => block.name === 'paragraph')?.convertsTo).toEqual(['importOnly']);
  });

  it('reflects public toolbox updates on the next snapshot', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, header: Header } });
    const before = snapshotOf(instance);

    instance.moduleInstances.ToolsAPI.methods.update('header', { toolbox: false });
    const hidden = snapshotOf(instance);

    expect(blockNamed(hidden, 'header').insertable).toBe(false);
    expect(blockNamed(hidden, 'header').statics.toolbox).toEqual([]);
    expect(blockNamed(before, 'header').insertable).toBe(true);

    instance.moduleInstances.ToolsAPI.methods.update('header', { toolbox: undefined });

    expect(blockNamed(snapshotOf(instance), 'header').insertable).toBe(true);
  });

  it('excludes the internal stub from snapshots and runtimes', async () => {
    const instance = await boot();
    const snapshot = snapshotOf(instance);
    const runtimes = runtimesFromTools(instance.moduleInstances.Tools);

    expect(snapshot.blocks.map(block => block.name)).not.toContain('stub');
    expect(runtimes.has('stub')).toBe(false);
    expect(instance.moduleInstances.Tools.blockTools.get('stub')?.isInternal).toBe(true);
    expect(snapshot.blocks.map(block => block.name)).toContain('paragraph');
    expect(runtimes.has('paragraph')).toBe(true);
  });

  it('projects container, rich-text, asset and conversion facts from the adapter', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, contract: ContractBlock } });
    const block = blockNamed(snapshotOf(instance), 'contract');

    expect(block.statics).toMatchObject({
      richTextFields: ['text'],
      acceptsChildren: false,
      childTools: { allow: ['paragraph'], deny: ['header'] },
      ownsChildren: true,
      isLayout: true,
      deletesChildren: true,
      assetKind: 'image',
      hasPrepareInsert: true,
      conversion: { export: 'text' },
      convertible: { import: true, export: true },
    });
    expect(block.statics.conversion).toEqual({ export: 'text' });
  });

  it('keeps core placement and table-cell restrictions keyed by registration name', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, table: Table, grid: Table } });
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'grid').statics.selfPlacesChildren).toBe(false);
    expect(blockNamed(snapshot, 'grid').statics.restrictedInTableCell).toBe(false);
    expect(blockNamed(snapshot, 'table').statics.selfPlacesChildren).toBe(true);
    expect(blockNamed(snapshot, 'table').statics.restrictedInTableCell).toBe(true);
    expect(blockNamed(snapshot, 'grid').statics.ownsChildren).toBe(true);
  });

  it('falls back to structural facts and logs the error when a description throws', async () => {
    const failure = new Error('description failed');
    class ThrowingBlock extends Paragraph {
      public static describe = (): never => {
        throw failure;
      };
    }
    const instance = await boot({ tools: { paragraph: Paragraph, odd: ThrowingBlock } });
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'odd').description).toBeNull();
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'odd')).toMatchObject({
      level: 'structural',
      richTextFields: ['text'],
      data: {
        type: 'object',
        additionalProperties: true,
        properties: { text: { oneOf: [{ type: 'array' }, { type: 'string' }] } },
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/odd.*describe.*structural/i),
      'warn',
      failure,
    );
    expect(runtimesFromTools(instance.moduleInstances.Tools).has('odd')).toBe(true);
  });

  it('falls back and logs the original error when a describe accessor throws', async () => {
    const failure = new Error('description accessor failed');
    class ThrowingDescriptionAccessor extends BareBlock {
      public static get describe(): (config: ToolConfig) => BlockToolDescription {
        throw failure;
      }
    }
    const instance = await boot({ tools: { paragraph: Paragraph, accessor: ThrowingDescriptionAccessor } });
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'accessor').description).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/accessor.*describe.*structural/i), 'warn', failure);

    const manifest = buildToolManifest(snapshot);

    expect(manifest.blocks.find(block => block.name === 'accessor')?.level).toBe('structural');
    expect(manifest.blocks.find(block => block.name === 'paragraph')?.level).toBe('described');
  });

  it('reads a describe accessor once and invokes it on the registered class', async () => {
    let reads = 0;
    let receiver: unknown;
    class CountedDescriptionAccessor extends BareBlock {
      public static get describe(): (config: ToolConfig) => BlockToolDescription {
        reads += 1;

        return function (this: unknown, config: ToolConfig): BlockToolDescription {
          receiver = this;

          return {
            summary: typeof config.label === 'string' ? config.label : 'Default accessor description',
            data: { type: 'object', additionalProperties: true },
          };
        };
      }
    }
    const instance = await boot({
      tools: { paragraph: Paragraph, accessor: { class: CountedDescriptionAccessor, label: 'Configured accessor description' } },
    });
    const readsBeforeSnapshot = reads;
    const snapshot = snapshotOf(instance);

    expect(reads - readsBeforeSnapshot).toBe(1);
    expect(receiver).toBe(CountedDescriptionAccessor);
    expect(blockNamed(snapshot, 'accessor').description?.summary).toBe('Configured accessor description');
  });

  it('falls back for throwing inline and tune descriptions while other entries survive', async () => {
    const inlineFailure = new Error('inline description failed');
    const tuneFailure = new Error('tune description failed');
    class ThrowingInline extends BoldInlineTool {
      public static describe = (): never => {
        throw inlineFailure;
      };
    }
    class ThrowingTune extends BadgeTune {
      public static describe = (): never => {
        throw tuneFailure;
      };
    }
    const instance = await boot({
      tools: { paragraph: Paragraph, bold: BoldInlineTool, oddInline: ThrowingInline, badge: BadgeTune, oddTune: ThrowingTune },
    });
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const snapshot = snapshotOf(instance);

    expect(snapshot.inlineTools.find(tool => tool.name === 'oddInline')?.description).toBeNull();
    expect(snapshot.tunes.find(tune => tune.name === 'oddTune')?.description).toBeNull();

    const manifest = buildToolManifest(snapshot);
    const inline = manifest.inlineTools.find(tool => tool.name === 'oddInline');

    expect(inline).toMatchObject({
      level: 'structural',
      summary: 'Custom inline tool oddInline. Leave its marks as they are.',
    });
    expect(inline).not.toHaveProperty('effect');
    expect(manifest.tunes.find(tune => tune.name === 'oddTune')).toMatchObject({
      level: 'structural',
      data: { type: 'object', additionalProperties: true },
    });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/oddInline.*describe.*structural/i), 'warn', inlineFailure);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/oddTune.*describe.*structural/i), 'warn', tuneFailure);
    expect(manifest.inlineTools.find(tool => tool.name === 'bold')).toMatchObject({
      level: 'described',
      effect: { mark: 'bold', value: { const: true } },
    });
    expect(manifest.tunes.find(tune => tune.name === 'badge')).toMatchObject({ level: 'described', summary: 'Badge tune' });
    expect(blockNamed(snapshot, 'paragraph').name).toBe('paragraph');
  });

  it('reports effective inline membership, including global filtering and live disable', async () => {
    const instance = await boot({
      tools: { paragraph: Paragraph, bold: BoldInlineTool, italic: ItalicInlineTool },
      inlineToolbar: ['italic'],
    });

    expect(blockNamed(snapshotOf(instance), 'paragraph').inlineTools).toEqual(['italic']);
    expect(instance.moduleInstances.Tools.inlineTools.has('bold')).toBe(true);

    instance.moduleInstances.ToolsAPI.methods.setInlineToolbar(false);

    expect(blockNamed(snapshotOf(instance), 'paragraph').inlineTools).toEqual([]);
  });

  it('resolves per-block inline choices and opt-outs through the real collections', async () => {
    const instance = await boot({
      tools: {
        paragraph: { class: Paragraph, inlineToolbar: ['bold', 'missingInline'] },
        quiet: { class: Paragraph, inlineToolbar: false },
        bold: BoldInlineTool,
        italic: ItalicInlineTool,
      },
    });
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'paragraph').inlineTools).toEqual(['convertTo', 'bold']);
    expect(blockNamed(snapshot, 'quiet').inlineTools).toEqual([]);
  });

  it('reports assigned tunes rather than every registered tune or missing name', async () => {
    const instance = await boot({
      tools: {
        paragraph: Paragraph,
        chosen: { class: Paragraph, tunes: ['badge', 'missingTune'] },
        quiet: { class: Paragraph, tunes: false },
        badge: { class: BadgeTune, label: 'Host badge description' },
      },
    });
    const snapshot = snapshotOf(instance);

    expect(blockNamed(snapshot, 'paragraph').tunes).toEqual(['delete', 'copyLink']);
    expect(blockNamed(snapshot, 'chosen').tunes).toEqual(['badge', 'delete', 'copyLink']);
    expect(blockNamed(snapshot, 'quiet').tunes).toEqual([]);
    expect(snapshot.tunes.find(tune => tune.name === 'badge')?.description).toEqual({
      summary: 'Host badge description',
      data: { type: 'object', additionalProperties: true },
    });
  });

  it('uses the global tune list when a block does not select its own tunes', async () => {
    const instance = await boot({
      tools: { paragraph: Paragraph, badge: BadgeTune },
      tunes: ['badge'],
    });

    expect(blockNamed(snapshotOf(instance), 'paragraph').tunes).toEqual(['badge', 'delete', 'copyLink']);
  });

  it('reads inline titles, sanitize tags and configured shortcuts from real adapters', async () => {
    const instance = await boot({
      tools: {
        paragraph: Paragraph,
        bold: { class: BoldInlineTool, shortcut: 'CMD+SHIFT+B' },
      },
      i18n: { locale: 'ru', messages: { 'toolNames.bold': 'Полужирный' } },
    });
    const snapshot = snapshotOf(instance);

    expect(snapshot.inlineTools.find(tool => tool.name === 'bold')).toMatchObject({
      name: 'bold',
      title: 'Bold',
      sanitizeTags: ['strong', 'b'],
      shortcut: 'CMD+SHIFT+B',
    });
    expect(instance.moduleInstances.I18n.t('toolNames.bold')).toBe('Полужирный');
  });

  it('reads configured inline descriptions and their described manifest effects', async () => {
    class ConfiguredInline extends BoldInlineTool {
      public static describe = (config: ToolConfig = {}): InlineToolDescription => ({
        summary: typeof config.label === 'string' ? config.label : 'Default inline description',
        effect: { mark: 'bold', value: { const: true } },
      });
    }
    const instance = await boot({
      tools: { paragraph: Paragraph, configuredInline: { class: ConfiguredInline, label: 'Host inline description' } },
    });
    const snapshot = snapshotOf(instance);

    expect(snapshot.inlineTools.find(tool => tool.name === 'configuredInline')?.description).toEqual({
      summary: 'Host inline description',
      effect: { mark: 'bold', value: { const: true } },
    });
    expect(buildToolManifest(snapshot).inlineTools.find(tool => tool.name === 'configuredInline')).toMatchObject({
      level: 'described',
      summary: 'Host inline description',
      effect: { mark: 'bold', value: { const: true } },
    });
  });

  it('uses handler keys and retains the class action implementations by reference', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, widget: ActionBlock } });
    const snapshot = snapshotOf(instance);
    const manifest = buildToolManifest(snapshot);

    expect(blockNamed(snapshot, 'widget').handlers).toEqual(['apply', 'extra']);
    expect(manifest.blocks.find(block => block.name === 'widget')?.actions.map(action => ({
      command: action.command,
      available: action.available,
    }))).toEqual([
      { command: 'widget.apply', available: true },
      { command: 'widget.missing', available: false },
    ]);
    expect(runtimesFromTools(instance.moduleInstances.Tools).get('widget')?.actions).toBe(ActionBlock.actionHandlers);
  });

  it('retains the adapter-composed sanitizer, including inline and tune rules, by identity', async () => {
    const instance = await boot({
      tools: {
        paragraph: { class: FieldBlock, inlineToolbar: ['bold', 'marker'], tunes: ['badge'] },
        bold: BoldInlineTool,
        marker: MarkerInlineTool,
        badge: BadgeTune,
      },
    });
    const adapter = instance.moduleInstances.Tools.blockTools.get('paragraph');

    if (adapter === undefined) {
      throw new Error('The paragraph adapter is missing.');
    }

    const sanitize = adapter.sanitizeConfig;
    const runtime = runtimesFromTools(instance.moduleInstances.Tools).get('paragraph');

    expect(runtime?.sanitize).toBe(sanitize);
    expect(runtime?.sanitize).toMatchObject({ text: { strong: {}, b: {}, small: {} } });
    expect(typeof adapter.baseSanitizeConfig.mark).toBe('function');
    expect(runtime?.sanitize).toBe(adapter.sanitizeConfig);
  });

  it('gives aliases the runtime parts of the exact built-in classes', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, grid: Table, note: Callout } });
    const runtimes = runtimesFromTools(instance.moduleInstances.Tools);
    const tableParts = BUILT_IN_RUNTIME_PARTS.table;
    const calloutParts = BUILT_IN_RUNTIME_PARTS.callout;

    if (tableParts?.normalize === undefined || calloutParts?.defaultChildren === undefined) {
      throw new Error('Task13 built-in runtime parts are missing.');
    }

    expect(runtimes.get('grid')?.normalize).toBe(tableParts.normalize);
    expect(runtimes.get('note')?.defaultChildren).toBe(calloutParts.defaultChildren);
    expect(runtimes.get('note')?.defaultChildren).toEqual([{ type: 'paragraph', data: { text: [] } }]);
    expect(runtimes.get('grid')?.name).toBe('grid');
    expect(runtimes.get('note')?.name).toBe('note');
  });

  it('does not grant built-in runtime parts to a custom class registered under a built-in name', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, table: Paragraph, callout: Paragraph } });
    const runtimes = runtimesFromTools(instance.moduleInstances.Tools);

    expect(runtimes.get('table')?.normalize).toBeUndefined();
    expect(runtimes.get('callout')?.defaultChildren).toBeUndefined();
    expect(runtimes.has('table')).toBe(true);
    expect(runtimes.has('callout')).toBe(true);
  });

  it('does not identify an unrelated class by its borrowed built-in description function', async () => {
    const instance = await boot({ tools: { paragraph: Paragraph, counterfeit: BorrowedTableDescription } });
    const runtimes = runtimesFromTools(instance.moduleInstances.Tools);

    expect(runtimes.get('counterfeit')?.normalize).toBeUndefined();
    expect(runtimes.has('counterfeit')).toBe(true);
    expect(BorrowedTableDescription.describe).toBe(describeTable);
  });

  it('does not grant inherited runtime parts to subclasses of built-in classes', async () => {
    const instance = await boot({
      tools: { paragraph: Paragraph, derivedTable: DerivedTable, derivedCallout: DerivedCallout },
    });
    const runtimes = runtimesFromTools(instance.moduleInstances.Tools);

    expect(runtimes.get('derivedTable')?.normalize).toBeUndefined();
    expect(runtimes.get('derivedCallout')?.defaultChildren).toBeUndefined();
    expect(runtimes.has('derivedTable')).toBe(true);
    expect(runtimes.has('derivedCallout')).toBe(true);
  });
});
