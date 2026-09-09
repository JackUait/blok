import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PopoverItemDefault } from '../../../../../../../../src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default';
import { DATA_ATTR } from '../../../../../../../../src/components/constants/data-attributes';

/**
 * The tooltip module is a collaborator, not the subject: hint placement and
 * shortcut-tooltip wiring are asserted through this mock. The real module is
 * never loaded, so mutants living in it cannot fake a verdict here.
 */
const tooltipMocks = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  onHover: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../../../../../../../../src/components/utils/tooltip', () => tooltipMocks);

/**
 * Logger is a collaborator too: the confirmation catch path swallows an
 * onActivate throw and reports it through log(), so that is the only
 * observable trace of the optional-chaining defect.
 */
const loggerMocks = vi.hoisted(() => ({
  LogLevels: {},
  setLogLevel: vi.fn(),
  log: vi.fn(),
  logLabeled: vi.fn(),
}));

vi.mock('../../../../../../../../src/components/utils/logger', () => loggerMocks);

/**
 * Survivors classified EQUIVALENT after the first sweep (id — one-line proof):
 * 14188/14189 — L138's conjuncts are the same predicate, so `&&`→`||` and second-conjunct→`true` both reduce to the original condition.
 * 14220 — forcing reset() through disableConfirmationMode on a non-confirmation item re-runs only idempotent writes (absent attrs/classes, identical content).
 * 14286 — `?? 'menuitem'` → `''`: applyAriaRole only branches on 'option', so `''` lands in the same menuitem/checkbox path.
 * 14291/14301 — the replaced conjunct is implied by the surviving one: L264's `params.hint !== undefined` is re-checked at L266.
 * 14351 — the `?? ''` fallback is unreachable: L300 guarantees title or titleEl before the title element is built.
 * 14548/14549 — setActive is reachable only through toggleActive, which already returns on a null root.
 * 14644/14645/14655/14656/14667/14668 — setConfirmation, clearConfirmationState and applyConfirmationState are only called from root-guarded callers.
 * 14680 — nodes.icon is set iff params.icon is truthy (same constructor branch), so `||`→`&&` keeps the branch decision.
 * 14689/14691/14722 — the replaced disjunct implies the other (no titleEl ⇒ original is undefined; titleEl present ⇒ the L773 guard returns first).
 * 14700/14702 — restore's falsy branches are unreachable: secondaryLabelEl exists only when the original label was truthy.
 * 14736 — jsdom cssstyle (like browsers) silently drops invalid display values, and the truthy branch is only reached while display is ''.
 * 14740/14742 — disableConfirmationMode's null-root path performs only guarded no-ops (a non-null confirmationState requires a prior enabled root).
 * 14750 — enableConfirmationMode's root guard makes the `?.` at L815 unreachable-null.
 * 14768/14771 — a missing `confirmation` key reads as undefined, so both rewritten conditions return the original verdict for all type-valid params.
 */

type ItemParams = ConstructorParameters<typeof PopoverItemDefault>[0];
type ItemRenderParams = ConstructorParameters<typeof PopoverItemDefault>[1];

const makeItem = (params: ItemParams, renderParams?: ItemRenderParams): PopoverItemDefault =>
  new PopoverItemDefault(params, renderParams);

const getElement = (item: PopoverItemDefault): HTMLElement => {
  const element = item.getElement();

  if (!(element instanceof HTMLElement)) {
    throw new Error('popover item root element is missing');
  }

  return element;
};

const el = (scope: ParentNode, testid: string): HTMLElement => {
  const found = scope.querySelector(`[data-blok-testid="${testid}"]`);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`missing element with testid ${testid}`);
  }

  return found;
};

const withNullRoot = (item: PopoverItemDefault): void => {
  const { nodes } = item as unknown as { nodes: { root: HTMLElement | null } };
  nodes.root = null;
};

const ALPHA_ICON = '<svg data-icon="alpha"></svg>';
const BETA_ICON = '<svg data-icon="beta"></svg>';

describe('PopoverItemDefault — construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a div menuitem carrying the base classes and empty marker attribute', () => {
    const item = makeItem({ title: 'First item', onActivate: () => {} });
    const root = getElement(item);

    expect(root.tagName).toBe('DIV');
    expect(root.getAttribute('type')).toBeNull();
    expect(root.getAttribute(DATA_ATTR.popoverItem)).toBe('');
    expect(root.getAttribute('data-blok-testid')).toBe('popover-item');
    expect(root.getAttribute('role')).toBe('menuitem');
    expect(root.classList.contains('flex')).toBe(true);
    expect(root.classList.contains('px-2')).toBe(true);
    expect(root.classList.contains('pl-2')).toBe(true);
    expect(root.classList.contains('pr-3')).toBe(true);
    expect(root.classList.contains('p-[3px]')).toBe(false);
    expect(root.getAttribute('data-blok-item-name')).toBeNull();
  });

  it('stamps the item name and custom dataset attributes', () => {
    const item = makeItem({
      title: 'Named item',
      name: 'named-item',
      dataset: { track: 'toolbox' },
      onActivate: () => {},
    });
    const root = getElement(item);

    expect(root.getAttribute('data-blok-item-name')).toBe('named-item');
    expect(root.getAttribute('data-track')).toBe('toolbox');
  });

  it('emits type="button" only for the button wrapper tag', () => {
    const button = getElement(makeItem({ title: 'Button item', onActivate: () => {} }, { wrapperTag: 'button' }));

    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('marks disabled items with the disabled attributes and dead-pointer class', () => {
    const item = makeItem({ title: 'Disabled item', isDisabled: true, onActivate: () => {} });
    const root = getElement(item);

    expect(root.getAttribute(DATA_ATTR.disabled)).toBe('true');
    expect(root.getAttribute('aria-disabled')).toBe('true');
    expect(root.classList.contains('pointer-events-none')).toBe(true);
    expect(item.isDisabled).toBe(true);
  });

  it('stamps the destructive attribute only when isDestructive is true, not merely present', () => {
    const destructive = getElement(makeItem({ title: 'Delete', isDestructive: true, onActivate: () => {} }));
    const harmless = getElement(makeItem({ title: 'Keep', isDestructive: false, onActivate: () => {} }));

    expect(destructive.getAttribute(DATA_ATTR.popoverItemDestructive)).toBe('true');
    expect(harmless.getAttribute(DATA_ATTR.popoverItemDestructive)).toBeNull();
  });

  it('exposes active items as menuitemcheckbox with aria-checked="true"', () => {
    const item = makeItem({ title: 'Bold', isActive: true, onActivate: () => {} });
    const root = getElement(item);

    expect(root.getAttribute('role')).toBe('menuitemcheckbox');
    expect(root.getAttribute('aria-checked')).toBe('true');
    expect(root.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');
  });

  it('exposes toggle-key items as menuitemcheckbox with aria-checked="false"', () => {
    const item = makeItem({ title: 'Align left', toggle: 'align', onActivate: () => {} });
    const root = getElement(item);

    expect(root.getAttribute('role')).toBe('menuitemcheckbox');
    expect(root.getAttribute('aria-checked')).toBe('false');
    expect(item.toggle).toBe('align');
  });

  it('adds has-children marker, aria-expanded and a chevron for items with children', () => {
    const item = makeItem({
      title: 'Convert to',
      children: { items: [{ title: 'Child A', onActivate: () => {} }] },
    });
    const root = getElement(item);

    expect(root.getAttribute(DATA_ATTR.hasChildren)).toBe('true');
    expect(root.getAttribute('aria-expanded')).toBe('false');

    const chevron = el(root, 'popover-item-chevron-right');

    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    expect(chevron.getAttribute(DATA_ATTR.popoverItemIcon)).toBe('');
    expect(chevron.getAttribute(DATA_ATTR.popoverItemIconChevronRight)).toBe('');
    expect(chevron.classList.contains('ml-3')).toBe(true);
    expect(chevron.classList.contains('w-4')).toBe(true);
    expect(chevron.querySelector('svg')).not.toBeNull();
  });

  it('renders no chevron without children', () => {
    const item = makeItem({ title: 'Plain', onActivate: () => {} });
    const root = getElement(item);

    expect(root.querySelector('[data-blok-testid="popover-item-chevron-right"]')).toBeNull();
    expect(root.getAttribute(DATA_ATTR.hasChildren)).toBeNull();
  });
});

describe('PopoverItemDefault — title, icon and label elements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the title text and the no-secondary-label class', () => {
    const item = makeItem({ title: 'Heading 1', onActivate: () => {} });
    const root = getElement(item);
    const titleEl = el(root, 'popover-item-title');

    expect(titleEl.textContent).toBe('Heading 1');
    expect(titleEl.getAttribute(DATA_ATTR.popoverItemTitle)).toBe('');
    expect(titleEl.classList.contains('mr-auto')).toBe(true);
    expect(titleEl.classList.contains('grow')).toBe(false);
  });

  it('switches the title class when a secondary label shares the row', () => {
    const item = makeItem({ title: 'Delete', secondaryLabel: '⌘ + D', onActivate: () => {} });
    const root = getElement(item);

    expect(el(root, 'popover-item-title').classList.contains('grow')).toBe(true);
  });

  it('appends a live title host element with its node identity preserved', () => {
    const host = document.createElement('span');

    host.textContent = 'HOST TEXT';

    const item = makeItem({ title: 'Ignored string', titleEl: host, onActivate: () => {} });
    const titleEl = el(getElement(item), 'popover-item-title');

    expect(titleEl.firstElementChild).toBe(host);
  });

  it('creates no title element when neither title nor title host is given', () => {
    const item = makeItem({ icon: ALPHA_ICON, onActivate: () => {} });
    const root = getElement(item);

    expect(root.querySelector('[data-blok-testid="popover-item-title"]')).toBeNull();
  });

  it('renders a string icon into the icon box and tags it as a tool gap', () => {
    const item = makeItem({ title: 'Bold', icon: ALPHA_ICON, onActivate: () => {} });
    const root = getElement(item);
    const iconEl = el(root, 'popover-item-icon');

    expect(iconEl.getAttribute('aria-hidden')).toBe('true');
    expect(iconEl.getAttribute(DATA_ATTR.popoverItemIcon)).toBe('');
    expect(iconEl.getAttribute(DATA_ATTR.tool)).toBe('');
    expect(iconEl.innerHTML).toContain('data-icon="alpha"');
    expect(item.getIconElement()).toBe(iconEl);
  });

  it('keeps a live icon element by identity', () => {
    const liveIcon = document.createElement('span');

    const item = makeItem({ title: 'Bold', icon: liveIcon, onActivate: () => {} });
    const iconEl = el(getElement(item), 'popover-item-icon');

    expect(iconEl.firstElementChild).toBe(liveIcon);
  });

  it('drops the tool gap marker when iconWithGap is false', () => {
    const item = makeItem({ title: 'Bold', icon: ALPHA_ICON, onActivate: () => {} }, { iconWithGap: false });
    const iconEl = el(getElement(item), 'popover-item-icon');

    expect(iconEl.getAttribute(DATA_ATTR.tool)).toBeNull();
  });

  it('returns null from getIconElement when the item has no icon', () => {
    const item = makeItem({ title: 'Text only', onActivate: () => {} });

    expect(item.getIconElement()).toBeNull();
  });

  it('renders the secondary shortcut with aria-keyshortcuts and hides nothing', () => {
    const item = makeItem({ title: 'Delete', secondaryLabel: '⌘ + D', onActivate: () => {} });
    const root = getElement(item);
    const secondary = el(root, 'popover-item-secondary-title');

    expect(secondary.getAttribute(DATA_ATTR.popoverItemSecondaryTitle)).toBe('');
    expect(secondary.innerHTML).toContain('>D</text>');
    expect(secondary.style.display).toBe('');
    expect(root.getAttribute('aria-keyshortcuts')).toBe('Meta+D');
  });

  it('renders the trailing icon box with its markup and aria-hidden', () => {
    const item = makeItem({ title: 'Done', trailingIcon: '<svg data-trailing="check"></svg>', onActivate: () => {} });
    const trailing = el(getElement(item), 'popover-item-trailing-icon');

    expect(trailing.classList.contains('ml-auto')).toBe(true);
    expect(trailing.classList.contains('shrink-0')).toBe(true);
    expect(trailing.getAttribute('aria-hidden')).toBe('true');
    expect(trailing.innerHTML).toContain('data-trailing="check"');
  });

  it('promotes the hint title to aria-label on icon-only items', () => {
    const item = makeItem({ icon: ALPHA_ICON, hint: { title: 'Bold hint' }, onActivate: () => {} });
    const root = getElement(item);

    expect(root.getAttribute('aria-label')).toBe('Bold hint');
  });

  it('still promotes the hint title to aria-label when the hover tooltip is disabled', () => {
    const item = makeItem(
      { icon: ALPHA_ICON, hint: { title: 'Italic hint' }, onActivate: () => {} },
      { hint: { enabled: false } }
    );

    expect(getElement(item).getAttribute('aria-label')).toBe('Italic hint');
  });
});

describe('PopoverItemDefault — contextual class matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps popover padding off inline items and centers an icon-only inline item', () => {
    const item = makeItem({ icon: ALPHA_ICON, onActivate: () => {} }, { isInline: true });
    const root = getElement(item);

    expect(root.classList.contains('justify-center')).toBe(true);
    expect(root.classList.contains('pl-2')).toBe(false);
    expect(root.classList.contains('px-1.5')).toBe(true);
    expect(root.classList.contains('px-2')).toBe(false);
  });

  it('drops inline centering once a title joins an inline item', () => {
    const item = makeItem({ title: 'Inline label', onActivate: () => {} }, { isInline: true });
    const root = getElement(item);

    expect(root.classList.contains('justify-center')).toBe(false);
    expect(root.classList.contains('px-2')).toBe(true);
    expect(root.classList.contains('px-1.5')).toBe(false);
  });

  it('keeps popover styling on a plain item that has an icon', () => {
    const item = makeItem({ title: 'Popover label', icon: ALPHA_ICON, onActivate: () => {} });
    const root = getElement(item);
    const iconEl = el(root, 'popover-item-icon');

    expect(root.classList.contains('justify-center')).toBe(false);
    expect(iconEl.classList.contains('w-6')).toBe(true);
    expect(iconEl.classList.contains('mr-2.5')).toBe(true);
    expect(iconEl.classList.contains('mr-0!')).toBe(false);
    expect(iconEl.classList.contains('mr-2!')).toBe(false);
    expect(iconEl.classList.contains('shadow-none')).toBe(false);
    expect(iconEl.classList.contains('w-auto')).toBe(false);
  });

  it('styles inline icons compactly without the popover gap', () => {
    const iconOnly = el(
      getElement(makeItem({ icon: ALPHA_ICON, onActivate: () => {} }, { isInline: true })),
      'popover-item-icon'
    );
    const gapless = el(
      getElement(makeItem({ icon: ALPHA_ICON, onActivate: () => {} }, { isInline: true, iconWithGap: false })),
      'popover-item-icon'
    );

    expect(iconOnly.classList.contains('w-auto')).toBe(true);
    expect(iconOnly.classList.contains('shadow-none')).toBe(true);
    expect(iconOnly.classList.contains('mr-0!')).toBe(true);
    expect(gapless.classList.contains('shadow-none')).toBe(false);
  });

  it('restores popover styling for nested inline items', () => {
    const item = makeItem({ icon: ALPHA_ICON, onActivate: () => {} }, { isNestedInline: true });
    const root = getElement(item);
    const iconEl = el(root, 'popover-item-icon');

    expect(root.classList.contains('p-[3px]')).toBe(true);
    expect(root.classList.contains('pl-2')).toBe(false);
    expect(iconEl.classList.contains('w-toolbox-btn')).toBe(true);
    expect(iconEl.classList.contains('mr-2!')).toBe(true);
    expect(iconEl.classList.contains('mr-2.5')).toBe(false);
  });
});

describe('PopoverItemDefault — hint hover wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hovers a hint with right placement and centered alignment by default', () => {
    const item = makeItem({ title: 'Hinted', hint: { title: 'Hint title', description: '⌥ + G' }, onActivate: () => {} });
    const root = getElement(item);

    expect(tooltipMocks.onHover).toHaveBeenCalledOnce();

    const [target, content, options] = tooltipMocks.onHover.mock.calls[0] as unknown as [
      HTMLElement,
      HTMLElement,
      { placement: string },
    ];

    expect(target).toBe(root);
    expect(content.textContent).toContain('Hint title');
    expect(content.textContent).toContain('G');
    expect(content.getAttribute('data-alignment')).toBe('center');
    expect(options).toEqual({ placement: 'right' });
  });

  it('suppresses the hint hover when render params disable hints', () => {
    makeItem(
      { title: 'Muted hint', hint: { title: 'Hidden hint' }, onActivate: () => {} },
      { hint: { enabled: false } }
    );

    expect(tooltipMocks.onHover).not.toHaveBeenCalled();
  });

  it('resolves hint defaults when render params are given without hint config', () => {
    const item = makeItem(
      { title: 'Bare render params', hint: { title: 'Bare title' }, onActivate: () => {} },
      {}
    );
    const root = getElement(item);

    expect(tooltipMocks.onHover).toHaveBeenCalledOnce();

    const [target, , options] = tooltipMocks.onHover.mock.calls[0] as unknown as [
      HTMLElement,
      HTMLElement,
      { placement: string },
    ];

    expect(target).toBe(root);
    expect(options).toEqual({ placement: 'right' });
  });

  it('honours hint position and alignment overrides', () => {
    const item = makeItem(
      { title: 'Placed hint', hint: { title: 'Placed title' }, onActivate: () => {} },
      { hint: { position: 'bottom', alignment: 'start' } }
    );
    const content = (tooltipMocks.onHover.mock.calls[0] as unknown as [HTMLElement, HTMLElement, { placement: string }])[1];

    getElement(item);
    expect(tooltipMocks.onHover).toHaveBeenCalledOnce();
    expect(content.getAttribute('data-alignment')).toBe('start');

    const [, , options] = tooltipMocks.onHover.mock.calls[0] as unknown as [
      HTMLElement,
      HTMLElement,
      { placement: string },
    ];

    expect(options).toEqual({ placement: 'bottom' });
  });

  it('anchors the shortcut tooltip on the secondary glyph span only when the item has a title', () => {
    const titled = makeItem({ title: 'Delete', secondaryLabel: '⌘ + D', onActivate: () => {} });
    const titledRoot = getElement(titled);
    const secondary = el(titledRoot, 'popover-item-secondary-title');

    expect(tooltipMocks.onHover).toHaveBeenCalledOnce();
    expect(tooltipMocks.onHover).toHaveBeenCalledWith(secondary.firstElementChild, 'Command+D', { placement: 'top' });

    tooltipMocks.onHover.mockClear();

    const untitled = makeItem({ secondaryLabel: '⌘ + K', onActivate: () => {} });

    getElement(untitled);
    expect(tooltipMocks.onHover).not.toHaveBeenCalled();
  });
});

describe('PopoverItemDefault — getters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the stored params through the getters', () => {
    const item = makeItem({
      title: 'Searchable',
      englishTitle: 'Searchable EN',
      searchTerms: ['find', 'lookup'],
      toggle: true,
      onActivate: () => {},
    });

    expect(item.title).toBe('Searchable');
    expect(item.englishTitle).toBe('Searchable EN');
    expect(item.searchTerms).toEqual(['find', 'lookup']);
    expect(item.toggle).toBe(true);
    expect(item.isDisabled).toBe(false);
    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(item.confirmationTitle).toBeUndefined();
    expect(item.isFocused).toBe(false);
  });

  it('reflects the focused attribute in isFocused', () => {
    const item = makeItem({ title: 'Focusable', onActivate: () => {} });

    item.setFocused(true);
    expect(item.isFocused).toBe(true);

    item.setFocused(false);
    expect(item.isFocused).toBe(false);
  });
});

describe('PopoverItemDefault — toggleActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flips the active attribute and honours an explicit value', () => {
    const item = makeItem({ title: 'Toggling', onActivate: () => {} });
    const root = getElement(item);

    item.toggleActive();
    expect(root.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');

    item.toggleActive(false);
    expect(root.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);

    item.toggleActive(true);
    expect(root.getAttribute(DATA_ATTR.popoverItemActive)).toBe('true');

    item.toggleActive();
    expect(root.hasAttribute(DATA_ATTR.popoverItemActive)).toBe(false);
  });

  it('syncs aria-checked only for checkbox and radio roles', () => {
    const plain = makeItem({ title: 'Plain role', onActivate: () => {} });
    const plainRoot = getElement(plain);

    plain.toggleActive(true);
    expect(plainRoot.getAttribute('aria-checked')).toBeNull();

    const checkable = makeItem({ title: 'Checked role', isActive: false, onActivate: () => {} });
    const checkableRoot = getElement(checkable);

    checkable.toggleActive(true);
    expect(checkableRoot.getAttribute('aria-checked')).toBe('true');
  });
});

describe('PopoverItemDefault — children open/close state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the trigger open and restores expanded=false on close', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const item = makeItem({ title: 'Parent', children: { items: [], onOpen, onClose } });
    const root = getElement(item);

    item.onChildrenOpen();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(root.getAttribute(DATA_ATTR.popoverItemChildrenOpen)).toBe('true');
    expect(root.getAttribute('aria-expanded')).toBe('true');

    item.onChildrenClose();
    expect(onClose).toHaveBeenCalledOnce();
    expect(root.hasAttribute(DATA_ATTR.popoverItemChildrenOpen)).toBe(false);
    expect(root.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('PopoverItemDefault — setFocused / toggleHidden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies and removes the focused attribute and class', () => {
    const item = makeItem({ title: 'Focused item', onActivate: () => {} });
    const root = getElement(item);

    item.setFocused(true);
    expect(root.getAttribute(DATA_ATTR.focused)).toBe('true');
    expect(root.classList.contains('bg-item-focus-bg!')).toBe(true);

    item.setFocused(false);
    expect(root.hasAttribute(DATA_ATTR.focused)).toBe(false);
    expect(root.classList.contains('bg-item-focus-bg!')).toBe(false);
  });

  it('applies and removes the hidden attribute and collapse classes', () => {
    const item = makeItem({ title: 'Hideable', onActivate: () => {} });
    const root = getElement(item);

    item.toggleHidden(true);
    expect(root.getAttribute(DATA_ATTR.hidden)).toBe('true');
    expect(root.classList.contains('opacity-0')).toBe(true);
    expect(root.classList.contains('max-h-0!')).toBe(true);

    item.toggleHidden(false);
    expect(root.hasAttribute(DATA_ATTR.hidden)).toBe(false);
    expect(root.classList.contains('opacity-0')).toBe(false);
  });
});

describe('PopoverItemDefault — useRadioRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('promotes a checkbox item to radio and keeps aria-checked in sync', () => {
    const item = makeItem({ title: 'Radio member', isActive: true, onActivate: () => {} });
    const root = getElement(item);

    item.useRadioRole();
    expect(root.getAttribute('role')).toBe('menuitemradio');
    expect(root.getAttribute('aria-checked')).toBe('true');

    item.toggleActive(false);
    expect(root.getAttribute('aria-checked')).toBe('false');
  });

  it('leaves listbox options untouched', () => {
    const item = makeItem({ title: 'Option item', onActivate: () => {} }, { menuItemRole: 'option' });
    const root = getElement(item);

    item.useRadioRole();
    expect(root.getAttribute('role')).toBe('option');
  });
});

describe('PopoverItemDefault — handleClick without confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates the item with its own params', () => {
    const onActivate = vi.fn();
    const params = { title: 'Plain action', onActivate };
    const item = makeItem(params);

    item.handleClick();

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(params);
  });

  it('does nothing when a children item has no onActivate', () => {
    const item = makeItem({ title: 'Parent only', children: { items: [] } });

    expect(() => item.handleClick()).not.toThrow();
  });

  it('reports no error when a children item without onActivate is clicked', () => {
    const item = makeItem({ title: 'Quiet parent', children: { items: [] } });

    item.handleClick();

    expect(loggerMocks.log).not.toHaveBeenCalled();
  });

  it('logs and swallows an onActivate handler that throws', () => {
    const onActivate = vi.fn(() => {
      throw new Error('activation exploded');
    });
    const item = makeItem({ title: 'Exploding item', onActivate });

    expect(() => item.handleClick()).not.toThrow();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(loggerMocks.log).toHaveBeenCalledWith(
      'Popover item onActivate handler threw an error',
      'error',
      expect.any(Error)
    );
  });
});

describe('PopoverItemDefault — confirmation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const confirmationItem = (): { item: PopoverItemDefault; root: HTMLElement; confirmOnActivate: ReturnType<typeof vi.fn> } => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Delete page',
      icon: ALPHA_ICON,
      confirmation: { title: 'Sure about it?', icon: BETA_ICON, onActivate: confirmOnActivate },
    });

    return { item, root: getElement(item), confirmOnActivate };
  };

  it('enters confirmation mode on first click and confirms on the second', () => {
    const { item, root, confirmOnActivate } = confirmationItem();

    item.handleClick();

    expect(item.isConfirmationStateEnabled).toBe(true);
    expect(item.confirmationTitle).toBe('Sure about it?');
    expect(root.getAttribute(DATA_ATTR.popoverItemConfirmation)).toBe('true');
    expect(root.classList.contains('bg-item-confirm-bg!')).toBe(true);
    expect(root.classList.contains('text-white!')).toBe(true);
    expect(el(root, 'popover-item-title').textContent).toBe('Sure about it?');
    expect(el(root, 'popover-item-icon').innerHTML).toContain('data-icon="beta"');
    expect(root.getAttribute(DATA_ATTR.popoverItemNoHover)).toBe('true');
    expect(root.getAttribute(DATA_ATTR.popoverItemNoFocus)).toBe('true');

    item.handleClick();

    expect(confirmOnActivate).toHaveBeenCalledOnce();
    expect(item.isConfirmationStateEnabled).toBe(false);
    expect(item.confirmationTitle).toBeUndefined();
    expect(root.hasAttribute(DATA_ATTR.popoverItemConfirmation)).toBe(false);
    expect(root.classList.contains('bg-item-confirm-bg!')).toBe(false);
    expect(el(root, 'popover-item-title').textContent).toBe('Delete page');
    expect(el(root, 'popover-item-icon').innerHTML).toContain('data-icon="alpha"');
    // The restore must CLEAR the confirmation markup first — a prepended
    // restore would still contain alpha.
    expect(el(root, 'popover-item-icon').innerHTML).not.toContain('data-icon="beta"');
  });

  it('drops the special hover state after one mouseleave', () => {
    const { item, root } = confirmationItem();

    item.handleClick();
    expect(root.getAttribute(DATA_ATTR.popoverItemNoHover)).toBe('true');
    expect(root.getAttribute(DATA_ATTR.popoverItemNoFocus)).toBe('true');

    root.dispatchEvent(new Event('mouseleave'));

    expect(root.hasAttribute(DATA_ATTR.popoverItemNoHover)).toBe(false);
    expect(root.getAttribute(DATA_ATTR.popoverItemNoFocus)).toBe('true');
  });

  it('registers the once mouseleave listener and unregisters it on focus', () => {
    const { item, root } = confirmationItem();
    const addSpy = vi.spyOn(root, 'addEventListener');

    item.handleClick();
    expect(addSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function), { once: true });

    const removeSpy = vi.spyOn(root, 'removeEventListener');

    item.onFocus();
    expect(removeSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    expect(root.hasAttribute(DATA_ATTR.popoverItemNoFocus)).toBe(false);
    expect(root.hasAttribute(DATA_ATTR.popoverItemNoHover)).toBe(false);
  });

  it('swaps the secondary label in confirmation mode and restores it on reset', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Rename',
      secondaryLabel: '⌘ + D',
      confirmation: { title: 'New name?', secondaryLabel: '⌘ + K', onActivate: confirmOnActivate },
    });
    const root = getElement(item);
    const secondary = el(root, 'popover-item-secondary-title');

    item.handleClick();
    expect(secondary.innerHTML).toContain('>K</text>');
    expect(secondary.style.display).toBe('');

    item.reset();
    expect(secondary.innerHTML).toContain('>D</text>');
    expect(secondary.style.display).toBe('');
    expect(el(root, 'popover-item-title').textContent).toBe('Rename');
  });

  it('hides the secondary label when confirmation clears it, and restores on reset', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Clear label',
      secondaryLabel: '⌘ + D',
      confirmation: { title: 'Confirm clear', secondaryLabel: '', onActivate: confirmOnActivate },
    });
    const root = getElement(item);
    const secondary = el(root, 'popover-item-secondary-title');

    item.handleClick();
    expect(secondary.innerHTML).toBe('');
    expect(secondary.style.display).toBe('none');

    item.reset();
    expect(secondary.innerHTML).toContain('>D</text>');
    expect(secondary.style.display).toBe('');
  });

  it('keeps the confirmation title when confirmation params carry no title of their own', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Untouched title',
      confirmation: { icon: BETA_ICON, onActivate: confirmOnActivate },
    });
    const root = getElement(item);

    item.handleClick();
    expect(el(root, 'popover-item-title').textContent).toBe('Untouched title');

    item.reset();
    expect(el(root, 'popover-item-title').textContent).toBe('Untouched title');
  });

  it('never stringifies over a live element icon in confirmation mode', () => {
    const liveIcon = document.createElement('span');
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Live icon',
      icon: liveIcon,
      confirmation: { title: 'Confirm live', icon: BETA_ICON, onActivate: confirmOnActivate },
    });
    const iconEl = el(getElement(item), 'popover-item-icon');

    item.handleClick();

    expect(iconEl.firstElementChild).toBe(liveIcon);
  });

  it('keeps the original icon when confirmation params explicitly clear the icon', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Cleared icon',
      icon: ALPHA_ICON,
      confirmation: { title: 'Confirm cleared', icon: undefined, onActivate: confirmOnActivate },
    });

    item.handleClick();

    expect(el(getElement(item), 'popover-item-icon').innerHTML).toContain('data-icon="alpha"');
  });

  it('preserves the live title host through confirmation and restores it on reset', () => {
    const host = document.createElement('span');

    host.textContent = 'REACT HOST';

    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Hosted item',
      titleEl: host,
      confirmation: { title: 'String override?', onActivate: confirmOnActivate },
    });
    const titleEl = el(getElement(item), 'popover-item-title');

    item.handleClick();
    expect(titleEl.firstElementChild).toBe(host);

    item.reset();
    expect(titleEl.firstElementChild).toBe(host);
    expect(titleEl.textContent).toBe('REACT HOST');
  });

  it('resets cleanly on an icon-only item that has no title element', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      icon: ALPHA_ICON,
      hint: { title: 'Icon-only hint' },
      confirmation: { title: 'Sure?', icon: BETA_ICON, onActivate: confirmOnActivate },
    });
    const root = getElement(item);

    item.handleClick();
    expect(() => item.reset()).not.toThrow();
    expect(root.hasAttribute(DATA_ATTR.popoverItemConfirmation)).toBe(false);
    expect(el(root, 'popover-item-icon').innerHTML).toContain('data-icon="alpha"');
  });

  it('reset() on a plain item leaves the rendered content alone', () => {
    const item = makeItem({ title: 'Stable', icon: ALPHA_ICON, secondaryLabel: '⌘ + D', onActivate: () => {} });
    const root = getElement(item);

    item.reset();

    expect(el(root, 'popover-item-title').textContent).toBe('Stable');
    expect(el(root, 'popover-item-secondary-title').innerHTML).toContain('>D</text>');
    expect(item.isConfirmationStateEnabled).toBe(false);
  });
});

describe('PopoverItemDefault — null-root defensive paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('short-circuits every guarded entry point when the root is gone', () => {
    const onOpen = vi.fn();
    const item = makeItem({ title: 'Dismantled', children: { items: [], onOpen } });

    withNullRoot(item);

    expect(item.isFocused).toBe(false);
    expect(() => item.useRadioRole()).not.toThrow();
    expect(() => item.toggleActive(true)).not.toThrow();
    expect(() => item.toggleHidden(true)).not.toThrow();
    expect(() => item.setFocused(true)).not.toThrow();
    expect(() => item.onFocus()).not.toThrow();
    expect(() => item.onChildrenOpen()).not.toThrow();
    expect(() => item.onChildrenClose()).not.toThrow();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('stays out of confirmation mode when the root is gone', () => {
    const confirmOnActivate = vi.fn();
    const item = makeItem({
      title: 'Rootless confirm',
      confirmation: { title: 'Sure?', onActivate: confirmOnActivate },
    });

    withNullRoot(item);
    item.handleClick();

    expect(item.isConfirmationStateEnabled).toBe(false);
  });
});
