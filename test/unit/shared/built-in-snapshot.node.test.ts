// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { buildToolManifest } from '../../../src/shared/tool-manifest';
import type { HostService, ToolActionImpl } from '../../../types';

// Keep the Node test independent of the DOM-loading builtInEditorTools helper.
const BLOCK_NAMES = [
  'paragraph', 'header', 'list', 'table', 'toggle', 'callout', 'database', 'database-row',
  'divider', 'spacer', 'table_of_contents', 'quote', 'code', 'image', 'file', 'audio', 'video',
  'column_list', 'column', 'tabs', 'tab', 'embed', 'bookmark', 'page', 'page-link',
];
const INLINE_NAMES = [
  'convertTo', 'marker', 'bold', 'italic', 'underline', 'clearFormat', 'link',
  'strikethrough', 'inlineCode', 'equation', 'supSub',
];
const TUNE_NAMES = ['delete', 'copyLink'];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildBuiltInSnapshot in Node', () => {
  it('builds the complete described registry and manifest without a DOM', () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');

    const snapshot = buildBuiltInSnapshot({ blokVersion: '1.0.0' });
    const manifest = buildToolManifest(snapshot);

    expect(snapshot.blocks).toHaveLength(25);
    expect(snapshot.blocks.map(block => block.name)).toEqual(BLOCK_NAMES);
    expect(snapshot.inlineTools.map(tool => tool.name)).toEqual(INLINE_NAMES);
    expect(snapshot.tunes.map(tune => tune.name)).toEqual(TUNE_NAMES);
    expect(manifest.blocks.map(block => block.name)).toEqual(BLOCK_NAMES);
    expect(manifest.inlineTools.map(tool => tool.name)).toEqual(INLINE_NAMES);
    expect(manifest.tunes.map(tune => tune.name)).toEqual(TUNE_NAMES);

    for (const block of manifest.blocks) {
      expect(block.level, block.name).toBe('described');
      expect(block.summary.trim().length, block.name).toBeGreaterThan(0);
    }
    for (const tool of manifest.inlineTools) {
      expect(tool.level, tool.name).toBe('described');
      expect(tool.summary.trim().length, tool.name).toBeGreaterThan(0);
    }
    for (const tune of manifest.tunes) {
      expect(tune.level, tune.name).toBe('described');
      expect(tune.summary.trim().length, tune.name).toBeGreaterThan(0);
    }

    const code = snapshot.blocks.find(block => block.name === 'code');
    const manifestCode = manifest.blocks.find(block => block.name === 'code');

    if (code === undefined || manifestCode === undefined) {
      throw new Error('The built-in registry and manifest must contain code.');
    }

    expect(code.inlineTools).toEqual([]);
    expect(manifestCode.inlineTools).toEqual([]);

    const roundTrip: unknown = JSON.parse(JSON.stringify(snapshot));

    expect(roundTrip).toEqual(snapshot);
  });

  it('defaults to a writable paragraph registry with no services', () => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'default-version' });

    expect({
      blokVersion: snapshot.blokVersion,
      readOnly: snapshot.readOnly,
      defaultBlock: snapshot.defaultBlock,
      services: snapshot.services,
    }).toEqual({
      blokVersion: 'default-version',
      readOnly: false,
      defaultBlock: 'paragraph',
      services: [],
    });
  });

  it.each([false, true])('preserves readOnly=%s and the supplied service order', readOnly => {
    const services: HostService[] = ['pageBackend', 'host', 'uploader', 'linkMetadata'];
    const input = { blokVersion: 'configured-version', readOnly, services };
    const baseline = buildBuiltInSnapshot({ blokVersion: 'baseline-version' });
    const snapshot = buildBuiltInSnapshot(input);

    expect(snapshot).toEqual({
      ...baseline,
      blokVersion: 'configured-version',
      readOnly,
      services: ['pageBackend', 'host', 'uploader', 'linkMetadata'],
    });
    expect(input).toEqual({
      blokVersion: 'configured-version',
      readOnly,
      services: ['pageBackend', 'host', 'uploader', 'linkMetadata'],
    });
  });

  it('uses the runtime action keys for every registered block', () => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'runtime-version' });

    expect(snapshot.blocks.map(block => block.name)).toEqual(BLOCK_NAMES);

    for (const block of snapshot.blocks) {
      const runtime = BUILT_IN_TOOL_RUNTIMES.get(block.name);

      if (runtime === undefined) {
        throw new Error(`The built-in runtime is missing "${block.name}".`);
      }

      expect(block.handlers, block.name).toEqual(Object.keys(runtime.actions));
    }
  });

  it('takes handler names and their order from the runtime, not the description', () => {
    const runtimes = new Map(BUILT_IN_TOOL_RUNTIMES);
    const paragraphRuntime = runtimes.get('paragraph');

    if (paragraphRuntime === undefined) {
      throw new Error('The paragraph runtime is missing.');
    }

    const actions: Readonly<Record<string, ToolActionImpl>> = {
      secondProbe: { run: () => undefined },
      firstProbe: { run: () => undefined },
    };

    vi.spyOn(BUILT_IN_TOOL_RUNTIMES, 'get').mockImplementation(name =>
      name === 'paragraph' ? { ...paragraphRuntime, actions } : runtimes.get(name)
    );

    const snapshot = buildBuiltInSnapshot({ blokVersion: 'handler-source-version' });
    const paragraph = snapshot.blocks.find(block => block.name === 'paragraph');

    if (paragraph === undefined) {
      throw new Error('The built-in snapshot is missing paragraph.');
    }

    expect(paragraph.handlers).toEqual(['secondProbe', 'firstProbe']);
  });
});
