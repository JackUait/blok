import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseColumnControls } from '../../../../src/tools/database/database-column-controls';

type OpenRename = (pill: HTMLElement, label: string, done: (label: string | null) => void) => void;

const makePillHeaderEl = (title = 'BACKLOG'): HTMLElement => {
  const header = document.createElement('div');
  const pill = document.createElement('div');
  pill.setAttribute('data-blok-database-column-pill', '');
  const titleEl = document.createElement('div');
  titleEl.setAttribute('data-blok-database-column-title', '');
  titleEl.textContent = title;
  pill.appendChild(titleEl);
  header.appendChild(pill);
  document.body.appendChild(header);
  return header;
};

const pillOf = (header: HTMLElement): HTMLElement => {
  const pill = header.querySelector<HTMLElement>('[data-blok-database-column-pill]');

  if (pill === null) throw new Error('no pill');

  return pill;
};

const titleOf = (header: HTMLElement): HTMLElement => {
  const title = header.querySelector<HTMLElement>('[data-blok-database-column-title]');

  if (title === null) throw new Error('no title');

  return title;
};

describe('DatabaseColumnControls', () => {
  let onRename: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let onRenameCommit: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let openRename: ReturnType<typeof vi.fn<OpenRename>>;
  let controls: DatabaseColumnControls;

  beforeEach(() => {
    vi.clearAllMocks();
    onRename = vi.fn<(optionId: string, label: string) => void>();
    onRenameCommit = vi.fn<(optionId: string, label: string) => void>();
    openRename = vi.fn<OpenRename>();
    controls = new DatabaseColumnControls({ onRename, onRenameCommit, openRename });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('makePillTitleEditable', () => {
    // notion-motion.md Round 99 §1 #1: a click opens the same popup as Enter, not an inline field.
    it('a click on the pill opens the rename popup, and no inline field appears', () => {
      const headerEl = makePillHeaderEl('BACKLOG');

      controls.makePillTitleEditable(headerEl, 'opt-1');
      titleOf(headerEl).click();

      expect(openRename).toHaveBeenCalledTimes(1);
      expect(openRename).toHaveBeenLastCalledWith(pillOf(headerEl), 'BACKLOG', expect.any(Function));
      expect(headerEl.querySelector('input')).toBeNull();

      pillOf(headerEl).click();

      expect(openRename).toHaveBeenCalledTimes(2);
    });

    it('a click keeps away from the header, so no column drag starts', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      const onHeaderClick = vi.fn<() => void>();

      headerEl.addEventListener('click', onHeaderClick);
      controls.makePillTitleEditable(headerEl, 'opt-1');
      titleOf(headerEl).click();

      expect(onHeaderClick).not.toHaveBeenCalled();
    });

    it('a second call on the same header still opens one popup per click', () => {
      const headerEl = makePillHeaderEl('BACKLOG');

      controls.makePillTitleEditable(headerEl, 'opt-1');
      controls.makePillTitleEditable(headerEl, 'opt-1');
      pillOf(headerEl).click();
      pillOf(headerEl).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(openRename).toHaveBeenCalledTimes(2);
    });

    it('leaves a header with no pill alone', () => {
      const headerEl = document.createElement('div');

      expect(() => controls.makePillTitleEditable(headerEl, 'opt-1')).not.toThrow();
    });

    // notion-motion.md Round 97 §1 #1, Round 98 §1 #1: the pill is a Tab stop, and Enter and Space open the popup.
    it('makes the pill a button that Enter and Space open the popup from', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      const pill = pillOf(headerEl);

      controls.makePillTitleEditable(headerEl, 'opt-1');

      expect(pill.tabIndex).toBe(0);
      expect(pill.getAttribute('role')).toBe('button');

      for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

        pill.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(openRename).toHaveBeenLastCalledWith(pill, 'BACKLOG', expect.any(Function));
      }
    });

    it('the pill takes focus back when the popup closes, with or without a new name', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      const pill = pillOf(headerEl);
      const elsewhere = document.createElement('input');

      document.body.append(elsewhere);
      controls.makePillTitleEditable(headerEl, 'opt-1');

      pill.click();
      elsewhere.focus();
      openRename.mock.lastCall?.[2](null);

      expect(pill).toHaveFocus();
      expect(onRename).not.toHaveBeenCalled();

      pill.click();
      elsewhere.focus();
      openRename.mock.lastCall?.[2]('DOING');

      expect(titleOf(headerEl).textContent).toBe('DOING');
      expect(onRenameCommit).toHaveBeenCalledWith('opt-1', 'DOING');
      expect(onRename).toHaveBeenCalledWith('opt-1', 'DOING');
      expect(pill).toHaveFocus();
    });

    it('the same name renames nothing', () => {
      const headerEl = makePillHeaderEl('BACKLOG');

      controls.makePillTitleEditable(headerEl, 'opt-1');
      pillOf(headerEl).click();
      openRename.mock.lastCall?.[2]('BACKLOG');

      expect(onRename).not.toHaveBeenCalled();
      expect(onRenameCommit).not.toHaveBeenCalled();
    });

    it('works without a commit callback', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      const bare = new DatabaseColumnControls({ onRename, openRename });

      bare.makePillTitleEditable(headerEl, 'opt-1');
      pillOf(headerEl).click();
      openRename.mock.lastCall?.[2]('DOING');

      expect(onRename).toHaveBeenCalledWith('opt-1', 'DOING');
    });
  });
});
