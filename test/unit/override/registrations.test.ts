import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desiredRegistrations, registrationDelta, PAYLOAD_SCRIPT_ID, BANNER_SCRIPT_ID } from '../../../override-extension/lib/registrations.mjs';

describe('override extension registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the payload MAIN-world at document_start and the banner ISOLATED at idle', () => {
    const regs = desiredRegistrations(['http://localhost:4444'], 'blok-override.abc123def456.js');
    expect(regs).toHaveLength(2);
    const payload = regs.find((r) => r.id === PAYLOAD_SCRIPT_ID);
    const banner = regs.find((r) => r.id === BANNER_SCRIPT_ID);
    expect(payload).toMatchObject({
      js: ['payload/blok-override.abc123def456.js'],
      matches: ['http://localhost:4444/*'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    });
    expect(banner).toMatchObject({ js: ['banner.js'], world: 'ISOLATED', runAt: 'document_idle' });
  });

  it('returns no registrations without armed origins or without a payload', () => {
    expect(desiredRegistrations([], 'f.js')).toEqual([]);
    expect(desiredRegistrations(['http://localhost:4444'], null)).toEqual([]);
  });

  it('normalizes trailing slashes in origins', () => {
    const [payload] = desiredRegistrations(['https://kb.example.com/'], 'f.js');
    expect(payload.matches).toEqual(['https://kb.example.com/*']);
  });

  it('delta unregisters stale ids and re-registers changed ones', () => {
    const desired = desiredRegistrations(['http://localhost:4444'], 'blok-override.new.js');
    const existing = desiredRegistrations(['http://localhost:4444'], 'blok-override.old.js');
    const { toUnregister, toRegister } = registrationDelta(existing, desired);
    expect(toUnregister.sort()).toEqual([BANNER_SCRIPT_ID, PAYLOAD_SCRIPT_ID].sort());
    expect(toRegister).toEqual(desired);
  });

  it('delta is empty when nothing changed', () => {
    const desired = desiredRegistrations(['http://localhost:4444'], 'f.js');
    const { toUnregister, toRegister } = registrationDelta(desired, desired);
    expect(toUnregister).toEqual([]);
    expect(toRegister).toEqual([]);
  });

  /**
   * chrome.scripting.getRegisteredContentScripts returns its OWN key order and
   * adds fields the extension never asked for (matchOriginAsFallback). Comparing
   * whole-object JSON is key-order sensitive, so it reported "changed" on every
   * sync and the 30s alarm re-registered the payload forever. A navigation that
   * commits while the MAIN-world document_start script is unregistered silently
   * loads the site's own Blok with the badge still showing ON.
   */
  it('delta is empty when chrome echoes the same set with its own key order and extra fields', () => {
    const desired = desiredRegistrations(['http://localhost:4444'], 'f.js');
    const asChromeReturnsIt = desired.map((r) => ({
      allFrames: r.allFrames,
      id: r.id,
      js: r.js,
      matchOriginAsFallback: false,
      matches: r.matches,
      persistAcrossSessions: r.persistAcrossSessions,
      runAt: r.runAt,
      world: r.world,
    }));

    const { toUnregister, toRegister } = registrationDelta(asChromeReturnsIt, desired);

    expect(toUnregister).toEqual([]);
    expect(toRegister).toEqual([]);
  });

  it('delta unregisters everything when disarming the last origin', () => {
    const existing = desiredRegistrations(['http://localhost:4444'], 'f.js');
    const { toUnregister, toRegister } = registrationDelta(existing, []);
    expect(toUnregister.sort()).toEqual([BANNER_SCRIPT_ID, PAYLOAD_SCRIPT_ID].sort());
    expect(toRegister).toEqual([]);
  });
});
