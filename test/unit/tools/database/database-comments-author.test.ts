import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltInCommentsUi } from '../../../../src/tools/database/database-comments';
import type { API } from '../../../../types';

/** The writer when the host gives no current user (user decision 2026-10-16). */
const apiWith = (collaborationName: string | undefined): { api: API; inserted: unknown[] } => {
  const inserted: unknown[] = [];
  const api = {
    events: { on: vi.fn(), off: vi.fn() },
    i18n: { t: (key: string) => key },
    tools: { getBlockTools: () => [{ name: 'database-comment' }] },
    config: collaborationName === undefined ? {} : { collaboration: { doc: 'd', user: { name: collaborationName } } },
    blocks: {
      transactWithoutCapture: (fn: () => void) => fn(),
      getChildren: () => [],
      getById: () => ({ id: 'r1' }),
      insertAt: (_type: string, data: unknown) => {
        inserted.push(data);

        return { id: 'k1' };
      },
    },
  } as unknown as API;

  return { api, inserted };
};

const write = (api: API, me: string | null = null): void => {
  const ui = new BuiltInCommentsUi({
    api,
    locale: () => 'en',
    me: () => me,
    personName: (id) => (id === 'u1' ? 'Ann Host' : undefined),
    permitted: () => true,
    readOnly: () => false,
    onChange: vi.fn(),
  });
  const section = ui.section('r1');
  const input = section.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

  if (input === null) throw new Error('no composer');
  input.value = 'Hi';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  ui.destroy();
};

describe('built-in comment author', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the host user when the host has one', () => {
    const { api, inserted } = apiWith('Kate');

    write(api, 'u1');
    expect(inserted[0]).toMatchObject({ authorId: 'u1', authorName: 'Ann Host' });
  });

  it('is the collaboration display name without a host user', () => {
    const { api, inserted } = apiWith('Kate');

    write(api);
    expect(inserted[0]).toMatchObject({ authorName: 'Kate' });
    expect(inserted[0]).not.toHaveProperty('authorId');
  });

  it('is nobody (shown as Anonymous) without either', () => {
    const { api, inserted } = apiWith(undefined);

    write(api);
    expect(inserted[0]).not.toHaveProperty('authorName');
    expect(inserted[0]).not.toHaveProperty('authorId');
  });
});
