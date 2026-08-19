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

  it('delta unregisters everything when disarming the last origin', () => {
    const existing = desiredRegistrations(['http://localhost:4444'], 'f.js');
    const { toUnregister, toRegister } = registrationDelta(existing, []);
    expect(toUnregister.sort()).toEqual([BANNER_SCRIPT_ID, PAYLOAD_SCRIPT_ID].sort());
    expect(toRegister).toEqual([]);
  });
});
