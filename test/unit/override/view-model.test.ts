import { describe, expect, it } from 'vitest';

import { popupViewModel, describeRedirect } from '../../../override-extension/lib/view-model.mjs';
import { LOCAL_DIST_SENTINEL } from '../../../override-extension/lib/dnr.mjs';

const CURRENT = {
  file: 'blok-override.abc.js',
  version: '1.10.1-dev.93be8995',
  builtAt: '2026-08-20T07:47:26.427Z',
  dist: { staged: true, files: 120 },
};

const DETECTED = {
  state: 'detected' as const,
  origin: 'https://kb.example',
  bundled: { present: true, version: '1.8.0' },
  cdn: [],
};

describe('popup view model', () => {
  it('gates every action on a synced payload', () => {
    const vm = popupViewModel({ current: null, armedOrigins: [], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(vm.build).toEqual({ state: 'missing' });
    expect(vm.canArm).toBe(false);
    expect(vm.routeBuilder.enabled).toBe(false);
  });

  it('gates arming and routing on blok being detected', () => {
    const noBlok = popupViewModel({
      current: CURRENT,
      armedOrigins: [],
      redirects: [],
      detection: { state: 'no-blok', origin: 'https://plain.example' },
      catalogAvailable: true,
    });
    expect(noBlok.page.state).toBe('no-blok');
    expect(noBlok.canArm).toBe(false);
    expect(noBlok.routeBuilder.enabled).toBe(false);

    const noTab = popupViewModel({ current: CURRENT, armedOrigins: [], redirects: [], detection: { state: 'no-tab' }, catalogAvailable: true });
    expect(noTab.page.state).toBe('no-tab');
    expect(noTab.canArm).toBe(false);
  });

  it('arms against the detected origin and reports the armed + live state', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [],
      detection: { ...DETECTED, bundled: { present: true, version: '1.10.1-dev.93be8995' } },
      catalogAvailable: true,
    });
    expect(vm.canArm).toBe(true);
    expect(vm.page).toMatchObject({ state: 'detected', origin: 'https://kb.example', armed: true, live: true });
  });

  it('recognizes the page running your exact build even without arming (CDN swaps)', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: [],
      redirects: [],
      detection: { ...DETECTED, bundled: { present: true, version: '1.10.1-dev.93be8995' } },
      catalogAvailable: true,
    });
    expect(vm.page).toMatchObject({ runningYours: true, live: false });

    const other = popupViewModel({ current: CURRENT, armedOrigins: [], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(other.page).toMatchObject({ runningYours: false });
  });

  it('flags version skew when armed but the page still runs another build', () => {
    const vm = popupViewModel({ current: CURRENT, armedOrigins: ['https://kb.example'], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(vm.page).toMatchObject({ armed: true, live: false, swap: 'pending' });
  });

  // The swap state is what makes the extension act on its own: 'pending' means
  // a reload lands the build, 'blocked' means no reload ever will.
  it('reports the swap as off until the origin is armed or a CDN reference is routed', () => {
    const idle = popupViewModel({ current: CURRENT, armedOrigins: [], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(idle.page.swap).toBe('off');
  });

  it('reports the swap as pending while the armed page carries no payload yet', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [],
      detection: DETECTED,
      installedPayload: null,
      catalogAvailable: true,
    });
    expect(vm.page.swap).toBe('pending');
  });

  it('reports the swap as pending when the page carries an older payload than the current build', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [],
      detection: DETECTED,
      installedPayload: { version: '1.10.1-dev.deadbeef' },
      catalogAvailable: true,
    });
    expect(vm.page.swap).toBe('pending');
  });

  // Payload installed, current, and the editor still reports the app's own
  // version: the page's blok predates the seam. Reloading changes nothing, so
  // the popup must stop reloading and say so.
  it('reports the swap as blocked when the current payload is installed and ignored', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [],
      detection: DETECTED,
      installedPayload: { version: CURRENT.version },
      catalogAvailable: true,
    });
    expect(vm.page.swap).toBe('blocked');
  });

  it('reports the swap as live once the page runs your build', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [],
      detection: { ...DETECTED, bundled: { present: true, version: CURRENT.version } },
      installedPayload: { version: CURRENT.version },
      catalogAvailable: true,
    });
    expect(vm.page).toMatchObject({ swap: 'live', live: true });
  });

  // A CDN page has no bundled editor to swap in place, so the swap story is
  // told by its per-reference rows — never by a callout that can never clear.
  it('keeps the swap off for a routed CDN page with no bundled editor', () => {
    const prefix = 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/';
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: [],
      redirects: [{ from: prefix, to: LOCAL_DIST_SENTINEL }],
      detection: { ...DETECTED, bundled: { present: false, version: null }, cdn: [{ pkg: '@bloklabs/core', version: '1.8.0', prefix }] },
      catalogAvailable: true,
    });
    expect(vm.page.swap).toBe('off');
  });

  it('marks detected CDN references as routed when a matching route exists', () => {
    const prefix = 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/';
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: [],
      redirects: [{ from: prefix, to: LOCAL_DIST_SENTINEL }],
      detection: { ...DETECTED, bundled: { present: false, version: null }, cdn: [{ pkg: '@bloklabs/core', version: '1.8.0', prefix }] },
      catalogAvailable: true,
    });
    expect(vm.page.cdn).toEqual([{ pkg: '@bloklabs/core', version: '1.8.0', prefix, routed: true }]);
  });

  it('disables the route builder without a staged dist or without a version catalog', () => {
    const noDist = popupViewModel({
      current: { ...CURRENT, dist: { staged: false } },
      armedOrigins: [],
      redirects: [],
      detection: DETECTED,
      catalogAvailable: true,
    });
    expect(noDist.routeBuilder).toEqual({ enabled: false, reason: 'no-dist' });

    const noCatalog = popupViewModel({ current: CURRENT, armedOrigins: [], redirects: [], detection: DETECTED, catalogAvailable: false });
    expect(noCatalog.routeBuilder).toEqual({ enabled: false, reason: 'no-versions' });

    const ok = popupViewModel({ current: CURRENT, armedOrigins: [], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(ok.routeBuilder).toEqual({ enabled: true, reason: null });
  });
});

describe('popup dedupe between the page card and the elsewhere list', () => {
  const prefix = 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/';

  it('excludes the detected page origin and its routed CDN prefixes from the elsewhere lists', () => {
    const vm = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example', 'https://other.example'],
      redirects: [
        { from: prefix, to: LOCAL_DIST_SENTINEL },
        { from: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.9.0/dist/', to: LOCAL_DIST_SENTINEL },
      ],
      detection: { ...DETECTED, cdn: [{ pkg: '@bloklabs/core', version: '1.8.0', prefix }] },
      catalogAvailable: true,
    });
    expect(vm.otherArmedOrigins).toEqual(['https://other.example']);
    expect(vm.otherRoutes.map((r: { fromLabel: string }) => r.fromLabel)).toEqual(['@bloklabs/core@1.9.0']);
  });

  // A no-blok page on an armed origin renders no switch, so the elsewhere
  // list is the only place left to turn that origin off.
  it('keeps every armed origin and route when the page card cannot show them', () => {
    const noBlok = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [{ from: prefix, to: LOCAL_DIST_SENTINEL }],
      detection: { state: 'no-blok', origin: 'https://kb.example' },
      catalogAvailable: true,
    });
    expect(noBlok.otherArmedOrigins).toEqual(['https://kb.example']);
    expect(noBlok.otherRoutes.map((r: { fromLabel: string }) => r.fromLabel)).toEqual(['@bloklabs/core@1.8.0']);

    const noTab = popupViewModel({
      current: CURRENT,
      armedOrigins: ['https://kb.example'],
      redirects: [{ from: prefix, to: LOCAL_DIST_SENTINEL }],
      detection: { state: 'no-tab' },
      catalogAvailable: true,
    });
    expect(noTab.otherArmedOrigins).toEqual(['https://kb.example']);
    expect(noTab.otherRoutes).toHaveLength(1);
  });
});

describe('redirect labels', () => {
  it('labels a blok CDN prefix by package@version and the sentinel as the local build', () => {
    expect(describeRedirect({ from: 'https://cdn.jsdelivr.net/npm/@bloklabs/core@1.8.0/dist/', to: LOCAL_DIST_SENTINEL })).toEqual({
      fromLabel: '@bloklabs/core@1.8.0',
      toLabel: 'local build',
    });
  });

  it('falls back to raw URLs for custom pairs', () => {
    expect(describeRedirect({ from: 'https://a.example/x/', to: 'http://localhost:3000/dist/' })).toEqual({
      fromLabel: 'https://a.example/x/',
      toLabel: 'http://localhost:3000/dist/',
    });
  });
});
