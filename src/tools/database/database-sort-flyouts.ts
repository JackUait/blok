import { IconChevronDown } from '../../components/icons';
import { DatabasePanel, panelRow } from './database-panel';
import { propertyTypeMeta } from './database-property-types';
import { sortDirectionLabelKey } from './database-filter-labels';
import type { PropertyDefinition, SortConfig } from './types';

/** A sort rule button's ⌄: it opens a flyout, not a page. */
export const sortChevron = (row: HTMLElement): HTMLElement => {
  const chevron = document.createElement('span');

  chevron.setAttribute('data-blok-database-chip-chevron', '');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = IconChevronDown;
  row.append(chevron);

  return row;
};

/** notion-motion.md Round 17 §5: the rule's property list is 280 wide, its direction list 180. */
export const PROPERTY_FLYOUT_WIDTH = 280;
const DIRECTION_FLYOUT_WIDTH = 180;

/**
 * A list under a rule's button, its top on the button's bottom (Round 17 §5,
 * Round 18 §2). The rule panel stays open under it and closes it when it
 * closes. A write redraws the rule panel, so focus goes back by test id.
 */
export const openFlyout = (
  anchor: HTMLElement,
  host: DatabasePanel,
  testId: string,
  width: number,
  rows: (pick: (write: () => void) => void) => HTMLElement[],
  place: { beside?: number; fit?: boolean; gap?: number; escapeFocus?: () => HTMLElement | null | undefined } = {}
): DatabasePanel => {
  const release = host.hold();
  const focusKey = anchor.getAttribute('data-blok-testid') ?? '';
  const flyout: DatabasePanel = new DatabasePanel({
    anchor,
    root: {
      // database.css: the measured row pitch, the same for sort and filter lists.
      name: 'sort-flyout',
      // `width` becomes a floor: the list grows to its widest row.
      ...(place.fit === true ? { fitContent: true } : {}),
      build: () => rows((write) => {
        flyout.close();
        write();
        host.root.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(focusKey)}"]`)?.focus();
      }),
    },
    testId,
    width,
    backLabel: '',
    gap: place.gap ?? 0,
    ...(place.beside !== undefined ? { beside: place.beside } : {}),
    onClose: (escape) => {
      release();
      if (escape) (place.escapeFocus?.() ?? anchor).focus();
    },
  });

  host.own(flyout);
  flyout.open();

  return flyout;
};

/** Name first, then A→Z, as every property list. */
export const openSortPropertyFlyout = (anchor: HTMLElement, host: DatabasePanel, properties: PropertyDefinition[], onPick: (property: PropertyDefinition) => void): DatabasePanel => {
  const ordered = [...properties.filter((p) => p.type === 'title'), ...properties.filter((p) => p.type !== 'title').sort((a, b) => a.name.localeCompare(b.name))];

  return openFlyout(anchor, host, 'database-sort-property-picker', PROPERTY_FLYOUT_WIDTH, (pick) => ordered.map((property) => panelRow({
    label: property.name,
    icon: propertyTypeMeta(property.type).icon,
    testId: `database-pick-property-${property.id}`,
    onClick: () => pick(() => onPick(property)),
  })));
};

/** Blok marks the current direction with a checkmark; Notion only tints it. */
export const openSortDirectionFlyout = (
  anchor: HTMLElement,
  host: DatabasePanel,
  t: (key: string) => string,
  property: PropertyDefinition,
  current: SortConfig['direction'],
  onPick: (direction: SortConfig['direction']) => void
): DatabasePanel => openFlyout(anchor, host, 'database-sort-direction-picker', DIRECTION_FLYOUT_WIDTH, (pick) => (['asc', 'desc'] as const).map((direction) => panelRow({
  label: t(sortDirectionLabelKey(property.type, direction)),
  testId: `database-sort-direction-${direction}`,
  checked: current === direction,
  onClick: () => pick(() => onPick(direction)),
})));
