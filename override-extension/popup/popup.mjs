import { LOCAL_DIST_SENTINEL } from '../lib/dnr.mjs';
import { summarizeDetection } from '../lib/detect.mjs';
import { popupViewModel } from '../lib/view-model.mjs';
import { panelsEqual, captureEphemeral, restoreEphemeral } from '../lib/render-diff.mjs';
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

const checkIcon = () => {
  const icon = h('span', { class: 'check', 'aria-hidden': 'true' });
  // pathLength=1 lets the stroke draw itself in via dashoffset.
  icon.innerHTML = '<svg viewBox="0 0 14 14"><polyline points="2.5,7.5 5.8,10.8 11.5,3.8" pathLength="1"/></svg>';
  return icon;
};

const announce = (text) => {
  document.getElementById('live').textContent = text;
};

const state = {
  status: { armedOrigins: [], current: null, redirects: [] },
  detection: { state: 'no-tab' },
  installedPayload: null,
  targetTabId: null,
  favIconUrl: null,
  favIconBroken: false,
  catalog: null,
  helperOnline: null,
  building: false,
  switching: false,
  swapChoice: null,
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
    return { facts: null, tabId: null, favIconUrl: null, installedPayload: null };
  }
  try {
    const results = await chrome.scripting.executeScript({
      // MAIN world: the payload registry is a page-realm global, and whether it
      // is there is what separates "a reload fixes this" from "nothing will".
      world: 'MAIN',
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
        let payloadVersion = null;
        try {
          const registry = globalThis.__BLOK_DEV_OVERRIDE__;
          // A DOM-clobbered global carries no string version — treat it as absent
          // rather than as a payload that failed, or the popup would never settle.
          payloadVersion = typeof registry?.version === 'string' ? registry.version : null;
        } catch {
          // a cross-origin WindowProxy named like the registry throws on access
        }
        return { hasEditor: root !== null, version: root?.getAttribute('data-blok-version') ?? null, urls, payloadVersion };
      },
    });
    const frames = results.map((r) => r.result).filter(Boolean);
    const withEditor = frames.find((f) => f.hasEditor) ?? null;
    const withPayload = frames.find((f) => f.payloadVersion !== null) ?? null;
    return {
      tabId: tab.id,
      favIconUrl: tab.favIconUrl ?? null,
      installedPayload: withPayload === null ? null : { version: withPayload.payloadVersion },
      facts: {
        origin: new URL(tab.url).origin,
        hasEditor: withEditor !== null,
        version: withEditor?.version ?? null,
        urls: frames.flatMap((f) => f.urls),
      },
    };
  } catch {
    return { facts: null, tabId: null, favIconUrl: null, installedPayload: null };
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

const applyFacts = (page) => {
  const next = summarizeDetection(page.facts);
  // Mid-reload the tab is a blank document: the scan either fails outright or
  // succeeds against an empty page. Neither is news, and taking either would
  // flash "No Blok here" at the exact moment the swap is happening — so while
  // switching, only a fresh detection replaces the card.
  if (state.switching && next.state !== 'detected' && state.detection.state === 'detected') {
    return;
  }
  state.detection = next;
  state.installedPayload = page.installedPayload;
  state.targetTabId = page.tabId ?? (state.switching ? state.targetTabId : null);
  const favIconUrl = page.favIconUrl ?? (state.switching ? state.favIconUrl : null);
  if (favIconUrl !== state.favIconUrl) {
    state.favIconBroken = false;
  }
  state.favIconUrl = favIconUrl;
};

const refresh = async ({ probeHelper = false } = {}) => {
  const [status, page, catalog] = await Promise.all([send({ type: 'status' }), collectFacts(), readCachedCatalog()]);
  state.status = status;
  applyFacts(page);
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

const pageRunsYours = () => state.detection.state === 'detected'
  && state.detection.bundled.version !== null
  && state.detection.bundled.version === state.status.current?.version;

const swapState = () => (viewModel().page.swap ?? 'off');

// The worker reloads the page as part of arming; the popup only watches. The
// budget is generous because the dev payload is multi-MB — a page that is
// merely slow must not be mistaken for one that cannot swap.
const SWAP_POLLS = 20;

// Toggling again mid-swap starts a second watcher; the older one must go quiet
// rather than clear `switching` out from under the live one.
let swapWatch = 0;

const watchSwap = async (wantYours = true) => {
  const generation = ++swapWatch;
  state.switching = true;
  render();
  const settled = () => (wantYours ? pageRunsYours() || swapState() === 'blocked' : !pageRunsYours());
  for (let attempt = 0; attempt < SWAP_POLLS; attempt += 1) {
    await sleep(600);
    if (generation !== swapWatch) {
      return;
    }
    applyFacts(await collectFacts());
    render();
    if (settled()) {
      break;
    }
  }
  state.switching = false;
  render();
  if (!wantYours) {
    announce('This page is back on its own Blok');
  } else {
    announce(pageRunsYours() ? 'Your build is live on this page' : 'This page has not switched to your build');
  }
};

const arm = async (origin) => {
  state.switching = true;
  render();
  announce(`Switching ${new URL(origin).host} to your build`);
  await send({ type: 'arm', origin });
  await refresh();
  await watchSwap();
};

const disarm = async (origin) => {
  state.switching = true;
  render();
  announce(`Putting ${new URL(origin).host} back on its own Blok`);
  await send({ type: 'disarm', origin });
  await refresh();
  await watchSwap(false);
};

const setRedirects = async (redirects, { reloadPage: reload = false } = {}) => {
  await send({ type: 'setRedirects', redirects, tabId: reload ? state.targetTabId : null });
  if (reload) {
    state.switching = true;
  }
  await refresh();
  if (reload) {
    await watchSwap();
  }
};

// A page armed before this build was staged (or before the popup opened) is one
// reload away from correct — take it, once, without asking. 'blocked' is the
// state this must never touch: the payload is already in the realm and the
// page's blok ignored it, so reloading would loop forever.
let autoSwapped = false;
const autoSwapStalePage = async () => {
  const { page } = viewModel();
  if (autoSwapped || state.targetTabId === null || page.state !== 'detected' || !page.armed || page.swap !== 'pending') {
    return;
  }
  autoSwapped = true;
  announce('Switching this page to your build');
  state.switching = true;
  render();
  await send({ type: 'reloadTab', tabId: state.targetTabId });
  await watchSwap();
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
  // The status round-trip re-registers the new payload hash AND hands the worker
  // the rebuild it propagates to every armed tab — so the reload is already
  // under way while refresh's own scan runs. Claim `switching` before it, or
  // that scan lands on the blank document and collapses the card.
  state.switching = true;
  await refresh();
  const onArmedPage = state.detection.state === 'detected' && state.status.armedOrigins.includes(state.detection.origin);
  if (onArmedPage && !pageRunsYours()) {
    await watchSwap();
  } else {
    state.switching = false;
    render();
    announce('Your local build is fresh again');
  }
};

/* ---------- rendering ---------- */

const copyButton = (text, label) => h('button', {
  class: 'btn btn--ghost',
  'aria-label': label,
  onclick: async (event) => {
    // currentTarget is nulled once dispatch ends — grab it before the await.
    const btn = event.currentTarget;
    await navigator.clipboard.writeText(text);
    btn.classList.add('btn--copied');
    btn.textContent = 'Copied!';
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
  if (state.favIconUrl && !state.favIconBroken) {
    const img = h('img', { class: 'site-favicon', src: state.favIconUrl, alt: '' });
    // A broken favicon must land in state, not in an img.remove() — the diffing
    // render would resurrect the img every poll and loop the error forever.
    img.addEventListener('error', () => {
      state.favIconBroken = true;
      render();
    });
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
    return h('div', { class: 'page-status' },
      h('span', { class: 'pill pill--green' }, checkIcon(), h('span', {}, h('b', {}, 'Running your build'))),
      h('span', { class: 'suffix-chip' }, bundled.version));
  }
  const isDev = (bundled.version ?? '').includes('-dev.');
  const name = isDev
    ? ['your older build ', h('span', { class: 'suffix-chip' }, bundled.version)]
    : bundled.version ? ['Blok ', h('b', {}, bundled.version)] : ['an older Blok'];
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  if (page.armed) {
    return h('div', { class: 'page-status' },
      h('span', { class: 'pill pill--orange' }, dot, h('span', {}, 'Still on ', ...name)));
  }
  return h('div', { class: 'page-status' },
    h('span', { class: 'pill pill--gray' }, dot, h('span', {}, 'Runs ', ...name)));
};

// No button lives here on purpose: 'pending' is already being acted on, and
// 'blocked' is a state no amount of reloading would move.
const swapCallout = (vm) => {
  if (vm.page.swap === 'pending') {
    return h('div', { class: 'callout', dataset: { tone: 'orange' } },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('div', { class: 'callout-copy' }, h('b', {}, 'Switching to your build'), 'reloading the page for you…'));
  }
  if (vm.page.swap === 'blocked') {
    return h('div', { class: 'callout', dataset: { tone: 'orange' } },
      h('div', { class: 'callout-copy' },
        h('b', {}, 'This page can’t be switched'),
        'its Blok is older than the swap needs — the site has to ship a newer release once'));
  }
  return null;
};

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
      } else {
        void arm(origin);
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

  const { origin, bundled, cdn } = vm.page;
  const url = new URL(origin);

  const children = [
    label,
    h('div', { class: 'site-row' },
      siteIcon(url.host),
      h('div', { class: 'site-main' },
        h('div', { class: 'origin', title: origin }, url.host),
        pageStatusLine(vm.page))),
  ];

  if (bundled.present) {
    children.push(renderSwitchRow(vm));
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
          onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== ref.prefix), { reloadPage: true }),
        }, 'Stop')
        : h('button', {
          class: 'btn btn--primary',
          'aria-label': `Use your build for ${refLabel}`,
          disabled: vm.build.state !== 'ready' || !vm.build.dist.staged ? true : undefined,
          onclick: () => void setRedirects([...state.status.redirects, { from: ref.prefix, to: LOCAL_DIST_SENTINEL }], { reloadPage: true }),
        }, 'Use your build'),
    ));
    if (!ref.routed && vm.build.state === 'ready' && !vm.build.dist.staged) {
      children.push(h('p', { class: 'hint hint--warn' }, 'to use your build here, run ', h('code', { class: 'chip' }, 'yarn build'), ' once, then ', h('code', { class: 'chip' }, SYNC_CMD)));
    }
  }

  // Below the rows it explains — after arming it sits under the switch, after
  // a CDN swap under that row.
  const callout = swapCallout(vm);
  if (callout) {
    children.push(callout);
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
    !showRebuild ? h('details', { class: 'builder', dataset: { key: 'serve-help' } },
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

// The chosen version is module state so consecutive renders serialize
// identically and the poll's skip path leaves an open list untouched; the
// ephemeral rest (expansion, query, active option) lives only in the live DOM
// and rides through replaces via render-diff's combobox carry.
const versionCombobox = (entries, chosenKey) => {
  const options = [];
  const rows = [];
  for (const pkg of KNOWN_PACKAGES) {
    const group = entries.filter((entry) => entry.pkg === pkg);
    if (group.length === 0) {
      continue;
    }
    rows.push(h('li', { class: 'combo-group', role: 'presentation', dataset: { pkg } }, pkg));
    for (const entry of group) {
      const opt = h('li', {
        class: 'combo-opt',
        role: 'option',
        id: `combo-opt-${options.length}`,
        'aria-selected': String(entry.key === chosenKey),
        dataset: { value: entry.key, pkg },
      }, entry.version);
      options.push(opt);
      rows.push(opt);
    }
  }

  const setActive = (opt) => {
    for (const el of options) {
      if (el !== opt) {
        el.removeAttribute('data-active');
      }
    }
    if (opt) {
      opt.setAttribute('data-active', '');
      input.setAttribute('aria-activedescendant', opt.id);
      opt.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const visible = () => options.filter((opt) => !opt.hidden);

  const applyFilter = (query) => {
    const q = query.trim().toLowerCase();
    for (const opt of options) {
      opt.hidden = !`${opt.dataset.pkg}@${opt.textContent}`.toLowerCase().includes(q);
    }
    for (const group of list.querySelectorAll('.combo-group')) {
      group.hidden = !options.some((opt) => !opt.hidden && opt.dataset.pkg === group.dataset.pkg);
    }
    const open = visible();
    empty.hidden = open.length > 0;
    setActive(open.find((opt) => opt.hasAttribute('data-active')) ?? open[0] ?? null);
  };

  const openPanel = () => {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setActive(visible().find((opt) => opt.dataset.value === chosenKey) ?? visible()[0] ?? null);
    input.focus();
  };

  const closePanel = () => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    input.value = '';
    applyFilter('');
  };

  const choose = (key) => {
    closePanel();
    trigger.focus();
    state.swapChoice = key;
    render();
  };

  const trigger = h('button', {
    class: 'combo-trigger',
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': 'Published version to swap out',
    onclick: () => (panel.hidden ? openPanel() : closePanel()),
    onkeydown: (event) => {
      if (event.key === 'ArrowDown' && panel.hidden) {
        event.preventDefault();
        openPanel();
      }
    },
  }, chosenKey ? chosenKey.replaceAll('|', '@') : 'No versions');

  const input = h('input', {
    class: 'combo-search',
    type: 'text',
    'aria-label': 'Search versions',
    'aria-controls': 'combo-list',
    placeholder: 'Search versions…',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: () => applyFilter(input.value),
    onkeydown: (event) => {
      const open = visible();
      const at = open.findIndex((opt) => opt.hasAttribute('data-active'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? Math.min(at + 1, open.length - 1) : Math.max(at - 1, 0);
        setActive(open[next] ?? null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const active = open[at];
        if (active) {
          choose(active.dataset.value);
        }
      } else if (event.key === 'Escape') {
        closePanel();
        trigger.focus();
      }
    },
  });

  const list = h('ul', {
    class: 'combo-list',
    id: 'combo-list',
    role: 'listbox',
    'aria-label': 'Published versions',
    // Options are not focusable; without this an option click blurs the
    // search input first and the focusout below closes the panel mid-click.
    onmousedown: (event) => event.preventDefault(),
    onclick: (event) => {
      const opt = event.target.closest('.combo-opt');
      if (opt) {
        choose(opt.dataset.value);
      }
    },
  }, ...rows);

  const empty = h('p', { class: 'combo-empty', hidden: true }, 'No versions match');
  const panel = h('div', { class: 'combo-panel', 'data-combobox-panel': '', hidden: true }, input, list, empty);

  return h('div', {
    class: 'combo',
    'data-combobox': '',
    dataset: { key: 'swap-version' },
    onfocusout: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        closePanel();
      }
    },
  }, trigger, panel);
};

const renderSwapBuilder = (vm) => {
  if (vm.page.state !== 'detected') {
    return null;
  }

  let body = null;
  if (vm.routeBuilder.enabled) {
    const merged = mergeVersionCatalog(state.catalog.byPackage);
    const entries = merged.map((entry) => ({ ...entry, key: `${entry.pkg}|${entry.version}` }));
    const chosenKey = entries.some((entry) => entry.key === state.swapChoice) ? state.swapChoice : entries[0]?.key ?? null;
    body = h('details', { class: 'builder', dataset: { key: 'swap-builder' } },
      h('summary', {}, 'Swap out a published version'),
      h('div', { class: 'builder-body' },
        versionCombobox(entries, chosenKey),
        h('button', {
          class: 'btn btn--primary',
          disabled: chosenKey === null ? true : undefined,
          onclick: () => {
            const [pkg, version] = chosenKey.split('|');
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

const viewModel = () => popupViewModel({
  current: state.status.current,
  armedOrigins: state.status.armedOrigins,
  redirects: state.status.redirects,
  detection: state.detection,
  installedPayload: state.installedPayload,
  catalogAvailable: state.catalog !== null,
});

let renderCount = 0;

const render = () => {
  const vm = viewModel();

  // With no build yet the popup's story is onboarding; with one, the page
  // you're looking at comes first.
  const cards = vm.build.state === 'ready'
    ? [renderPageCard(vm), renderBuildCard(vm), renderElsewhereCard(vm), renderSwapBuilder(vm)]
    : [renderBuildCard(vm), renderPageCard(vm), renderElsewhereCard(vm)];

  const next = document.createElement('div');
  next.append(...cards.filter(Boolean));

  const panels = document.getElementById('panels');
  // The entrance stagger belongs to the first paint alone. Add-once, then let a
  // timer outlive the longest card delay+duration: stripping it on the next
  // render instead would cancel the stagger mid-flight, because the helper
  // probe re-renders within ~30ms when the dev server is up.
  renderCount += 1;
  if (renderCount === 1) {
    panels.classList.add('intro');
    setTimeout(() => panels.classList.remove('intro'), 500);
  }
  // An unchanged render must not touch the DOM: the 600ms swap poll would
  // replay every animation and collapse whatever the user had open.
  if (!panelsEqual(panels, next)) {
    const snapshot = captureEphemeral(panels);
    panels.replaceChildren(...next.childNodes);
    restoreEphemeral(panels, snapshot);
  }
  document.getElementById('progress').classList.toggle('progress--active', state.switching || state.building);
  document.getElementById('app').removeAttribute('aria-busy');
};

void (async () => {
  await refresh({ probeHelper: true });
  await autoSwapStalePage();
})();
