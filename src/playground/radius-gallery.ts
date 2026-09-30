/**
 * Playground page for the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md). Each specimen is a tiny
 * real-looking component painted with the real token; px values are read
 * back from the browser, so the page cannot drift from colors.css.
 */

export interface RadiusToken {
  token: string;
}

export const RADIUS_PRIMITIVES: RadiusToken[] = [
  '0', '2', '4', '6', '8', '10', '12', '16', 'full',
].map((step) => ({ token: `--blok-radius-${step}` }));

type Specimen = 'dialog' | 'popover' | 'callout' | 'field' | 'button' | 'mark' | 'pill' | 'caret' | 'floor';

export interface RadiusRole extends RadiusToken {
  specimen: Specimen;
  /** Button height in px, for the three control roles. */
  height?: number;
}

export const RADIUS_ROLES: RadiusRole[] = [
  { token: '--blok-radius-dialog', specimen: 'dialog' },
  { token: '--blok-radius-surface', specimen: 'popover' },
  { token: '--blok-radius-block', specimen: 'callout' },
  { token: '--blok-radius-field', specimen: 'field' },
  { token: '--blok-radius-control-lg', specimen: 'button', height: 36 },
  { token: '--blok-radius-control', specimen: 'button', height: 28 },
  { token: '--blok-radius-control-sm', specimen: 'button', height: 20 },
  { token: '--blok-radius-mark', specimen: 'mark' },
  { token: '--blok-radius-pill', specimen: 'pill' },
  { token: '--blok-radius-notch', specimen: 'caret' },
  { token: '--blok-radius-floor', specimen: 'floor' },
];

export const FLOOR_PX = 4;

export interface InnerRadius {
  value: number | null;
  reason: 'derived' | 'floor' | 'own-role';
}

/**
 * The nesting rule. When border + gap reaches the outer radius, the child's
 * corner sits outside the parent's curve, so it keeps its own role.
 */
export const innerRadius = ({ outer, border, gap }: { outer: number; border: number; gap: number }): InnerRadius => {
  const inset = border + gap;

  if (inset >= outer) {
    return { value: null, reason: 'own-role' };
  }

  const derived = outer - inset;

  return derived < FLOOR_PX ? { value: FLOOR_PX, reason: 'floor' } : { value: derived, reason: 'derived' };
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  if (className !== undefined) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
};

const radius = <T extends HTMLElement>(node: T, value: string): T => {
  node.style.setProperty('border-radius', value);

  return node;
};

/** Paints a specimen with its role token and marks it as the preview. */
const painted = <T extends HTMLElement>(node: T, value: string): T => {
  node.setAttribute('data-radius-preview', '');

  return radius(node, value);
};

/** A gray placeholder line standing in for text. */
const line = (width: string): HTMLElement => {
  const bar = el('span', 'rg-line');

  bar.style.width = width;

  return bar;
};

/** Reads a token's px the browser really uses, by painting a probe with it. */
const makeProbe = (root: HTMLElement): ((token: string) => number) => {
  const probe = el('div', 'rg-probe');

  probe.setAttribute('aria-hidden', 'true');
  root.append(probe);

  return (token: string): number => {
    probe.style.borderRadius = `var(${token})`;

    return parseFloat(getComputedStyle(probe).borderTopLeftRadius) || 0;
  };
};

const pxLabel = (px: number): string => (px >= 999 ? 'full' : String(px));

const shortName = (token: string): string => token.replace('--blok-radius-', '');

const specimen = (role: RadiusRole): HTMLElement => {
  const value = `var(${role.token})`;

  switch (role.specimen) {
    case 'dialog': {
      const dialog = painted(el('div', 'rg-dialog'), value);
      const actions = el('div', 'rg-dialog__actions');

      actions.append(el('span', 'rg-btn', 'Cancel'), el('span', 'rg-btn rg-btn--primary', 'Leave'));
      dialog.append(line('70%'), line('90%'), actions);

      return dialog;
    }
    case 'popover': {
      const card = painted(el('div', 'rg-popover'), value);

      card.style.setProperty('--blok-radius-inner', 'max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-space-1)))');
      for (const [index, width] of ['60%', '45%', '70%'].entries()) {
        const row = radius(el('div', index === 0 ? 'rg-row rg-row--hover' : 'rg-row'), 'var(--blok-radius-inner)');

        row.append(el('span', 'rg-row__icon'), line(width));
        card.append(row);
      }

      return card;
    }
    case 'callout': {
      const callout = painted(el('div', 'rg-callout'), value);
      const body = el('div', 'rg-callout__body');

      body.append(line('85%'), line('55%'));
      callout.append(el('span', 'rg-callout__icon', '💡'), body);

      return callout;
    }
    case 'field':
      return painted(el('div', 'rg-field', 'Search'), value);
    case 'button': {
      const button = painted(el('div', 'rg-btn rg-btn--solid', 'Button'), value);

      button.style.height = `${role.height ?? 28}px`;

      return button;
    }
    case 'mark': {
      const text = el('div', 'rg-text', 'Use ');

      text.append(painted(el('span', 'rg-mark', 'npm'), value), document.createTextNode(' here'));

      return text;
    }
    case 'pill':
      return painted(el('div', 'rg-pill', 'Done'), value);
    case 'caret': {
      const text = el('div', 'rg-text rg-text--big', 'Ab');

      text.append(painted(el('span', 'rg-caret'), value));

      return text;
    }
    case 'floor': {
      // 10 − 8 would be 2; the floor holds the child at its own token.
      const box = radius(el('div', 'rg-nest'), '10px');
      const child = painted(el('div', 'rg-nest__child'), value);

      box.style.setProperty('padding', '8px');
      box.append(child);

      return box;
    }
  }
};

const section = (root: HTMLElement, title: string): HTMLElement => {
  const node = el('section', 'rg-section');

  node.append(el('h2', 'rg-title', title));
  root.append(node);

  return node;
};

const caption = (name: string, px: string): HTMLElement => {
  const text = el('div', 'rg-caption');

  text.append(el('span', 'rg-caption__name', name), el('span', 'rg-caption__px', px));

  return text;
};

const renderScale = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const row = el('div', 'rg-scale');

  for (const primitive of RADIUS_PRIMITIVES) {
    const tile = el('div', 'rg-scale__tile');

    tile.append(radius(el('div', 'rg-scale__shape'), `var(${primitive.token})`), el('span', 'rg-caption__px', pxLabel(pxOf(primitive.token))));
    row.append(tile);
  }

  section(root, 'Scale').append(row);
};

const renderRoles = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const grid = el('div', 'rg-roles');

  for (const role of RADIUS_ROLES) {
    const cell = el('div', 'rg-cell');
    const stage = el('div', 'rg-stage');
    const shape = specimen(role);

    cell.setAttribute('data-radius-role', role.token);
    stage.append(shape);
    cell.append(stage, caption(shortName(role.token), pxLabel(pxOf(role.token))));
    grid.append(cell);
  }

  section(root, 'Roles').append(grid);
};

/** Outer radii the demo offers, with the px to use before the stylesheet loads. */
const FALLBACK_PX: Record<string, number> = {
  '--blok-radius-surface': 10,
  '--blok-radius-dialog': 12,
  '--blok-radius-control-lg': 8,
};

const renderNesting = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'Nesting');
  const demo = el('div', 'rg-demo');
  const controls = el('div', 'rg-demo__controls');
  const outerSelect = el('select', 'rg-input');
  const gapInput = el('input', 'rg-input');
  const readout = el('div', 'rg-demo__readout');

  outerSelect.setAttribute('aria-label', 'Outer radius');
  outerSelect.setAttribute('data-radius-demo', 'outer');
  for (const token of Object.keys(FALLBACK_PX)) {
    const px = pxOf(token) || FALLBACK_PX[token];
    const option = el('option', undefined, `${px}px`);

    option.value = String(px);
    outerSelect.append(option);
  }
  outerSelect.value = String(pxOf('--blok-radius-surface') || 10);

  gapInput.type = 'range';
  gapInput.min = '0';
  gapInput.max = '14';
  gapInput.value = '4';
  gapInput.setAttribute('aria-label', 'Gap');
  gapInput.setAttribute('data-radius-demo', 'gap');
  readout.setAttribute('data-radius-demo', 'readout');

  controls.append(outerSelect, gapInput, readout);

  const figure = (mark: string): { wrap: HTMLElement; outer: HTMLElement; inner: HTMLElement } => {
    const wrap = el('figure', 'rg-demo__figure');
    const outer = el('div', 'rg-demo__outer');
    const inner = el('div', 'rg-demo__inner');

    outer.append(inner);
    wrap.append(outer, el('figcaption', `rg-verdict rg-verdict--${mark === '✓' ? 'yes' : 'no'}`, mark));

    return { wrap, outer, inner };
  };

  const right = figure('✓');
  const wrong = figure('✗');
  const stages = el('div', 'rg-demo__stages');

  stages.append(right.wrap, wrong.wrap);
  demo.append(stages, controls);
  node.append(demo);

  const update = (): void => {
    const outer = Number(outerSelect.value);
    const gap = Number(gapInput.value);
    const result = innerRadius({ outer, border: 0, gap });
    const own = pxOf('--blok-radius-control') || 6;
    const inner = result.value ?? own;

    for (const view of [right, wrong]) {
      view.outer.style.borderRadius = `${outer}px`;
      view.outer.style.padding = `${gap}px`;
    }
    right.inner.style.borderRadius = `${inner}px`;
    wrong.inner.style.borderRadius = `${outer}px`;

    if (result.reason === 'own-role') {
      readout.textContent = `${outer}−${gap} → own`;
    } else if (result.reason === 'floor') {
      readout.textContent = `${outer}−${gap} → ${inner}px`;
    } else {
      readout.textContent = `${outer}−${gap} = ${inner}px`;
    }
  };

  outerSelect.addEventListener('change', update);
  gapInput.addEventListener('input', update);
  update();
};

interface Example {
  outer: string;
  gap: number;
  children: number;
  layout: 'rows' | 'buttons';
}

/** Real containers in the editor, with the padding they really have. */
const EXAMPLES: Example[] = [
  { outer: '--blok-radius-surface', gap: 4, children: 3, layout: 'rows' },
  { outer: '--blok-radius-surface', gap: 8, children: 4, layout: 'buttons' },
  { outer: '--blok-radius-control-lg', gap: 3, children: 3, layout: 'buttons' },
];

const renderExamples = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const grid = el('div', 'rg-examples');

  for (const example of EXAMPLES) {
    const outer = pxOf(example.outer) || 10;
    const inner = innerRadius({ outer, border: 0, gap: example.gap }).value ?? outer;
    const cell = el('div', 'rg-cell');
    const stage = el('div', 'rg-stage rg-stage--zoom');
    const box = radius(el('div', `rg-mini rg-mini--${example.layout}`), `${outer}px`);

    box.style.padding = `${example.gap}px`;
    Array.from({ length: example.children }, (_, i) => radius(el('span', i === 0 ? 'rg-mini__child rg-mini__child--on' : 'rg-mini__child'), `${inner}px`))
      .forEach((child) => box.append(child));
    stage.append(box);
    cell.append(stage, caption(`${outer}−${example.gap}`, `${inner}`));
    grid.append(cell);
  }

  section(root, 'In the editor').append(grid);
};

const renderOutward = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const block = pxOf('--blok-radius-block') || 10;
  const gap = 8;
  const cell = el('div', 'rg-cell rg-cell--wide');
  const stage = el('div', 'rg-stage');
  const fill = radius(el('div', 'rg-selection'), `${block + gap}px`);
  const callout = radius(el('div', 'rg-callout'), `${block}px`);
  const body = el('div', 'rg-callout__body');

  fill.style.padding = `${gap}px`;
  body.append(line('85%'), line('55%'));
  callout.append(el('span', 'rg-callout__icon', '💡'), body);
  fill.append(callout);
  stage.append(fill);
  cell.append(stage, caption(`${block}+${gap}`, `${block + gap}`));

  section(root, 'Selection').append(cell);
};

export interface RadiusGalleryHandle {
  /** Rebuilds with the px the browser resolves now, if they changed. */
  refresh: () => void;
}

/** How long to wait for Blok's stylesheet before giving up on live values. */
const MAX_WAIT_FRAMES = 120;

export const renderRadiusGallery = ({ container }: { container: HTMLElement }): RadiusGalleryHandle => {
  const root = el('div', 'rg');

  // Blok's radius tokens are declared on [data-blok-interface] roots only.
  root.setAttribute('data-blok-interface', 'radius-gallery');
  container.append(root);

  const probeRoot = el('div');

  root.append(probeRoot);

  const pxOf = makeProbe(probeRoot);
  const content = el('div');

  root.append(content);

  // The surface px the current build used; 0 until the stylesheet loads.
  const built = { surface: -1 };

  const build = (): void => {
    built.surface = pxOf('--blok-radius-surface');
    content.replaceChildren(el('h1', 'rg-heading', 'Rounding'));
    renderScale(content, pxOf);
    renderRoles(content, pxOf);
    renderNesting(content, pxOf);
    renderExamples(content, pxOf);
    renderOutward(content, pxOf);
  };

  const refresh = (): void => {
    if (pxOf('--blok-radius-surface') !== built.surface) {
      build();
    }
  };

  build();

  // The stylesheet can load after this runs; the tokens read 0 until it does.
  const waitForTokens = (frame: number): void => {
    if (built.surface !== 0 || frame >= MAX_WAIT_FRAMES || !root.isConnected) {
      return;
    }
    refresh();
    requestAnimationFrame(() => waitForTokens(frame + 1));
  };

  requestAnimationFrame(() => waitForTokens(0));

  return { refresh };
};
