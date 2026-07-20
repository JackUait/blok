/**
 * Runtime theme-token updates.
 *
 * `config.style.tokens` injects a stylesheet targeting the wrapper AND the
 * body-mounted portal scopes, which is the only reason it can reach popovers.
 * But it ran exactly once, from UI.prepare() — so a host with a live
 * light/dark toggle could not use it: flipping a token meant destroying and
 * reconstructing the editor. That pushed hosts back onto a global
 * createGlobalStyle sheet hand-targeting
 * `[data-blok-interface], [data-blok-popover], [data-blok-top-layer]` —
 * re-implementing, in host code, the exact stylesheet Blok already injects.
 *
 * UI.setThemeTokens() makes the injected sheet re-writable at runtime with
 * replace semantics (the argument is the complete token set, mirroring the
 * config field), so a theme toggle is one call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UI } from '../../../../../src/components/modules/ui';
import type { BlokConfig } from '../../../../../types';

const PORTAL_SELECTOR = '[data-blok-interface], [data-blok-popover], [data-blok-top-layer]';

const createUI = (configOverrides: Partial<BlokConfig> = {}): UI => {
  const holder = document.createElement('div');

  holder.id = 'runtime-tokens-editor';
  document.body.appendChild(holder);

  const ui = new UI({
    config: {
      holder,
      minHeight: 50,
      ...configOverrides,
    } as BlokConfig,
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as UI['eventsDispatcher'],
  });

  (ui as unknown as { make: () => void }).make();

  return ui;
};

const tokenTags = (): HTMLStyleElement[] =>
  Array.from(document.head.querySelectorAll<HTMLStyleElement>('style')).filter(tag =>
    tag.id.startsWith('blok-theme-tokens-')
  );

describe('UI runtime theme tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    tokenTags().forEach(tag => tag.remove());
    vi.restoreAllMocks();
  });

  it('injects tokens set after construction, reaching the portal scopes', () => {
    const ui = createUI();

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    const tags = tokenTags();

    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toContain(PORTAL_SELECTOR);
    expect(tags[0]?.textContent).toContain('--blok-popover-bg: #1f1f1f;');
  });

  it('replaces the previous token set rather than accumulating tags', () => {
    const ui = createUI({ style: { tokens: { '--blok-popover-bg': '#ffffff' } } });

    (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();
    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    const tags = tokenTags();

    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toContain('--blok-popover-bg: #1f1f1f;');
    expect(tags[0]?.textContent).not.toContain('#ffffff');
  });

  it('drops tokens omitted from the new set (replace, not merge)', () => {
    const ui = createUI();

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f', '--blok-selection': 'red' });
    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    expect(tokenTags()[0]?.textContent).not.toContain('--blok-selection');
  });

  it('removes the stylesheet entirely when set to an empty token set', () => {
    const ui = createUI();

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });
    ui.setThemeTokens({});

    expect(tokenTags()).toHaveLength(0);
  });

  it('reports the currently applied tokens', () => {
    const ui = createUI();

    expect(ui.getThemeTokens()).toEqual({});

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    expect(ui.getThemeTokens()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('applies the same validation as the config path, skipping invalid entries', () => {
    const ui = createUI();

    ui.setThemeTokens({
      '--blok-popover-bg': '#1f1f1f',
      'color': 'red',
      '--blok-evil': 'red; } body { display: none',
      '--blok-editor-gutter-start': '56px',
    });

    const css = tokenTags()[0]?.textContent ?? '';

    expect(css).toContain('--blok-popover-bg: #1f1f1f;');
    expect(css).not.toContain('color: red');
    expect(css).not.toContain('--blok-evil');
    expect(css).not.toContain('--blok-editor-gutter-start');
    expect(ui.getThemeTokens()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });
});

/**
 * Regression: the runtime setter must survive the window between module
 * construction and UI.prepare().
 *
 * Core populates `moduleInstances` synchronously in constructModules() but
 * awaits each module's prepare() later, so `moduleInstances.UI` exists for a
 * stretch during which UI.make() has NOT run and `this.nodes.wrapper` is still
 * undefined. A host calling `editor.tokens.set()` shortly after `new Blok(...)`
 * lands in exactly that window, and the tag-id derivation
 * (`this.nodes.holder.id`) threw `Cannot read properties of undefined`.
 * Tokens set that early must be retained and injected once prepare() builds
 * the nodes.
 */
describe('UI theme tokens before nodes exist', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    tokenTags().forEach(tag => tag.remove());
    vi.restoreAllMocks();
  });

  const unpreparedUI = (): UI => {
    const holder = document.createElement('div');

    holder.id = 'early-tokens-editor';
    document.body.appendChild(holder);

    return new UI({
      config: { holder, minHeight: 50 } as BlokConfig,
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as UI['eventsDispatcher'],
    });
  };

  it('does not throw when called before UI.make() built the nodes', () => {
    const ui = unpreparedUI();

    expect(() => ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' })).not.toThrow();
  });

  it('retains the tokens so get() reflects them before prepare()', () => {
    const ui = unpreparedUI();

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    expect(ui.getThemeTokens()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('injects the retained tokens once prepare() builds the nodes', () => {
    const ui = unpreparedUI();

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });
    expect(tokenTags()).toHaveLength(0);

    (ui as unknown as { make: () => void }).make();
    (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

    expect(tokenTags()[0]?.textContent).toContain('--blok-popover-bg: #1f1f1f;');
  });

  it('lets early runtime tokens win over config.style.tokens', () => {
    const holder = document.createElement('div');

    holder.id = 'early-override-editor';
    document.body.appendChild(holder);

    const ui = new UI({
      config: {
        holder,
        minHeight: 50,
        style: { tokens: { '--blok-popover-bg': '#ffffff' } },
      } as BlokConfig,
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as UI['eventsDispatcher'],
    });

    ui.setThemeTokens({ '--blok-popover-bg': '#1f1f1f' });

    (ui as unknown as { make: () => void }).make();
    (ui as unknown as { loadThemeTokenStyles: () => void }).loadThemeTokenStyles();

    const css = tokenTags()[0]?.textContent ?? '';

    expect(css).toContain('--blok-popover-bg: #1f1f1f;');
    expect(css).not.toContain('#ffffff');
  });
});
