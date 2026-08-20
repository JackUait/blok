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
  announce(`Local build turned on for ${origin} — reload the page to see it`);
  await refresh();
};

const disarm = async (origin) => {
  await send({ type: 'disarm', origin });
  announce(`Local build turned off for ${origin}`);
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
  announce('Rebuilding your local payload');
  const result = await helperFetch(helper, '/build', { method: 'POST' });
  state.building = false;
  if (result === null) {
    state.helperOnline = false;
    announce('The rebuild helper is offline');
    render();
  } else {
    announce('Your local build is fresh again');
    await refresh();
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

const versionEl = (version) => h('div', { class: 'version' }, version ?? '');

const renderBuildCard = (vm) => {
  const label = h('p', { class: 'card-label' }, 'Local build');
  if (vm.build.state === 'missing') {
    return h('section', { class: 'card' },
      label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No local build yet'),
        h('p', { class: 'empty-sub' }, 'run this in the blok repo to get started:'),
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
      : h('span', { class: 'warn' }, 'CDN routes need a one-time yarn build'),
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
      h('div', { class: 'build-id' }, versionEl(version), meta),
      showRebuild ? rebuildBtn : null,
    ),
    !showRebuild ? h('details', { class: 'builder' },
      h('summary', {}, 'Want a Rebuild button here?'),
      h('p', { class: 'hint' }, 'run this in the blok repo and reopen the popup — the button appears right here:'),
      commandChip(SERVE_CMD),
    ) : null,
  );
};

const armCopy = (page) => {
  if (!page.armed) {
    return { state: 'idle', title: 'Local build off', sub: 'turn the switch on to use your build here' };
  }
  if (page.live) {
    return { state: 'live', title: 'Live', sub: 'this page is running your local build' };
  }
  if ((page.bundled.version ?? '').includes('-dev.')) {
    return { state: 'stale', title: 'New build ready', sub: 'reload the page to pick it up' };
  }
  return { state: 'stale', title: 'Almost there', sub: 'reload the page to switch to your local build' };
};

const renderPageCard = (vm) => {
  const label = h('p', { class: 'card-label' },
    'This page',
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn--ghost', onclick: () => refresh() }, 'Check again'),
  );

  if (vm.page.state === 'no-tab') {
    return h('section', { class: 'card' }, label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'Nothing to override here'),
        h('p', { class: 'empty-sub' }, 'open a page that uses Blok and try again'),
      ));
  }

  if (vm.page.state === 'no-blok') {
    return h('section', { class: 'card' }, label,
      h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No Blok on this page'),
        h('p', { class: 'empty-sub' }, `we couldn’t find Blok on ${new URL(vm.page.origin).host}, so there’s nothing to override`),
      ));
  }

  const { origin, bundled, cdn, armed } = vm.page;
  const url = new URL(origin);
  const copy = armCopy(vm.page);

  const detectedLine = bundled.present
    ? h('div', { class: 'page-status' }, led('on'),
      (bundled.version ?? '').includes('-dev.')
        ? h('span', {}, 'Runs your local build ', h('b', {}, bundled.version))
        : bundled.version
          ? h('span', {}, 'Runs Blok ', h('b', {}, bundled.version))
          : h('span', {}, 'Runs Blok — ', h('b', {}, 'version unknown'), ', probably an older build'))
    : h('div', { class: 'page-status' }, led('on'), h('span', {}, 'Loads Blok from a CDN'));

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
      'aria-label': `Use local build on ${origin}`,
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
      children.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': `Confirm using the local build on ${origin}` },
        h('b', {}, `Use your build on ${url.host}?`), ` Every page on this site will run your local build until you turn it off.`,
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn--primary', onclick: () => void arm(origin) }, 'Yes, use it'),
          h('button', { class: 'btn', onclick: () => { state.confirmArm = false; render(); } }, 'Cancel'),
        ),
      ));
    }
  }

  for (const ref of cdn) {
    const routeLabel = `${ref.pkg}@${ref.version}`;
    children.push(h('div', { class: 'arm-row', dataset: { state: ref.routed ? 'live' : 'idle' } },
      h('div', { class: 'arm-copy' },
        h('b', {}, ref.routed ? 'Using your local build' : 'Loaded from CDN'),
        h('code', { class: 'chip' }, routeLabel),
      ),
      ref.routed
        ? h('button', {
          class: 'btn btn--danger',
          'aria-label': `Stop using the local build for ${routeLabel}`,
          onclick: () => void setRedirects(state.status.redirects.filter((r) => r.from !== ref.prefix)),
        }, 'Turn off')
        : h('button', {
          class: 'btn btn--primary',
          'aria-label': `Use the local build for ${routeLabel}`,
          disabled: vm.build.state !== 'ready' || !vm.build.dist.staged ? true : undefined,
          onclick: () => void setRedirects([...state.status.redirects, { from: ref.prefix, to: LOCAL_DIST_SENTINEL }]),
        }, 'Use local'),
    ));
    if (!ref.routed && vm.build.state === 'ready' && !vm.build.dist.staged) {
      children.push(h('p', { class: 'hint hint--warn' }, 'to use your build here, run ', h('code', { class: 'chip' }, 'yarn build'), ' once, then ', h('code', { class: 'chip' }, SYNC_CMD)));
    }
  }

  return h('section', { class: 'card' }, ...children);
};

const renderArmedCard = (vm) => {
  if (vm.armedOrigins.length === 0) {
    return null;
  }
  return h('section', { class: 'card' },
    h('p', { class: 'card-label' }, 'Sites using your build', h('span', { class: 'count' }, String(vm.armedOrigins.length))),
    h('ul', { class: 'rows', role: 'list', 'aria-label': 'Sites using your build' },
      ...vm.armedOrigins.map((origin) => h('li', { class: 'row' },
        led('on'),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title', title: origin }, origin)),
        h('button', { class: 'btn btn--danger', 'aria-label': `Turn off the local build on ${origin}`, onclick: () => void disarm(origin) }, 'Turn off'),
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
      h('summary', {}, 'Override another version'),
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
            announce(`${pkg}@${version} now points to your local build`);
          },
        }, 'Add route'),
      ),
      h('p', { class: 'hint' }, 'any page loading this version from jsdelivr gets your local build instead'),
    );
  } else if (showBuilder && vm.routeBuilder.reason === 'no-dist') {
    builder = h('p', { class: 'hint hint--warn' }, 'CDN overrides need a one-time ', h('code', { class: 'chip' }, 'yarn build'), ', then ', h('code', { class: 'chip' }, SYNC_CMD));
  } else if (showBuilder && vm.routeBuilder.reason === 'no-versions') {
    builder = h('p', { class: 'hint hint--warn' }, 'couldn’t load the version list — maybe offline? Anything detected above still works');
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
