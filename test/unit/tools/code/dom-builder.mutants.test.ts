/**
 * Mutation coverage for `src/tools/code/dom-builder.ts`.
 *
 * Two recorded mutants are PROVEN equivalent and cannot be killed:
 *
 * 1. Line 183, `if (code)` becomes `if (true)`. `code` is typed `string`, so the
 *    only falsy value is `''`. The mutant then runs `codeElement.textContent = ''`
 *    on the `code` element created on line 179, which has no children yet.
 *    Per DOM "string replace all", an empty string appends no node, so both the
 *    `textContent` getter and `childNodes.length` read exactly the same before and
 *    after. Verified in jsdom: assigning `''` leaves `childNodes.length` at 0.
 *
 * 2. Line 239, `splitContainer AND previewElement` becomes `splitContainer OR
 *    previewElement`. Both operands come from the same `viewModeResult` through
 *    `?.x ?? null`, and `buildViewModeElements` always returns three freshly
 *    created elements. So the two are simultaneously null or simultaneously
 *    truthy — never mixed — which makes the two operators pick the same branch
 *    for every input the public API can produce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { VIEW_MODE_BUTTON_ACTIVE_STYLES, VIEW_MODE_BUTTON_STYLES } from '../../../../src/tools/code/constants';
import { buildCodeDOM, setActiveViewMode } from '../../../../src/tools/code/dom-builder';
import type { BuildCodeDOMOptions, CodeDOMRefs } from '../../../../src/tools/code/dom-builder';

const LABELS = {
  code: 'Code',
  preview: 'Preview',
  split: 'Side by side',
};

const build = (overrides: Partial<BuildCodeDOMOptions> = {}): CodeDOMRefs => buildCodeDOM({
  code: '',
  languageName: 'LaTeX',
  readOnly: false,
  copyLabel: 'Copy code',
  ...overrides,
});

const requireContainer = (refs: CodeDOMRefs): HTMLElement => {
  const { viewModeContainer } = refs;

  if (viewModeContainer === null) {
    throw new Error('expected a view mode container');
  }

  return viewModeContainer;
};

const modeButton = (container: HTMLElement, mode: string): HTMLButtonElement => {
  const found = container.querySelector(`[data-mode="${mode}"]`);

  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`expected a button for mode ${mode}`);
  }

  return found;
};

const headerOf = (refs: CodeDOMRefs): Element => {
  const header = refs.wrapper.children[0];

  if (header === undefined) {
    throw new Error('expected a header element');
  }

  return header;
};

describe('buildCodeDOM — attributes the code tool reads back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the wrapper with the tool name', () => {
    expect(build().wrapper.getAttribute(DATA_ATTR.tool)).toBe('code');
  });

  it('announces the language picker as a collapsed popup', () => {
    const { languageButton } = build();

    expect(languageButton.getAttribute('aria-haspopup')).toBe('listbox');
    expect(languageButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('gives the chevron its own layout class and testid', () => {
    const { languageChevron } = build();

    expect(languageChevron.className).toBe('inline-flex items-center ml-0.5 -mr-0.5');
    expect(languageChevron.getAttribute('data-blok-testid')).toBe('code-language-chevron');
  });

  it('pushes the controls to the right with a growing spacer', () => {
    const header = headerOf(build());

    expect(header.children[1].className).toBe('flex-1');
  });

  it('lets the pre element fill the code body width', () => {
    expect(build().preElement.className).toBe('flex-1 min-w-0');
  });
});

describe('buildCodeDOM — view mode segmented control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups three unpressed buttons that never submit a form', () => {
    const container = requireContainer(build({ previewable: true, viewModeLabels: LABELS }));

    expect(container.getAttribute('role')).toBe('group');

    for (const mode of ['code', 'preview', 'split']) {
      const button = modeButton(container, mode);

      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.className).toBe(VIEW_MODE_BUTTON_STYLES);
    }
  });

  it('hides the control for a language with no preview and shows it for one with a preview', () => {
    const hidden = requireContainer(build({ previewable: false, viewModeLabels: LABELS }));
    const shown = requireContainer(build({ previewable: true, viewModeLabels: LABELS }));

    expect(hidden.hidden).toBe(true);
    expect(shown.hidden).toBe(false);
  });

  it('hangs the split container off the wrapper in place of the bare code body', () => {
    const refs = build({ previewable: true, viewModeLabels: LABELS });

    expect(refs.wrapper.children).toHaveLength(2);
    expect(refs.wrapper.children[1]).toBe(refs.splitContainer);
  });
});

describe('setActiveViewMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('presses exactly the requested mode and restyles both sides', () => {
    const container = requireContainer(build({ previewable: true, viewModeLabels: LABELS }));

    setActiveViewMode(container, 'preview');

    const active = modeButton(container, 'preview');

    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.className).toBe(VIEW_MODE_BUTTON_ACTIVE_STYLES);

    for (const mode of ['code', 'split']) {
      const button = modeButton(container, mode);

      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.className).toBe(VIEW_MODE_BUTTON_STYLES);
    }
  });

  it('moves the pressed state when the mode changes', () => {
    const container = requireContainer(build({ previewable: true, viewModeLabels: LABELS }));

    setActiveViewMode(container, 'split');
    setActiveViewMode(container, 'code');

    expect(modeButton(container, 'code').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton(container, 'split').getAttribute('aria-pressed')).toBe('false');
    expect(modeButton(container, 'split').className).toBe(VIEW_MODE_BUTTON_STYLES);
  });
});
