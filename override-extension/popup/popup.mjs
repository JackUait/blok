import { LOCAL_DIST_SENTINEL } from '../lib/dnr.mjs';
import { summarizeDetection } from '../lib/detect.mjs';
import { popupViewModel } from '../lib/view-model.mjs';
import { KNOWN_PACKAGES, mergeVersionCatalog, cdnPrefixFor, formatAgo, shouldRefreshCatalog } from '../lib/versions.mjs';

const CATALOG_TTL = 6 * 60 * 60 * 1000;
const SYNC_CMD = 'yarn override:sync';
const SERVE_CMD = 'yarn override:sync --serve';

const send = (message) => chrome.runtime.sendMessage(message);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  favIconUrl: null,
  catalog: null,
  helperOnline: null,
  building: false,
  reloading: false,
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
    return { facts: null, tabId: null, favIconUrl: null };
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
      favIconUrl: tab.favIconUrl ?? null,
      facts: {
        origin: new URL(tab.url).origin,
        hasEditor: withEditor !== null,
        version: withEditor?.version ?? null,
        urls: frames.flatMap((f) => f.urls),
      },
    };
  } catch {
    return { facts: null, tabId: null, favIconUrl: null };
  }
};

const readCachedCatalog = async () => (await chrome.storage.local.get('versionCatalog')).versionCatalog ?? null;

// The catalog only feeds the version-swap builder, so it must never hold up
// the first render — refresh() paints from the storage cache and this fetch
// re-renders whenever it lands.
let catalogRefreshStarted = false;
const refreshCatalogInBackground = () => {
  if (catalogRefreshStarted || !shouldRefreshCatalog(state.catalog, Date.now(), CATALOG_TTL)) {
    return;
  }
  catalogRefreshStarted = true;
  void (async () => {
    try {
      const byPackage = {};
      await Promise.all(KNOWN_PACKAGES.map(async (pkg) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(`https://data.jsdelivr.com/v1/package/npm/${pkg}`, { signal: controller.signal });
          if (!res.ok) {
            throw new Error(`${res.status}`);
          }
          byPackage[pkg] = (await res.json()).versions;
        } finally {
          clearTimeout(timer);
        }
      }));
      const fresh = { fetchedAt: Date.now(), byPackage };
      await chrome.storage.local.set({ versionCatalog: fresh });
      state.catalog = fresh;
      render();
    } catch {
      // stale-on-error: the cached catalog (or the no-versions hint) stands
    }
  })();
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
  const [status, page, catalog] = await Promise.all([send({ type: 'status' }), collectFacts(), readCachedCatalog()]);
  state.status = status;
  state.detection = summarizeDetection(page.facts);
  state.targetTabId = page.tabId;
  state.favIconUrl = page.favIconUrl;
  state.catalog = catalog;
  render();
  refreshCatalogInBackground();
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
  announce(`Your build is on for ${origin} — reload the page to see it`);
  await refresh();
};

const disarm = async (origin) => {
  await send({ type: 'disarm', origin });
  announce(`Your build is off for ${origin}`);
  await refresh();
};

const setRedirects = async (redirects) => {
  await send({ type: 'setRedirects', redirects });
  await refresh();
};

const pageRunsYours = () => state.detection.state === 'detected'
  && state.detection.bundled.version !== null
  && state.detection.bundled.version === state.status.current?.version;

const reloadPage = async () => {
  if (state.targetTabId === null || state.reloading) {
    return;
  }
  state.reloading = true;
  render();
  announce('Reloading the page');
  await chrome.tabs.reload(state.targetTabId);
  // Poll until the fresh page reports in; while the tab is mid-load the
  // injected scan fails and facts come back null — keep the last good
  // detection instead of collapsing the card.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(600);
    const { facts, tabId, favIconUrl } = await collectFacts();
    if (!facts) {
      continue;
    }
    state.detection = summarizeDetection(facts);
    state.targetTabId = tabId ?? state.targetTabId;
    state.favIconUrl = favIconUrl ?? state.favIconUrl;
    if (pageRunsYours()) {
      break;
    }
  }
  state.reloading = false;
  render();
  announce(pageRunsYours() ? 'Your build is live on this page' : 'Page reloaded');
};

const rebuild = async () => {
  const helper = state.status.current?.helper;
  if (!helper || state.building) {
    return;
  }
  state.building = true;
  render();
  announce('Rebuilding your local build');
  const result = await helperFetch(helper, '/build', { method: 'POST' });
  state.building = false;
  if (result === null) {
    state.helperOnline = false;
    announce('The rebuild helper is offline');
    render();
    return;
  }
  // The status round-trip re-registers the new payload hash — reloading
  // before it would load the stale payload and land right back on skew.
  await refresh();
  const onArmedPage = state.detection.state === 'detected' && state.status.armedOrigins.includes(state.detection.origin);
  if (onArmedPage && !pageRunsYours()) {
    announce('Fresh build — reloading the page');
    await reloadPage();
  } else {
    announce('Your local build is fresh again');
  }
};

/* ---------- rendering ---------- */

const copyButton = (text, label) => h('button', {
  class: 'btn btn--ghost',
  'aria-label': label,
  onclick: async (event) => {
    await navigator.clipboard.writeText(text);
    event.currentTarget.textContent = 'Copied!';
    setTimeout(render, 900);
  },
}, 'Copy');

const commandChip = (cmd) => h('div', { class: 'cmd' }, h('code', {}, cmd), copyButton(cmd, `Copy ${cmd}`));

// Splitting at -dev. keeps the release part strong and the hash quiet; the
// suffix chip carries the literal "-dev." the e2e looks for.
const versionText = (version) => {
  const at = version.indexOf('-dev.');
  if (at === -1) {
    return [h('b', { class: 'version-num' }, version)];
  }
  return [h('b', { class: 'version-num' }, version.slice(0, at)), h('span', { class: 'suffix-chip' }, version.slice(at))];
};

const siteIcon = (host) => {
  const tile = h('span', { class: 'site-icon', 'aria-hidden': 'true' },
    h('span', { class: 'site-letter' }, host.replace(/^www\./, '').charAt(0).toUpperCase()));
  if (state.favIconUrl) {
    const img = h('img', { class: 'site-favicon', src: state.favIconUrl, alt: '' });
    img.addEventListener('error', () => img.remove());
    tile.append(img);
  }
  return tile;
};

const emptyState = (title, sub) => h('div', { class: 'empty' },
  h('p', { class: 'empty-title' }, title),
  h('p', { class: 'empty-sub' }, sub));

/* ---------- this page ---------- */

const pageStatusLine = (page) => {
  const { bundled } = page;
  if (!bundled.present) {
    // CDN-only pages get itemized rows below; a generic line would repeat them.
    return null;
  }
  if (page.runningYours) {
    return h('div', { class: 'page-status' }, led('on'),
      h('span', {}, h('b', {}, 'Running your build'), ' ', h('span', { class: 'suffix-chip' }, bundled.version)));
  }
  const isDev = (bundled.version ?? '').includes('-dev.');
  const name = isDev
    ? ['your older build ', h('span', { class: 'suffix-chip' }, bundled.version)]
    : bundled.version ? ['Blok ', h('b', {}, bundled.version)] : ['an older Blok'];
  if (page.armed) {
    return h('div', { class: 'page-status' }, led('warn'), h('span', {}, 'Still on ', ...name));
  }
  return h('div', { class: 'page-status' }, led('on'), h('span', {}, 'Runs ', ...name));
};

const reloadCallout = (title, sub) => h('div', { class: 'callout', dataset: { tone: 'orange' } },
  h('div', { class: 'callout-copy' }, h('b', {}, title), sub),
  h('button', {
    class: 'btn btn--primary',
    disabled: state.reloading || undefined,
    onclick: () => void reloadPage(),
  }, state.reloading ? 'Reloading…' : 'Reload'));

const renderSwitchRow = (vm) => {
  const { origin, armed } = vm.page;
  const disabled = !vm.canArm && !armed;
  const switchBtn = h('button', {
    class: 'switch',
    role: 'switch',
    'aria-checked': String(armed),
    'aria-label': `Use your build on ${origin}`,
    disabled: disabled || undefined,
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
  return h('div', {
    class: `switch-row${disabled ? ' switch-row--disabled' : ''}`,
    onclick: (event) => {
      if (disabled || event.target.closest('.switch')) {
        return;
      }
      switchBtn.click();
    },
  },
  h('div', { class: 'switch-copy' },
    h('b', {}, 'Use your build on this site'),
    disabled ? h('span', { class: 'switch-sub' }, 'waiting for a local build') : null,
  ),
  switchBtn);
};

const renderPageCard = (vm) => {
  const label = h('p', { class: 'card-label' },
    'This page',
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn--ghost', onclick: () => refresh() }, 'Check again'),
  );

  if (vm.page.state === 'no-tab') {
    return h('section', { class: 'card' }, label,
      emptyState('Nothing to check here', 'open a page that uses Blok and try again'));
  }

  if (vm.page.state === 'no-blok') {
    return h('section', { class: 'card' }, label,
      emptyState('No Blok here', `${new URL(vm.page.origin).host} doesn’t seem to use Blok`));
  }

  const { origin, bundled, cdn, armed } = vm.page;
  const url = new URL(origin);

  const children = [
    label,
    h('div', { class: 'site-row' }, siteIcon(url.host), h('div', { class: 'origin', title: origin }, url.host)),
  ];
  const status = pageStatusLine(vm.page);
  if (status) {
    children.push(status);
  }

  if (bundled.present) {
    children.push(renderSwitchRow(vm));

    if (state.confirmArm && !armed) {
      children.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': `Confirm using your build on ${origin}` },
        h('b', {}, `Use your build on ${url.host}?`), ' Every page on this site will run your local build until you turn it off.',
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn--primary', onclick: () => void arm(origin) }, 'Yes, use it'),
          h('button', { class: 'btn', onclick: () => { state.confirmArm = false; render(); } }, 'Cancel'),
        ),
      ));
    }
  }

  for (const ref of cdn) {
    const refLabel = `${ref.pkg}@${ref.version}`;
    children.push(h('div', { class: 'cdn-row' },
      led(ref.routed ? 'on' : null),
      h('div', { class: 'cdn-copy' },
        h('b', {}, ref.routed ? 'Using your build' : 'Loaded from the CDN'),
        h('code', { class: 'chip' }, refLabel)),
      ref.routed
        ? h('button', {
          class: 'btn btn--danger',
          'aria-label': `Stop using your build for ${refLabel}`,
          onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== ref.prefix)),
        }, 'Stop')
        : h('button', {
          class: 'btn btn--primary',
          'aria-label': `Use your build for ${refLabel}`,
          disabled: vm.build.state !== 'ready' || !vm.build.dist.staged ? true : undefined,
          onclick: () => void setRedirects([...state.status.redirects, { from: ref.prefix, to: LOCAL_DIST_SENTINEL }]),
        }, 'Use your build'),
    ));
    if (!ref.routed && vm.build.state === 'ready' && !vm.build.dist.staged) {
      children.push(h('p', { class: 'hint hint--warn' }, 'to use your build here, run ', h('code', { class: 'chip' }, 'yarn build'), ' once, then ', h('code', { class: 'chip' }, SYNC_CMD)));
    }
  }

  // Below the rows it explains — after arming it sits under the switch, after
  // a CDN swap under that row.
  const needsReload = bundled.present && !vm.page.runningYours && (armed || cdn.some((ref) => ref.routed));
  if (needsReload) {
    children.push((bundled.version ?? '').includes('-dev.')
      ? reloadCallout('New build ready', 'reload the page to pick it up')
      : reloadCallout('Almost there', 'reload the page to switch to your build'));
  }

  return h('section', { class: 'card' }, ...children);
};

/* ---------- your build ---------- */

const renderBuildCard = (vm) => {
  const label = h('p', { class: 'card-label' }, 'Your build');
  if (vm.build.state === 'missing') {
    return h('section', { class: 'card' },
      label,
      emptyState('No local build yet', 'run this in the blok repo to get started:'),
      commandChip(SYNC_CMD),
    );
  }

  const { version, builtAt, helper, dist } = vm.build;
  const meta = h('div', { class: 'meta' },
    h('span', {}, `Built ${formatAgo(builtAt, Date.now())}`),
    !dist.staged ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null,
    !dist.staged ? h('span', { class: 'warn' }, 'version swaps need a one-time yarn build') : null,
  );

  const showRebuild = helper !== null && state.helperOnline !== false;
  const rebuildBtn = h('button', {
    class: `btn${state.building ? ' btn--busy' : ''}`,
    disabled: state.building || undefined,
    onclick: rebuild,
  }, h('span', { class: 'icon', 'aria-hidden': 'true' }, '↻'), state.building ? 'Building…' : 'Rebuild');

  return h('section', { class: 'card' },
    label,
    h('div', { class: 'build-row' },
      h('div', { class: 'build-id' }, h('div', { class: 'version' }, ...versionText(version)), meta),
      showRebuild ? rebuildBtn : null,
    ),
    !showRebuild ? h('details', { class: 'builder' },
      h('summary', {}, 'Want a Rebuild button here?'),
      h('p', { class: 'hint' }, 'run this in the blok repo and reopen the popup — the button appears right here:'),
      commandChip(SERVE_CMD),
    ) : null,
  );
};

/* ---------- also using your build ---------- */

const renderElsewhereCard = (vm) => {
  const originRows = vm.otherArmedOrigins.map((origin) => h('li', { class: 'row' },
    led('on'),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', title: origin }, new URL(origin).host)),
    h('button', { class: 'btn btn--danger', 'aria-label': `Stop using your build on ${origin}`, onclick: () => void disarm(origin) }, 'Stop'),
  ));

  const routeRows = vm.otherRoutes.map((route) => h('li', { class: 'row' },
    led(route.to === LOCAL_DIST_SENTINEL ? 'on' : 'warn'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title', title: route.from },
        route.fromLabel.startsWith('@') ? h('code', { class: 'chip' }, route.fromLabel) : route.fromLabel),
      h('div', { class: 'row-sub' }, route.to === LOCAL_DIST_SENTINEL ? 'any site that loads this version' : route.toLabel),
    ),
    h('button', {
      class: 'btn btn--danger',
      'aria-label': `Stop using your build for ${route.fromLabel}`,
      onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== route.from)),
    }, 'Stop'),
  ));

  const rows = [...originRows, ...routeRows];
  if (rows.length === 0) {
    return null;
  }
  return h('section', { class: 'card' },
    h('p', { class: 'card-label' }, 'Also using your build', h('span', { class: 'count' }, String(rows.length))),
    h('ul', { class: 'rows', role: 'list', 'aria-label': 'Also using your build' }, ...rows),
  );
};

/* ---------- swap a published version ---------- */

const renderSwapBuilder = (vm) => {
  if (vm.page.state !== 'detected') {
    return null;
  }

  let body = null;
  if (vm.routeBuilder.enabled) {
    const merged = mergeVersionCatalog(state.catalog.byPackage);
    const select = h('select', { id: 'swap-version', 'aria-label': 'Published version to swap out' },
      ...KNOWN_PACKAGES.map((pkg) => {
        const options = merged.filter((entry) => entry.pkg === pkg)
          .map((entry) => h('option', { value: `${entry.pkg}|${entry.version}` }, entry.version));
        return options.length > 0 ? h('optgroup', { label: pkg }, ...options) : null;
      }),
    );
    body = h('details', { class: 'builder' },
      h('summary', {}, 'Swap out a published version'),
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
            announce(`${pkg}@${version} now points to your build`);
          },
        }, 'Swap it in'),
      ),
      h('p', { class: 'hint' }, 'any site that loads this version from jsdelivr gets your build instead'),
    );
  } else if (vm.routeBuilder.reason === 'no-versions') {
    body = h('p', { class: 'hint' }, 'couldn’t load the version list — maybe offline? Anything detected above still works');
  }

  if (body === null) {
    return null;
  }
  return h('section', { class: 'card card--quiet' }, body);
};

const render = () => {
  const vm = popupViewModel({
    current: state.status.current,
    armedOrigins: state.status.armedOrigins,
    redirects: state.status.redirects,
    detection: state.detection,
    catalogAvailable: state.catalog !== null,
  });

  // With no build yet the popup's story is onboarding; with one, the page
  // you're looking at comes first.
  const cards = vm.build.state === 'ready'
    ? [renderPageCard(vm), renderBuildCard(vm), renderElsewhereCard(vm), renderSwapBuilder(vm)]
    : [renderBuildCard(vm), renderPageCard(vm), renderElsewhereCard(vm)];

  const panels = document.getElementById('panels');
  panels.textContent = '';
  for (const card of cards) {
    if (card) {
      panels.appendChild(card);
    }
  }
  document.getElementById('app').removeAttribute('aria-busy');
};

void refresh({ probeHelper: true });
