import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type * as TwModule from '../../../src/components/utils/tw';
import { Paragraph } from '../../../src/tools/paragraph';
import type { API } from '../../../types';

const tw = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../../src/components/utils/tw', async (importOriginal) => {
  const actual = await importOriginal<typeof TwModule>();

  return {
    ...actual,
    twMerge: (...args: Parameters<typeof actual.twMerge>): string => {
      tw.calls += 1;

      return actual.twMerge(...args);
    },
  };
});

const api = { i18n: { t: (key: string) => key } } as unknown as API;

const renderParagraph = (): HTMLElement =>
  new Paragraph({ data: { text: '' }, config: {}, api, readOnly: false, block: {} as never }).render();

describe('Paragraph render cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tw.calls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges its fixed class list once, not per paragraph', () => {
    const first = renderParagraph();
    const callsAfterFirst = tw.calls;
    const others = Array.from({ length: 5 }, renderParagraph);

    expect(tw.calls).toBe(callsAfterFirst);
    others.forEach((element) => {
      expect(element.className).toBe(first.className);
    });
  });
});
