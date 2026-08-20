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
    const live = armed && page.bundled.version !== null && page.bundled.version === current?.version;
    page = {
      ...page,
      armed,
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

  return {
    build,
    page,
    canArm: build.state === 'ready' && blokDetected,
    routeBuilder,
    armedOrigins,
    routes: redirects.map((redirect) => ({ ...redirect, ...describeRedirect(redirect) })),
  };
}
