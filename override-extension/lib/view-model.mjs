import { LOCAL_DIST_SENTINEL } from './dnr.mjs';
import { parseCdnBlokUrl } from './detect.mjs';

export function describeRedirect(redirect) {
  const ref = parseCdnBlokUrl(redirect.from);
  return {
    fromLabel: ref ? `${ref.pkg}@${ref.version}` : redirect.from,
    toLabel: redirect.to === LOCAL_DIST_SENTINEL ? 'local build' : redirect.to,
  };
}

export function popupViewModel({ current, armedOrigins = [], redirects = [], detection, catalogAvailable = false }) {
  const build = current
    ? { state: 'ready', version: current.version, builtAt: current.builtAt, helper: current.helper ?? null, dist: current.dist ?? { staged: false } }
    : { state: 'missing' };

  let page = detection ?? { state: 'no-tab' };
  if (page.state === 'detected') {
    const armed = armedOrigins.includes(page.origin);
    const runningYours = page.bundled.version !== null && page.bundled.version === current?.version;
    const live = armed && runningYours;
    page = {
      ...page,
      armed,
      runningYours,
      live,
      skew: armed && !live,
      cdn: page.cdn.map((ref) => ({ ...ref, routed: redirects.some((r) => r.from === ref.prefix) })),
    };
  }

  const distStaged = build.state === 'ready' && build.dist.staged === true;
  const blokDetected = page.state === 'detected';
  const routeBuilder = {
    enabled: build.state === 'ready' && blokDetected && distStaged && catalogAvailable,
    reason: null,
  };
  if (!routeBuilder.enabled) {
    routeBuilder.reason = !distStaged && build.state === 'ready' && blokDetected ? 'no-dist'
      : blokDetected && distStaged && !catalogAvailable ? 'no-versions'
      : null;
  }

  const routes = redirects.map((redirect) => ({ ...redirect, ...describeRedirect(redirect) }));
  // The page card owns rows for the detected origin and its CDN prefixes; the
  // elsewhere list must not repeat them — but only when the page card can
  // actually show them, or an armed no-blok origin becomes impossible to
  // turn off.
  const pageCdnPrefixes = new Set(blokDetected ? page.cdn.map((ref) => ref.prefix) : []);

  return {
    build,
    page,
    canArm: build.state === 'ready' && blokDetected,
    routeBuilder,
    armedOrigins,
    otherArmedOrigins: armedOrigins.filter((origin) => !(blokDetected && origin === page.origin)),
    routes,
    otherRoutes: routes.filter((route) => !pageCdnPrefixes.has(route.from)),
  };
}
