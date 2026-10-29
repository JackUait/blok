import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderCellValue } from '../../../../../src/tools/database/cells';
import { onHover } from '../../../../../src/components/utils/tooltip';
import type * as Tooltip from '../../../../../src/components/utils/tooltip';
import { makeEditorContext, makeProperty } from './helpers';

vi.mock('../../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  onHover: vi.fn(),
}));

const PEOPLE = [
  { id: 'u-ada', name: 'Ada Lovelace', avatarUrl: 'https://example.com/ada.png' },
  { id: 'u-alan', name: 'Alan Turing' },
];

/** The card a chip handed the hover lever, and its options. */
const hoverOf = (chip: Element | null): { card?: HTMLElement; options?: Tooltip.HintOptions } => {
  const call = vi.mocked(onHover).mock.calls.find(([element]) => element === chip);

  return { card: call?.[1] instanceof HTMLElement ? call[1] : undefined, options: call?.[2] };
};

// notion-spec-2 §18.2, §19.16, §20.1 (created-by-editor.png): hovering a person's name opens a profile card.
describe('person profile card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['person', 'createdBy', 'lastEditedBy'] as const)('a %s chip hovers into a card with the avatar and the name', (type) => {
    const cell = renderCellValue(makeProperty(type), ['u-ada'], makeEditorContext({ people: PEOPLE }));
    const { card, options } = hoverOf(cell.querySelector('[data-blok-database-person-chip]'));

    expect(card?.querySelector('[data-blok-database-person-card-name]')?.textContent).toBe('Ada Lovelace');
    expect(card?.querySelector('img[data-blok-database-person-card-avatar]')?.getAttribute('src')).toBe('https://example.com/ada.png');
    expect(options).toMatchObject({ placement: 'top', surface: true });
    // Blok's hint delay, not Notion's ~416ms (user-approved).
    expect(options?.delay).toBeUndefined();
  });

  it('marks the current user with "(You)" and draws an initial when there is no photo', () => {
    const ctx = makeEditorContext({ people: PEOPLE, me: 'u-alan' });
    const cell = renderCellValue(makeProperty('person'), ['u-alan'], ctx);
    const { card } = hoverOf(cell.querySelector('[data-blok-database-person-chip]'));

    expect(card?.querySelector('[data-blok-database-person-card-name]')?.textContent).toBe('tools.database.personYou');
    expect(card?.querySelector('[data-blok-database-person-card-avatar]')?.textContent).toBe('A');
  });

  it('an unknown person has no card', () => {
    const cell = renderCellValue(makeProperty('person'), ['u-gone'], makeEditorContext({ people: PEOPLE }));

    expect(hoverOf(cell.querySelector('[data-blok-database-person-chip]')).card).toBeUndefined();
  });
});
