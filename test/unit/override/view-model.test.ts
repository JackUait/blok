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

  it('flags version skew when armed but the page still runs another build', () => {
    const vm = popupViewModel({ current: CURRENT, armedOrigins: ['https://kb.example'], redirects: [], detection: DETECTED, catalogAvailable: true });
    expect(vm.page).toMatchObject({ armed: true, live: false, skew: true });
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
