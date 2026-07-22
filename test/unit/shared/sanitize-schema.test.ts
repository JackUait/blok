import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeBaseSanitizeConfig, defineBlokSchema } from '../../../src/shared/sanitize-schema';

import { Core } from '../../../src/components/core';
import { BoldInlineTool } from '../../../src/components/inline-tools/inline-tool-bold';
import { ItalicInlineTool } from '../../../src/components/inline-tools/inline-tool-italic';
import { LinkInlineTool } from '../../../src/components/inline-tools/inline-tool-link';
import { MarkerInlineTool } from '../../../src/components/inline-tools/inline-tool-marker';
import { UnderlineInlineTool } from '../../../src/components/inline-tools/inline-tool-underline';
import { Header } from '../../../src/tools/header';
import { Paragraph } from '../../../src/tools/paragraph';

import type { SanitizerConfig } from '../../../types';

/**
 * Replaces function rules with a stable marker so configs holding
 * fresh-closure function rules (e.g. Marker) can be compared structurally.
 * @param config - sanitizer config to normalize
 * @returns JSON-safe structural clone with functions replaced by '[function]'
 */
const normalizeFunctionRules = (config: SanitizerConfig): unknown => {
  return JSON.parse(JSON.stringify(config, (_key: string, value: unknown) => {
    return typeof value === 'function' ? '[function]' : value;
  }));
};

/**
 * Minimal replica of Blok.destroy()'s module teardown so a Core booted
 * directly (to reach moduleInstances) does not leak listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      markDestroyed?: () => void;
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

describe('composeBaseSanitizeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty config for an empty list', () => {
    expect(composeBaseSanitizeConfig([])).toEqual({});
  });

  it('merges configs with later-wins semantics (Object.assign order)', () => {
    const first: SanitizerConfig = {
      b: {},
      a: { href: true },
    };
    const second: SanitizerConfig = {
      a: { href: true, target: true },
      u: {},
    };

    expect(composeBaseSanitizeConfig([first, second])).toEqual({
      b: {},
      a: { href: true, target: true },
      u: {},
    });
  });

  it('replaces (not deep-merges) a rule when a later config redefines the same tag', () => {
    const first: SanitizerConfig = { a: { href: true, rel: true } };
    const second: SanitizerConfig = { a: { target: true } };

    expect(composeBaseSanitizeConfig([first, second])).toEqual({ a: { target: true } });
  });

  it('preserves function rules by reference', () => {
    const rule = (): { [attr: string]: boolean } => ({ style: true });
    const composed = composeBaseSanitizeConfig([{ mark: rule }, { b: {} }]);

    expect(composed.mark).toBe(rule);
  });

  it('does not mutate the input configs', () => {
    const first: SanitizerConfig = { b: {} };
    const second: SanitizerConfig = { u: {} };

    composeBaseSanitizeConfig([first, second]);

    expect(first).toEqual({ b: {} });
    expect(second).toEqual({ u: {} });
  });
});

describe('defineBlokSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the passed config verbatim as editorConfig', () => {
    const config = {
      tools: {
        paragraph: { class: Paragraph },
        bold: { class: BoldInlineTool },
      },
    };

    const { editorConfig } = defineBlokSchema(config);

    expect(editorConfig).toBe(config);
  });

  it('exposes resolved tools with their classes and settings', () => {
    const { viewSchema } = defineBlokSchema({
      tools: {
        paragraph: {
          class: Paragraph,
          inlineToolbar: true,
        },
        bold: BoldInlineTool,
      },
    });

    expect(viewSchema.tools.paragraph?.toolClass).toBe(Paragraph);
    expect(viewSchema.tools.paragraph?.settings).toEqual({ inlineToolbar: true });
    expect(viewSchema.tools.bold?.toolClass).toBe(BoldInlineTool);
    expect(viewSchema.tools.bold?.settings).toEqual({});
  });

  it('composes baseSanitize from the enabled inline tools statics', () => {
    const { viewSchema } = defineBlokSchema({
      tools: {
        paragraph: { class: Paragraph },
        bold: { class: BoldInlineTool },
        link: { class: LinkInlineTool },
      },
    });

    expect(viewSchema.baseSanitize).toEqual({
      strong: {},
      b: {},
      a: {
        href: true,
        target: true,
        rel: true,
      },
    });
  });

  it('returns an empty baseSanitize when inlineToolbar is disabled globally', () => {
    const { viewSchema } = defineBlokSchema({
      tools: {
        paragraph: { class: Paragraph },
        bold: { class: BoldInlineTool },
      },
      inlineToolbar: false,
    });

    expect(viewSchema.baseSanitize).toEqual({});
  });

  it('respects an inlineToolbar array as the enabled-tools list', () => {
    const { viewSchema } = defineBlokSchema({
      tools: {
        paragraph: { class: Paragraph },
        bold: { class: BoldInlineTool },
        link: { class: LinkInlineTool },
      },
      inlineToolbar: [ 'bold' ],
    });

    expect(viewSchema.baseSanitize).toEqual({
      strong: {},
      b: {},
    });
  });

  it('is callable without any DOM globals (purity)', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    const { viewSchema } = defineBlokSchema({
      tools: {
        paragraph: { class: Paragraph },
        bold: { class: BoldInlineTool },
        marker: { class: MarkerInlineTool },
      },
    });

    expect(viewSchema.baseSanitize).toMatchObject({
      strong: {},
      b: {},
    });
  });
});

describe('defineBlokSchema drift guard against a live editor', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core) {
      destroyCore(core);
    }
    core = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('produces the exact baseSanitizeConfig a real editor composes for the same config', async () => {
    const tools = {
      paragraph: {
        class: Paragraph,
        inlineToolbar: true,
      },
      header: {
        class: Header,
        inlineToolbar: true,
      },
      bold: { class: BoldInlineTool },
      italic: { class: ItalicInlineTool },
      underline: { class: UnderlineInlineTool },
      link: { class: LinkInlineTool },
    };

    core = new Core({
      holder,
      tools,
    });
    await core.isReady;

    const paragraphAdapter = core.moduleInstances.Tools.blockTools.get('paragraph');

    expect(paragraphAdapter).toBeDefined();

    const { viewSchema } = defineBlokSchema({ tools });

    expect(viewSchema.baseSanitize).toEqual(paragraphAdapter?.baseSanitizeConfig);
  }, 60_000);

  it('matches structurally when function rules are present (Marker)', async () => {
    const tools = {
      paragraph: {
        class: Paragraph,
        inlineToolbar: true,
      },
      bold: { class: BoldInlineTool },
      marker: { class: MarkerInlineTool },
    };

    core = new Core({
      holder,
      tools,
    });
    await core.isReady;

    const paragraphAdapter = core.moduleInstances.Tools.blockTools.get('paragraph');

    expect(paragraphAdapter).toBeDefined();

    const { viewSchema } = defineBlokSchema({ tools });

    const editorConfig = paragraphAdapter?.baseSanitizeConfig;

    expect(editorConfig).toBeDefined();
    expect(Object.keys(viewSchema.baseSanitize)).toEqual(Object.keys(editorConfig ?? {}));
    expect(normalizeFunctionRules(viewSchema.baseSanitize)).toEqual(normalizeFunctionRules(editorConfig ?? {}));
  }, 60_000);

  it('respects a global inlineToolbar array the same way the editor does', async () => {
    const tools = {
      paragraph: {
        class: Paragraph,
        inlineToolbar: true,
      },
      bold: { class: BoldInlineTool },
      italic: { class: ItalicInlineTool },
      link: { class: LinkInlineTool },
    };

    core = new Core({
      holder,
      tools,
      inlineToolbar: [ 'bold', 'italic' ],
    });
    await core.isReady;

    const paragraphAdapter = core.moduleInstances.Tools.blockTools.get('paragraph');

    expect(paragraphAdapter).toBeDefined();

    const { viewSchema } = defineBlokSchema({
      tools,
      inlineToolbar: [ 'bold', 'italic' ],
    });

    expect(viewSchema.baseSanitize).toEqual(paragraphAdapter?.baseSanitizeConfig);
  }, 60_000);
});

describe('baseSanitizeConfig delegation law', () => {
  it('BlockToolAdapter.baseSanitizeConfig delegates to composeBaseSanitizeConfig', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const source = fs
      .readFileSync(path.resolve(__dirname, '../../../src/components/tools/block.ts'), 'utf-8')
      // Comments must not satisfy the law — only a real call inside the getter.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const getterMatch = source.match(
      /get baseSanitizeConfig\(\)[^{]*\{([\s\S]*?)\n {2}\}/
    );

    expect(getterMatch).not.toBeNull();
    // The merge itself must run through the shared composition function — the
    // single source of truth defineBlokSchema also uses. A hand-rolled
    // Object.assign fold here would re-fork the composition semantics.
    expect(getterMatch?.[1]).toContain('composeBaseSanitizeConfig(');
    expect(getterMatch?.[1]).not.toContain('Object.assign');
  });
});
