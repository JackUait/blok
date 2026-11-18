import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltInCommentsUi } from '../../../../src/tools/database/database-comments';
import { onHover } from '../../../../src/components/utils/tooltip';
import type { API } from '../../../../types';
import type * as Tooltip from '../../../../src/components/utils/tooltip';

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  onHover: vi.fn(),
}));

const api = {
  events: { on: vi.fn(), off: vi.fn() },
  i18n: { t: (key: string) => key },
  tools: { getBlockTools: () => [{ name: 'database-comment' }] },
  config: {},
  uploader: { uploadByFile: vi.fn(), uploadByUrl: vi.fn(), isConfigured: () => true },
  blocks: {
    transactWithoutCapture: (fn: () => void) => fn(),
    getChildren: () => [],
    getById: () => ({ id: 'r1', name: 'database-row' }),
    insertAt: () => ({ id: 'c1' }),
  },
} as unknown as API;

const ui = (): BuiltInCommentsUi => new BuiltInCommentsUi({
  api,
  locale: () => 'en-US',
  me: () => null,
  personName: () => undefined,
  permitted: () => true,
  readOnly: () => false,
  onChange: vi.fn(),
});

const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('[data-blok-database-comment-composer] > button')];

describe('comment composer buttons (notion-motion.md Round 62 §2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('run Attach file, Mention, Send', () => {
    const section = ui().section('r1');

    expect(buttons(section).map((button) => button.getAttribute('aria-label'))).toEqual([
      'tools.database.starterAttachFile',
      'tools.database.commentMention',
      'tools.database.commentSend',
    ]);
  });

  it('hint above, centred, 6 from the button', () => {
    const section = ui().section('r1');

    buttons(section).forEach((button) => {
      expect(onHover).toHaveBeenCalledWith(button, button.getAttribute('aria-label'), { placement: 'top', gap: 6 });
    });
  });

  it('a press on one keeps the focus in the text', () => {
    const section = ui().section('r1');

    buttons(section).forEach((button) => {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    });
  });

  it('Escape in a feed card\'s composer leaves it, which hides its buttons', () => {
    const box = ui().feedBox('r1');

    document.body.appendChild(box);
    const input = box.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

    input?.focus();
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(input).not.toHaveFocus();
  });
});
