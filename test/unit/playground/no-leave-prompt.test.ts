/**
 * The playground reloads all the time, so the browser's "Leave site?" prompt
 * must never show there. Blok's own leave guards stay on for real hosts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INDEX_HTML = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

const guardScript = (): string => {
  const match = /<script data-pg-no-leave-prompt>([\s\S]*?)<\/script>/.exec(INDEX_HTML);

  if (match === null) {
    throw new Error('index.html has no <script data-pg-no-leave-prompt>');
  }

  return match[1];
};

describe('playground leave prompt', () => {
  const blokGuard = vi.fn((event: Event) => event.preventDefault());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.removeEventListener('beforeunload', blokGuard);
    vi.restoreAllMocks();
  });

  it("keeps Blok's beforeunload guards from asking before a reload", () => {
    runInNewContext(guardScript(), { window });
    window.addEventListener('beforeunload', blokGuard);

    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(blokGuard).not.toHaveBeenCalled();
  });
});
