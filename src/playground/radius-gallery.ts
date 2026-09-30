/**
 * Playground page for the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md). Every preview is painted
 * with the real token, and every px value is read back from the browser, so
 * the page cannot drift from colors.css.
 */

export interface RadiusToken {
  token: string;
  use: string;
}

export const RADIUS_PRIMITIVES: RadiusToken[] = [
  { token: '--blok-radius-0', use: 'Square' },
  { token: '--blok-radius-2', use: 'Tailwind xs' },
  { token: '--blok-radius-4', use: 'Tailwind sm' },
  { token: '--blok-radius-6', use: 'Tailwind md' },
  { token: '--blok-radius-8', use: 'Tailwind lg' },
  { token: '--blok-radius-10', use: 'Notion card' },
  { token: '--blok-radius-12', use: 'Tailwind xl' },
  { token: '--blok-radius-16', use: 'Tailwind 2xl' },
  { token: '--blok-radius-full', use: 'Pill' },
];

/** Preview box size per role, so each shape is shown at a size it is used at. */
type PreviewSize = 'card' | 'control' | 'small' | 'mark' | 'pill' | 'line';

export interface RadiusRole extends RadiusToken {
  size: PreviewSize;
}

export const RADIUS_ROLES: RadiusRole[] = [
  { token: '--blok-radius-dialog', size: 'card', use: 'Modal, leave banner, crop dialog, lightbox' },
  { token: '--blok-radius-surface', size: 'card', use: 'Popovers, menus, inline toolbar, toasts, emoji picker, find bar, floating toolbars, cards' },
  { token: '--blok-radius-block', size: 'card', use: 'Block frames: callout, code, image, video, audio, embed, bookmark, file' },
  { token: '--blok-radius-field', size: 'control', use: 'Text inputs and search fields' },
  { token: '--blok-radius-control-lg', size: 'control', use: 'Buttons 36px and taller, icon tiles' },
  { token: '--blok-radius-control', size: 'control', use: 'Buttons 24–32px, menu rows, tabs, tooltips, block hover and selection fill' },
  { token: '--blok-radius-control-sm', size: 'small', use: 'Controls up to 20px, checkbox, tags, keyboard hints, scrollbar thumb' },
  { token: '--blok-radius-mark', size: 'mark', use: 'Inline marks: code span, find match, highlight' },
  { token: '--blok-radius-pill', size: 'pill', use: 'Pills, badges, status chips, round handles, progress tracks' },
  { token: '--blok-radius-notch', size: 'line', use: 'Sub-step corners: crop-handle notches, caret ends' },
  { token: '--blok-radius-floor', size: 'small', use: 'Not a shape: the smallest radius a nested child may get' },
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

interface Example {
  container: string;
  outer: string;
  border: number;
  gap: number;
  child: string;
}

/** Real containers in the editor, with the padding they really have. */
const EXAMPLES: Example[] = [
  { container: 'Popover card', outer: '--blok-radius-surface', border: 0, gap: 4, child: 'menu rows, search field' },
  { container: 'Block settings, Turn into', outer: '--blok-radius-surface', border: 0, gap: 4, child: 'menu rows' },
  { container: 'Inline toolbar card', outer: '--blok-radius-surface', border: 0, gap: 8, child: 'toolbar buttons' },
  { container: 'Find bar', outer: '--blok-radius-surface', border: 0, gap: 6, child: 'icon and text buttons' },
  { container: 'Database column', outer: '--blok-radius-surface', border: 0, gap: 8, child: 'cards, add-card button' },
  { container: 'Placement picker track', outer: '--blok-radius-control-lg', border: 0, gap: 3, child: 'thumb, option buttons' },
  { container: 'Toast card', outer: '--blok-radius-surface', border: 1, gap: 12, child: 'thumbnail tile' },
];

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

const pxLabel = (px: number): string => (px >= 999 ? 'full' : `${px}px`);

const section = (root: HTMLElement, title: string, lead: string): HTMLElement => {
  const node = el('section', 'rg-section');

  node.append(el('h2', 'rg-title', title), el('p', 'rg-lead', lead));
  root.append(node);

  return node;
};

const code = (text: string): HTMLElement => {
  // Not <pre>/<code>: Blok's scoped preflight styles those as inline code.
  return el('div', 'rg-code', text);
};

const renderScale = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'Scale', 'One ordered set of steps. Components never use these directly; they use a role.');
  const grid = el('div', 'rg-scale');

  for (const primitive of RADIUS_PRIMITIVES) {
    const tile = el('div', 'rg-scale__tile');
    const shape = el('div', 'rg-scale__shape');

    shape.style.borderRadius = `var(${primitive.token})`;
    tile.append(shape, el('span', 'rg-mono', primitive.token), el('span', 'rg-muted', `${pxLabel(pxOf(primitive.token))} · ${primitive.use}`));
    grid.append(tile);
  }

  node.append(grid);
};

const renderRoles = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'Roles', 'Pick the role by what the element is. The role decides the radius.');
  const list = el('div', 'rg-roles');

  for (const role of RADIUS_ROLES) {
    const row = el('div', 'rg-role');
    const stage = el('div', 'rg-role__stage');
    const preview = el('div', `rg-preview rg-preview--${role.size}`);
    const meta = el('div', 'rg-role__meta');

    row.setAttribute('data-radius-role', role.token);
    preview.setAttribute('data-radius-preview', '');
    preview.style.borderRadius = `var(${role.token})`;
    stage.append(preview);
    meta.append(el('span', 'rg-mono', role.token), el('span', 'rg-role__px', pxLabel(pxOf(role.token))), el('p', 'rg-muted', role.use));
    row.append(stage, meta);
    list.append(row);
  }

  node.append(list);
};

const renderHeights = (root: HTMLElement): void => {
  const node = section(root, 'Controls follow height', 'A taller control gets a rounder corner. A mobile variant keeps the same role.');
  const row = el('div', 'rg-heights');

  for (const [height, token, range] of [
    [20, '--blok-radius-control-sm', 'up to 20px'],
    [28, '--blok-radius-control', '24–32px'],
    [36, '--blok-radius-control-lg', '36px and up'],
  ] as const) {
    const item = el('div', 'rg-heights__item');
    const button = el('div', 'rg-heights__button', 'Button');

    button.style.height = `${height}px`;
    button.style.borderRadius = `var(${token})`;
    item.append(button, el('span', 'rg-mono', token), el('span', 'rg-muted', range));
    row.append(item);
  }

  node.append(row);
};

const renderNesting = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'Nesting', 'A child near a rounded parent\'s corner shares its centre. Subtract the space between them.');

  node.append(code('inner = max(4px, outer − border − gap)'));

  const rules = el('ul', 'rg-rules');

  for (const text of [
    'gap is the parent\'s padding plus the child\'s margin at that corner.',
    'Never below 4px (--blok-radius-floor).',
    'If border + gap reaches the outer radius, the child keeps its own role.',
    'Pills and circles never derive. Their shape is height / 2.',
    'Derived values are exact, not snapped to the scale.',
    'A container computes --blok-radius-inner from its own tokens, never from --blok-radius-inner (a cycle resolves to 0).',
  ]) {
    rules.append(el('li', undefined, text));
  }

  node.append(rules);

  const demo = el('div', 'rg-demo');
  const controls = el('div', 'rg-demo__controls');
  const outerSelect = el('select', 'rg-input');
  const gapInput = el('input', 'rg-input');
  const borderInput = el('input', 'rg-input');
  const readout = el('p', 'rg-demo__readout');

  outerSelect.setAttribute('data-radius-demo', 'outer');
  readout.setAttribute('data-radius-demo', 'readout');
  for (const token of ['--blok-radius-surface', '--blok-radius-dialog', '--blok-radius-control-lg', '--blok-radius-16']) {
    const px = pxOf(token) || Number(token.match(/\d+$/)?.[0] ?? 10);
    const option = el('option', undefined, `${token.replace('--blok-radius-', '')} · ${px}px`);

    option.value = String(px);
    outerSelect.append(option);
  }
  outerSelect.value = String(pxOf('--blok-radius-surface') || 10);

  for (const [input, name, max, value] of [[gapInput, 'gap', 16, 4], [borderInput, 'border', 2, 0]] as const) {
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.value = String(value);
    input.setAttribute('data-radius-demo', name);
  }

  const labelled = (label: string, control: HTMLElement): HTMLElement => {
    const wrap = el('label', 'rg-demo__field');

    wrap.append(el('span', 'rg-muted', label), control);

    return wrap;
  };

  controls.append(labelled('Outer', outerSelect), labelled('Gap', gapInput), labelled('Border', borderInput), readout);

  const figure = (caption: string): { wrap: HTMLElement; outer: HTMLElement; inner: HTMLElement } => {
    const wrap = el('figure', 'rg-demo__figure');
    const outer = el('div', 'rg-demo__outer');
    const inner = el('div', 'rg-demo__inner');

    outer.append(inner);
    wrap.append(outer, el('figcaption', 'rg-muted', caption));

    return { wrap, outer, inner };
  };

  const right = figure('Concentric: the rule (shown at 2×)');
  const wrong = figure('Same radius: bulges at the corner');
  const stages = el('div', 'rg-demo__stages');

  stages.append(right.wrap, wrong.wrap);
  demo.append(controls, stages);
  node.append(demo);

  const update = (): void => {
    const outer = Number(outerSelect.value);
    const gap = Number(gapInput.value);
    const border = Number(borderInput.value);
    const result = innerRadius({ outer, border, gap });
    const own = pxOf('--blok-radius-control') || 6;
    const inner = result.value ?? own;

    for (const view of [right, wrong]) {
      view.outer.style.borderRadius = `${outer}px`;
      view.outer.style.padding = `${gap}px`;
      view.outer.style.borderWidth = `${border}px`;
    }
    right.inner.style.borderRadius = `${inner}px`;
    wrong.inner.style.borderRadius = `${outer}px`;

    readout.textContent = result.reason === 'own-role'
      ? `inner: own role (${own}px for a control), because border + gap ≥ outer`
      : `inner: ${inner}px${result.reason === 'floor' ? ' (the 4px floor)' : ` = ${outer} − ${border} − ${gap}`}`;
  };

  outerSelect.addEventListener('change', update);
  gapInput.addEventListener('input', update);
  borderInput.addEventListener('input', update);
  update();
};

const renderExamples = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'In the editor', 'Every rounded container publishes --blok-radius-inner for its children.');
  const table = el('table', 'rg-table');
  const head = el('tr');

  for (const title of ['Container', 'Outer', 'Border + gap', 'Children', 'Inner']) {
    head.append(el('th', undefined, title));
  }
  table.append(head);

  for (const example of EXAMPLES) {
    const outer = pxOf(example.outer) || 10;
    const result = innerRadius({ outer, border: example.border, gap: example.gap });
    const row = el('tr');

    row.append(
      el('td', undefined, example.container),
      el('td', 'rg-mono', `${outer}px`),
      el('td', 'rg-mono', `${example.border + example.gap}px`),
      el('td', 'rg-muted', example.child),
      el('td', 'rg-mono', result.value === null ? 'own role' : `${result.value}px`)
    );
    table.append(row);
  }

  node.append(table);
};

const renderOutward = (root: HTMLElement, pxOf: (token: string) => number): void => {
  const node = section(root, 'Selection follows the block', 'The rule runs outward too: a fill around a rounded block is the block\'s radius plus the gap.');
  const stage = el('div', 'rg-outward');
  const fill = el('div', 'rg-outward__fill');
  const block = el('div', 'rg-outward__block', 'Callout');
  const gap = 8;

  fill.style.padding = `${gap}px`;
  fill.style.borderRadius = `calc(var(--blok-radius-block) + ${gap}px)`;
  block.style.borderRadius = 'var(--blok-radius-block)';
  fill.append(block);
  stage.append(fill, el('p', 'rg-muted', `fill = ${pxOf('--blok-radius-block') || 10}px + ${gap}px`));
  node.append(stage, code([
    'class Callout {',
    '  // Core writes it on the content wrapper as --blok-radius-frame.',
    "  static frameRadius = 'var(--blok-radius-block)';",
    '}',
  ].join('\n')));
};

const renderUsage = (root: HTMLElement): void => {
  const node = section(root, 'Writing it', 'Checked on every run by test/unit/architecture/radius-law.test.ts.');

  node.append(code([
    '/* CSS: a container publishes the inner radius from its own tokens */',
    '.card {',
    '  border-radius: var(--blok-radius-surface);',
    '  padding: var(--blok-space-1);',
    '  --blok-radius-inner: max(var(--blok-radius-floor),',
    '    calc(var(--blok-radius-surface) - var(--blok-space-1)));',
    '}',
    '.card > .row { border-radius: var(--blok-radius-inner, var(--blok-radius-control)); }',
    '',
    '// TS: Tailwind v4 variable syntax',
    "'rounded-(--blok-radius-control)'",
  ].join('\n')));

  const donts = el('ul', 'rg-rules');

  for (const text of [
    'No raw px, no --blok-space-* or border-width token as a radius.',
    'No Tailwind radius steps (rounded-sm, rounded-lg…), no bare rounded, no rounded-[Npx].',
    'No primitive (--blok-radius-6) outside colors.css. Use a role.',
    'No literal borderRadius in TS.',
  ]) {
    donts.append(el('li', undefined, text));
  }

  node.append(el('h3', 'rg-subtitle', 'Don\'t'), donts);
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
    content.replaceChildren(
      el('h1', 'rg-heading', 'Rounding'),
      el('p', 'rg-lead', 'Three layers: a scale, roles built from it, and one rule for nested corners. Values below are read live from the tokens.')
    );
    renderScale(content, pxOf);
    renderRoles(content, pxOf);
    renderHeights(content);
    renderNesting(content, pxOf);
    renderExamples(content, pxOf);
    renderOutward(content, pxOf);
    renderUsage(content);
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
