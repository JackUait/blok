import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { BUILT_IN_RUNTIME_PARTS, BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { buildToolRuntimes, composeToolSanitize } from '../../../../src/shared/tool-actions/runtime';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/inline';
import { defaultBlockTools, defaultInlineTools } from '../../../../src/tools';
import { BLOCK_CLASSES, INLINE_CLASSES, builtInEditorTools } from '../tool-descriptions/built-in-tools';

import type { SanitizerConfig } from '../../../../types';
import type { InsertSpec } from '../../../../types/agent';
import type { ToolActionImpl } from '../../../../types/tools/tool-description';

const BLOCK_KEYS = [
  'paragraph', 'header', 'list', 'table', 'toggle', 'callout', 'database', 'database-row',
  'divider', 'spacer', 'table_of_contents', 'quote', 'code', 'image', 'file', 'audio', 'video',
  'column_list', 'column', 'tabs', 'tab', 'embed', 'bookmark', 'page', 'page-link',
];

const INLINE_KEYS = [
  'marker', 'bold', 'italic', 'underline', 'clearFormat', 'link', 'strikethrough', 'inlineCode', 'equation', 'supSub',
];

const shape = (config: SanitizerConfig): string => JSON.stringify(
  config,
  (_key, value: unknown) => typeof value === 'function' ? `[fn ${value.name}]` : value
);

const destroyCore = (core: Core): void => {
  const modules: unknown[] = Object.values(core.moduleInstances);

  for (const module of modules) {
    if (typeof module === 'object' && module !== null
      && 'markDestroyed' in module && typeof module.markDestroyed === 'function') {
      module.markDestroyed();
    }
  }

  for (const module of modules) {
    if (typeof module !== 'object' || module === null) {
      continue;
    }

    if ('destroy' in module && typeof module.destroy === 'function') {
      module.destroy();
    }

    if ('listeners' in module && typeof module.listeners === 'object' && module.listeners !== null
      && 'removeAll' in module.listeners && typeof module.listeners.removeAll === 'function') {
      module.listeners.removeAll();
    }
  }

  destroyTooltip();
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('composeToolSanitize', () => {
  it('folds inline rules into object field rules and passes booleans through', () => {
    expect(composeToolSanitize(
      { text: { p: true }, level: false, checked: true },
      [{ b: {} }, { a: { href: true } }]
    )).toEqual({
      text: { b: {}, a: { href: true }, p: true },
      level: false,
      checked: true,
    });
  });

  it('uses the inline fold when the tool has no own rules', () => {
    expect(composeToolSanitize({}, [{ b: {} }])).toEqual({ b: {} });
  });

  it('returns an empty config when neither own nor inline rules exist', () => {
    expect(composeToolSanitize({}, [])).toEqual({});
  });

  it('replaces a tag rule with the later inline or tune rule instead of deep merging', () => {
    expect(composeToolSanitize(
      { text: {} },
      [{ a: { href: true, rel: true } }, { a: { target: true } }, { a: false }]
    )).toEqual({ text: { a: false } });
  });

  it('lets own field rules override the base fold', () => {
    expect(composeToolSanitize(
      { text: { a: false, b: true } },
      [{ a: { href: true }, b: {}, u: {} }]
    )).toEqual({ text: { a: false, b: true, u: {} } });
  });

  it('preserves function rules by reference in the fold and in scalar fields', () => {
    const firstRule = (): boolean => true;
    const lastRule = (): boolean => false;
    const fieldRule = (): boolean => true;
    const composed = composeToolSanitize(
      { text: {}, custom: fieldRule, code: 'plaintext' },
      [{ mark: firstRule }, { mark: lastRule }]
    );
    const text: unknown = composed.text;

    expect(composed.custom).toBe(fieldRule);
    expect(composed.code).toBe('plaintext');

    if (typeof text !== 'object' || text === null || !('mark' in text)) {
      throw new Error('Expected composed text rules');
    }

    expect(text.mark).toBe(lastRule);
    expect(composeToolSanitize({}, [{ mark: firstRule }]).mark).toBe(firstRule);
  });

  it('merges null-prototype object rules as plain objects', () => {
    const field = { p: true };

    Object.setPrototypeOf(field, null);

    expect(composeToolSanitize({ text: field }, [{ b: {} }])).toEqual({
      text: { b: {}, p: true },
    });
  });

  it('does not copy inherited fields', () => {
    const own: SanitizerConfig = { level: false };

    Object.setPrototypeOf(own, { inherited: true });

    expect(composeToolSanitize(own, [{ b: {} }])).toEqual({ level: false });
  });

  it('leaves inputs unchanged and returns fresh root and field objects', () => {
    const field = Object.freeze({ p: true });
    const own = Object.freeze({ text: field, level: false });
    const inline: SanitizerConfig[] = [Object.freeze({ b: Object.freeze({}) })];
    const first = composeToolSanitize(own, inline);
    const second = composeToolSanitize(own, inline);

    expect(first).not.toBe(second);
    expect(first.text).not.toBe(second.text);
    expect(first.text).not.toBe(field);
    expect(own).toEqual({ text: { p: true }, level: false });
    expect(inline).toEqual([{ b: {} }]);

    const emptyOwn: SanitizerConfig = {};
    const folded = composeToolSanitize(emptyOwn, inline);

    expect(folded).not.toBe(emptyOwn);
    expect(folded).not.toBe(inline[0]);
    expect(folded).not.toBe(composeToolSanitize(emptyOwn, inline));
  });
});

describe('buildToolRuntimes', () => {
  it('builds a registry keyed by name with composed sanitizer and empty actions', () => {
    const registry = buildToolRuntimes([
      { name: 'x', ownSanitize: { text: {} }, inlineSanitize: [{ b: {} }] },
      { name: 'y', ownSanitize: {}, inlineSanitize: [] },
    ]);

    expect([...registry.keys()]).toEqual(['x', 'y']);
    expect(registry.get('x')).toEqual({ name: 'x', sanitize: { text: { b: {} } }, actions: {} });
    expect(registry.get('y')).toEqual({ name: 'y', sanitize: {}, actions: {} });
  });

  it('omits absent optional runtime parts', () => {
    const runtime = buildToolRuntimes([{ name: 'x', ownSanitize: {}, inlineSanitize: [] }]).get('x');

    expect(runtime).toEqual({ name: 'x', sanitize: {}, actions: {} });
    expect(runtime).not.toHaveProperty('normalize');
    expect(runtime).not.toHaveProperty('defaultChildren');
  });

  it('carries normalization, children and canonical action handlers by reference without executing them', () => {
    const normalize = vi.fn((data: Record<string, unknown>): Record<string, unknown> => ({ ...data }));
    const run = vi.fn(() => 'result');
    const prepare = vi.fn(() => Promise.resolve('prepared'));
    const actions: Readonly<Record<string, ToolActionImpl>> = { apply: { run, prepare } };
    const defaultChildren: InsertSpec[] = [{ type: 'paragraph', data: { text: 'child' } }];
    const runtime = buildToolRuntimes([{
      name: 'x', ownSanitize: {}, inlineSanitize: [], normalize, defaultChildren, actions,
    }]).get('x');

    expect(runtime?.normalize).toBe(normalize);
    expect(runtime?.defaultChildren).toBe(defaultChildren);
    expect(runtime?.actions).toBe(actions);
    expect(runtime?.actions.apply?.run).toBe(run);
    expect(runtime?.actions.apply?.prepare).toBe(prepare);
    expect(normalize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('creates independent registries and sanitizer outputs without changing the inputs', () => {
    const ownSanitize = Object.freeze({ text: Object.freeze({ p: true }) });
    const inlineSanitize: SanitizerConfig[] = [Object.freeze({ b: Object.freeze({}) })];
    const blocks = [{ name: 'x', ownSanitize, inlineSanitize }];
    const first = buildToolRuntimes(blocks);
    const second = buildToolRuntimes(blocks);

    expect(first).not.toBe(second);
    expect(first.get('x')).not.toBe(second.get('x'));
    expect(first.get('x')?.sanitize).not.toBe(second.get('x')?.sanitize);
    expect(first.get('x')?.sanitize.text).not.toBe(second.get('x')?.sanitize.text);
    expect(first.get('x')?.actions).not.toBe(second.get('x')?.actions);
    expect(blocks).toEqual([{ name: 'x', ownSanitize: { text: { p: true } }, inlineSanitize: [{ b: {} }] }]);
  });
});

describe('BUILT_IN_TOOL_RUNTIMES', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await core.isReady.catch(() => undefined);
        destroyCore(core);
      }
    } finally {
      holder.remove();
      core = undefined;
    }
  });

  it('registers exactly all 25 built-in block keys, including both page tools', () => {
    expect([...BUILT_IN_TOOL_RUNTIMES.keys()].sort()).toEqual([...BLOCK_KEYS].sort());
    expect(Object.keys(BUILT_IN_BLOCK_SANITIZE).sort()).toEqual([...BLOCK_KEYS].sort());
    expect(Object.keys(BLOCK_CLASSES).sort()).toEqual([...BLOCK_KEYS].sort());
    expect(BUILT_IN_TOOL_RUNTIMES.size).toBe(25);
  });

  it('uses the ten default inline tools in the current registration order', () => {
    expect(Object.keys(defaultInlineTools)).toEqual(INLINE_KEYS);
    expect(Object.keys(INLINE_CLASSES)).toEqual(INLINE_KEYS);
    expect(Object.keys(BUILT_IN_INLINE_SANITIZE)).toEqual(INLINE_KEYS);
    expect(defaultBlockTools.code.inlineToolbar).toBe(false);
    expect(Object.keys(builtInEditorTools())).toEqual([...BLOCK_KEYS, ...INLINE_KEYS]);
  });

  it('registers only the table normalizer without actions or child seeds', () => {
    const normalize = BUILT_IN_RUNTIME_PARTS.table?.normalize;

    expect(typeof normalize).toBe('function');
    expect(BUILT_IN_RUNTIME_PARTS).toEqual({ table: { normalize } });
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.normalize).toBe(normalize);

    for (const runtime of BUILT_IN_TOOL_RUNTIMES.values()) {
      expect(runtime.actions, runtime.name).toEqual({});
      if (runtime.name !== 'table') {
        expect(runtime, runtime.name).not.toHaveProperty('normalize');
      }
      expect(runtime, runtime.name).not.toHaveProperty('defaultChildren');
    }
  });

  it('measures the enabled inline order, code opt-out and empty internal contributions in real adapters', async () => {
    core = new Core({ holder, tools: builtInEditorTools() });
    await core.isReady;

    const adapters = core.moduleInstances.Tools.blockTools;

    for (const name of BLOCK_KEYS) {
      const adapter = adapters.get(name);

      if (adapter === undefined) {
        throw new Error(`Missing block adapter for ${name}`);
      }

      expect([...adapter.inlineTools.keys()], name).toEqual(name === 'code' ? [] : ['convertTo', ...INLINE_KEYS]);
      expect([...adapter.tunes.keys()], name).toEqual(['delete', 'copyLink']);

      for (const tune of adapter.tunes.values()) {
        expect(tune.sanitizeConfig, `${name}:${tune.name}`).toEqual({});
      }

      if (name !== 'code') {
        expect(adapter.inlineTools.get('convertTo')?.sanitizeConfig, name).toEqual({});
      }
    }
  }, 60_000);

  it('matches effective sanitizer shapes and real sanitization for every booted built-in block adapter', async () => {
    core = new Core({ holder, tools: builtInEditorTools() });
    await core.isReady;

    const adapters = core.moduleInstances.Tools.blockTools;
    const html = '<strong>s</strong><i>i</i><u>u</u><s>x</s><code>c</code><sup>1</sup><sub>2</sub>'
      + '<mark style="color: red; position: fixed">m</mark>'
      + '<a data-blok-page-id="p1" href="/p/1">Cached title</a>'
      + '<a href="https://example.com" target="_self">link</a>'
      + '<span data-latex="x^2"><b>rendered cache</b></span><p>p</p><ul><li>list</li></ul>'
      + '<img src="https://example.com/i.png" alt="alt"><script>bad()</script>';

    expect([...adapters.keys()].filter(name => name !== 'stub').sort()).toEqual([...BLOCK_KEYS].sort());

    for (const name of BLOCK_KEYS) {
      const runtime = BUILT_IN_TOOL_RUNTIMES.get(name);
      const adapter = adapters.get(name);

      if (runtime === undefined || adapter === undefined) {
        throw new Error(`Missing runtime or adapter for ${name}`);
      }

      expect(shape(runtime.sanitize), name).toBe(shape(adapter.sanitizeConfig));

      const data = Object.fromEntries([...new Set(['text', ...Object.keys(adapter.sanitizeConfig)])].map(field => [field, html]));
      const blocks = [{ tool: name, data }];

      expect(sanitizeBlocks(blocks, runtime.sanitize), name).toEqual(sanitizeBlocks(blocks, adapter.sanitizeConfig));
    }

    expect(BUILT_IN_TOOL_RUNTIMES.get('code')?.sanitize).toEqual({ code: 'plaintext', filename: 'plaintext' });
  }, 60_000);

  it('keeps the editor global sanitizer separate from the runtime effective config', async () => {
    core = new Core({
      holder,
      tools: builtInEditorTools(),
      sanitizer: { globalOnly: true },
    });
    await core.isReady;

    const adapter = core.moduleInstances.Tools.blockTools.get('paragraph');
    const runtime = BUILT_IN_TOOL_RUNTIMES.get('paragraph');

    if (adapter === undefined || runtime === undefined) {
      throw new Error('Missing paragraph runtime or adapter');
    }

    expect(shape(runtime.sanitize)).toBe(shape(adapter.sanitizeConfig));
    expect(shape(runtime.sanitize)).not.toContain('globalOnly');
    expect(core.config.sanitizer).toEqual({ globalOnly: true });
  }, 60_000);
});
