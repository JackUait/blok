import { LOCAL_DIST_SENTINEL } from '../lib/dnr.mjs';
import { summarizeDetection } from '../lib/detect.mjs';
import { popupViewModel } from '../lib/view-model.mjs';
import { KNOWN_PACKAGES, mergeVersionCatalog, cdnPrefixFor, formatAgo, shouldRefreshCatalog } from '../lib/versions.mjs';

const CATALOG_TTL = 6 * 60 * 60 * 1000;
const SYNC_CMD = 'yarn override:sync';
const SERVE_CMD = 'yarn override:sync --serve';

const send = (message) => chrome.runtime.sendMessage(message);

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on')) {
      el.addEventListener(key.slice(2), value);
    } else if (value !== null && value !== undefined && value !== false) {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
};

const led = (state) => h('span', { class: `led${state ? ` led--${state}` : ''}`, 'aria-hidden': 'true' });

const announce = (text) => {
  document.getElementById('live').textContent = text;
};

const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);

const state = {
  status: { armedOrigins: [], current: null, redirects: [] },
  detection: { state: 'no-tab' },
  targetTabId: null,
  catalog: null,
  helperOnline: null,
  building: false,
  confirmArm: false,
};

/* ---------- data gathering ---------- */

const getTargetTab = async () => {
  const selfUrl = chrome.runtime.getURL('');
  const foreign = (t) => !(t.url ?? '').startsWith(selfUrl);
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && foreign(focused)) {
    return focused;
  }
  const actives = (await chrome.tabs.query({ active: true })).filter(foreign);
  return actives.find((t) => /^https?:/.test(t.url ?? '')) ?? actives[0] ?? null;
};

const collectFacts = async () => {
  const tab = await getTargetTab();
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
    return { facts: null, tabId: null };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        // Marker union spans every published version: data-blok-editor since
        // 0.10, the interface/testid pair on the handful of releases before it.
        const root = document.querySelector('[data-blok-editor], [data-blok-interface="blok"], [data-blok-testid="blok-editor"]');
        let urls = [...document.scripts].map((s) => s.src).filter(Boolean);
        try {
          urls = urls.concat(performance.getEntriesByType('resource').map((entry) => entry.name));
        } catch {
          // script-tag scan still covers CDN detection
        }
        return { hasEditor: root !== null, version: root?.getAttribute('data-blok-version') ?? null, urls };
      },
    });
    const frames = results.map((r) => r.result).filter(Boolean);
    const withEditor = frames.find((f) => f.hasEditor) ?? null;
    return {
      tabId: tab.id,
      facts: {
        origin: new URL(tab.url).origin,
        hasEditor: withEditor !== null,
        version: withEditor?.version ?? null,
        urls: frames.flatMap((f) => f.urls),
      },
    };
  } catch {
    return { facts: null, tabId: null };
  }
};

const loadCatalog = async () => {
  const { versionCatalog = null } = await chrome.storage.local.get('versionCatalog');
  if (!shouldRefreshCatalog(versionCatalog, Date.now(), CATALOG_TTL)) {
    return versionCatalog;
  }
  try {
    const byPackage = {};
    await Promise.all(KNOWN_PACKAGES.map(async (pkg) => {
      const res = await fetch(`https://data.jsdelivr.com/v1/package/npm/${pkg}`);
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      byPackage[pkg] = (await res.json()).versions;
    }));
    const fresh = { fetchedAt: Date.now(), byPackage };
    await chrome.storage.local.set({ versionCatalog: fresh });
    return fresh;
  } catch {
    return versionCatalog;
  }
};

const helperFetch = async (helper, path, init = {}, timeoutMs = null) => {
  const controller = new AbortController();
  const timer = timeoutMs === null ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${helper.port}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${helper.token}` },
      signal: controller.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const refresh = async ({ probeHelper = false } = {}) => {
  const [status, page, catalog] = await Promise.all([send({ type: 'status' }), collectFacts(), loadCatalog()]);
  state.status = status;
  state.detection = summarizeDetection(page.facts);
  state.targetTabId = page.tabId;
  state.catalog = catalog;
  render();
  if (probeHelper && state.status.current?.helper) {
    state.helperOnline = (await helperFetch(state.status.current.helper, '/status', {}, 900)) !== null;
    render();
  } else if (probeHelper) {
    state.helperOnline = false;
  }
};

/* ---------- actions ---------- */

const arm = async (origin) => {
  await send({ type: 'arm', origin });
  state.confirmArm = false;
  announce(`Armed ${origin} — reload the page to swap in the local build`);
  await refresh();
};

const disarm = async (origin) => {
  await send({ type: 'disarm', origin });
  announce(`Disarmed ${origin}`);
  await refresh();
};

const setRedirects = async (redirects) => {
  await send({ type: 'setRedirects', redirects });
  await refresh();
};

const rebuild = async () => {
  const helper = state.status.current?.helper;
  if (!helper || state.building) {
    return;
  }
  state.building = true;
  render();
  announce('Rebuilding local payload');
  const result = await helperFetch(helper, '/build', { method: 'POST' });
  state.building = false;
  if (result === null) {
    state.helperOnline = false;
    announce('Rebuild helper is offline');
    render();
  } else {
    announce('Local build refreshed');
    await refresh();
  }
};

/* ---------- rendering ---------- */

const copyButton = (text, label) => h('button', {
  class: 'btn btn--ghost',
  'aria-label': label,
  onclick: async (event) => {
    await navigator.clipboard.writeText(text);
    event.currentTarget.textContent = 'copied';
    setTimeout(render, 900);
  },
}, 'copy');

const commandChip = (cmd) => h('div', { class: 'cmd' }, h('code', {}, cmd), copyButton(cmd, `Copy ${cmd}`));

const versionEl = (version) => h('div', { class: 'version' }, version ?? '');

const renderBuildCard = (vm) => {
  const label = h('p', { class: 'card-label' }, 'Local build');
  if (vm.build.state === 'missing') {
    return h('section', { class: 'card' },
      label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No local build synced'),
        h('p', { class: 'empty-sub' }, 'run this in the blok repo:'),
      ),
      commandChip(SYNC_CMD),
    );
  }

  const { version, builtAt, helper, dist } = vm.build;
  const meta = h('div', { class: 'meta' },
    h('span', {}, `built ${formatAgo(builtAt, Date.now())}`),
    h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'),
    dist.staged
      ? h('span', {}, `dist ${formatAgo(dist.builtAt ?? builtAt, Date.now())}`)
      : h('span', { class: 'warn' }, 'no dist — CDN routes off'),
  );

  const showRebuild = helper !== null && state.helperOnline !== false;
  const rebuildBtn = h('button', {
    class: `btn${state.building ? ' btn--busy' : ''}`,
    disabled: state.building || undefined,
    onclick: rebuild,
  }, h('span', { class: 'icon', 'aria-hidden': 'true' }, '↻'), state.building ? 'building…' : 'Rebuild');

  return h('section', { class: 'card' },
    label,
    h('div', { class: 'build-row' },
      h('div', { class: 'build-id' }, versionEl(version), meta),
      showRebuild ? rebuildBtn : null,
    ),
    !showRebuild ? h('details', { class: 'builder' },
      h('summary', {}, 'Rebuild from the popup'),
      h('p', { class: 'hint' }, 'run this in the blok repo, then reopen the popup — the Rebuild button appears here:'),
      commandChip(SERVE_CMD),
    ) : null,
  );
};

const armCopy = (page, buildVersion) => {
  if (!page.armed) {
    return { state: 'idle', title: 'Override off', sub: 'arm to swap this origin to your local build' };
  }
  if (page.live) {
    return { state: 'live', title: 'Live', sub: `running local build ${buildVersion}` };
  }
  if ((page.bundled.version ?? '').includes('-dev.')) {
    return { state: 'stale', title: 'Stale build on page', sub: 'reload the page to pick up the newest payload' };
  }
  return { state: 'stale', title: 'Armed', sub: 'reload the page to swap in the local build' };
};

const renderPageCard = (vm) => {
  const label = h('p', { class: 'card-label' },
    'This page',
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn--ghost', onclick: () => refresh() }, 'Rescan'),
  );

  if (vm.page.state === 'no-tab') {
    return h('section', { class: 'card' }, label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'Nothing to override here'),
        h('p', { class: 'empty-sub' }, 'open a page that runs Blok, then reopen the popup'),
      ));
  }

  if (vm.page.state === 'no-blok') {
    return h('section', { class: 'card' }, label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No Blok on this page'),
        h('p', { class: 'empty-sub' }, `nothing detected on ${new URL(vm.page.origin).host} — overriding is disabled`),
      ));
  }

  const { origin, bundled, cdn, armed } = vm.page;
  const url = new URL(origin);
  const copy = armCopy(vm.page, vm.build.state === 'ready' ? vm.build.version : '');

  const detectedLine = bundled.present
    ? h('div', { class: 'page-status' }, led('on'),
      h('span', {}, 'Blok ', h('b', {}, bundled.version ?? 'version unknown — pre-seam'),
        (bundled.version ?? '').includes('-dev.') ? ' — local payload' : ' — bundled'))
    : h('div', { class: 'page-status' }, led('on'), h('span', {}, 'Blok loads from CDN scripts below'));

  const children = [
    label,
    h('div', { class: 'origin-row' },
      h('span', { class: 'scheme' }, `${url.protocol}//`),
      h('div', { class: 'origin', title: origin }, url.host),
    ),
    detectedLine,
  ];

  if (bundled.present) {
    const switchBtn = h('button', {
      class: 'switch',
      role: 'switch',
      'aria-checked': String(armed),
      'aria-label': `Arm ${origin}`,
      disabled: !vm.canArm && !armed ? true : undefined,
      onclick: () => {
        if (armed) {
          void disarm(origin);
        } else if (isLocalhost(origin)) {
          void arm(origin);
        } else {
          state.confirmArm = true;
          render();
        }
      },
    });
    children.push(h('div', { class: 'arm-row', dataset: { state: copy.state } },
      h('div', { class: 'arm-copy' }, h('b', {}, copy.title), copy.sub),
      switchBtn,
    ));
    if (state.confirmArm && !armed) {
      children.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': `Confirm arming ${origin}` },
        h('b', {}, `Arm ${url.host}?`), ` Every page on this origin will run your local build.`,
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn--primary', onclick: () => void arm(origin) }, 'Arm origin'),
          h('button', { class: 'btn', onclick: () => { state.confirmArm = false; render(); } }, 'Cancel'),
        ),
      ));
    }
  }

  for (const ref of cdn) {
    const routeLabel = `${ref.pkg}@${ref.version}`;
    children.push(h('div', { class: 'arm-row', dataset: { state: ref.routed ? 'live' : 'idle' } },
      h('div', { class: 'arm-copy' },
        h('b', {}, ref.routed ? 'Routed to local build' : 'CDN script'),
        h('code', { class: 'chip' }, routeLabel),
      ),
      ref.routed
        ? h('button', {
          class: 'btn btn--danger',
          'aria-label': `Remove route for ${routeLabel}`,
          onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== ref.prefix)),
        }, 'Unroute')
        : h('button', {
          class: 'btn btn--primary',
          'aria-label': `Route ${routeLabel} to the local build`,
          disabled: vm.build.state !== 'ready' || !vm.build.dist.staged ? true : undefined,
          onclick: () => void setRedirects([...state.status.redirects, { from: ref.prefix, to: LOCAL_DIST_SENTINEL }]),
        }, '→ local'),
    ));
    if (!ref.routed && vm.build.state === 'ready' && !vm.build.dist.staged) {
      children.push(h('p', { class: 'hint hint--warn' }, 'routing needs a staged dist — run ', h('code', { class: 'chip' }, 'yarn build'), ' then ', h('code', { class: 'chip' }, SYNC_CMD)));
    }
  }

  return h('section', { class: 'card' }, ...children);
};

const renderArmedCard = (vm) => {
  if (vm.armedOrigins.length === 0) {
    return null;
  }
  return h('section', { class: 'card' },
    h('p', { class: 'card-label' }, 'Armed origins', h('span', { class: 'count' }, String(vm.armedOrigins.length))),
    h('ul', { class: 'rows', role: 'list', 'aria-label': 'Armed origins' },
      ...vm.armedOrigins.map((origin) => h('li', { class: 'row' },
        led('on'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', title: origin }, origin)),
        h('button', { class: 'btn btn--danger', 'aria-label': `Disarm ${origin}`, onclick: () => void disarm(origin) }, 'Disarm'),
      )),
    ));
};

const renderRoutesCard = (vm) => {
  const showBuilder = vm.page.state === 'detected';
  if (vm.routes.length === 0 && !showBuilder) {
    return null;
  }

  const rows = h('ul', { class: 'rows', role: 'list', 'aria-label': 'CDN routes' },
    ...vm.routes.map((route) => h('li', { class: 'row' },
      led(route.to === LOCAL_DIST_SENTINEL ? 'on' : 'warn'),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title', title: route.from },
          route.fromLabel.startsWith('@') ? h('code', { class: 'chip' }, route.fromLabel) : route.fromLabel),
        h('div', { class: 'row-sub' }, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→ '), h('span', { class: 'to' }, route.toLabel)),
      ),
      h('button', {
        class: 'btn btn--danger',
        'aria-label': `Remove route ${route.fromLabel}`,
        onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== route.from)),
      }, 'Remove'),
    )));

  let builder = null;
  if (showBuilder && vm.routeBuilder.enabled) {
    const merged = mergeVersionCatalog(state.catalog.byPackage);
    const select = h('select', { id: 'route-version', 'aria-label': 'CDN version to intercept' },
      ...KNOWN_PACKAGES.map((pkg) => {
        const options = merged.filter((entry) => entry.pkg === pkg)
          .map((entry) => h('option', { value: `${entry.pkg}|${entry.version}` }, entry.version));
        return options.length > 0 ? h('optgroup', { label: pkg }, ...options) : null;
      }),
    );
    builder = h('details', { class: 'builder' },
      h('summary', {}, 'Route another CDN version'),
      h('div', { class: 'builder-body' },
        h('div', { class: 'select-wrap' }, select),
        h('button', {
          class: 'btn btn--primary',
          onclick: () => {
            const [pkg, version] = select.value.split('|');
            const from = cdnPrefixFor(pkg, version);
            if (!state.status.redirects.some((r) => r.from === from)) {
              void setRedirects([...state.status.redirects, { from, to: LOCAL_DIST_SENTINEL }]);
            }
            announce(`Routing ${pkg}@${version} to the local build`);
          },
        }, 'Add route'),
      ),
      h('p', { class: 'hint' }, 'intercepts that version’s jsdelivr /dist/ URLs on any page'),
    );
  } else if (showBuilder && vm.routeBuilder.reason === 'no-dist') {
    builder = h('p', { class: 'hint hint--warn' }, 'CDN routing needs a dist build — run ', h('code', { class: 'chip' }, 'yarn build'), ' then ', h('code', { class: 'chip' }, SYNC_CMD));
  } else if (showBuilder && vm.routeBuilder.reason === 'no-versions') {
    builder = h('p', { class: 'hint hint--warn' }, 'couldn’t load the version list (offline?) — detected CDN scripts can still be routed above');
  }

  return h('section', { class: 'card' },
    h('p', { class: 'card-label' }, 'CDN routes', vm.routes.length > 0 ? h('span', { class: 'count' }, String(vm.routes.length)) : null),
    rows,
    builder,
  );
};

const render = () => {
  const vm = popupViewModel({
    current: state.status.current,
    armedOrigins: state.status.armedOrigins,
    redirects: state.status.redirects,
    detection: state.detection,
    catalogAvailable: state.catalog !== null,
  });

  const health = document.getElementById('health-led');
  health.className = `led ${vm.build.state === 'ready' ? 'led--on' : 'led--warn'}`;

  const panels = document.getElementById('panels');
  panels.textContent = '';
  for (const card of [renderBuildCard(vm), renderPageCard(vm), renderArmedCard(vm), renderRoutesCard(vm)]) {
    if (card) {
      panels.appendChild(card);
    }
  }
  document.getElementById('app').removeAttribute('aria-busy');
};

void refresh({ probeHelper: true });
