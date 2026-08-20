import { desiredRegistrations, registrationDelta, PAYLOAD_SCRIPT_ID, BANNER_SCRIPT_ID } from './lib/registrations.mjs';
import { buildRedirectRules, resolveRedirectTargets } from './lib/dnr.mjs';
import { tabsToReload, shouldReloadForPayload } from './lib/reload-targets.mjs';

const readCurrent = async () => {
  try {
    const res = await fetch(chrome.runtime.getURL('payload/current.json'), { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

const readArmed = async () => {
  const { armedOrigins = [] } = await chrome.storage.local.get('armedOrigins');
  return armedOrigins;
};

// Nobody presses Reload in this extension: the payload is read at module
// evaluation, so every state change that should be visible on a live page is
// followed by the worker reloading that page itself.
const reloadTabs = async (tabIds) => {
  await Promise.all(tabIds.map((id) => chrome.tabs.reload(id).catch(() => {
    // the tab closed or navigated away mid-flight — nothing to swap there
  })));
};

const reloadOrigins = async (origins) => {
  if (origins.length === 0) {
    return;
  }
  await reloadTabs(tabsToReload(await chrome.tabs.query({}), origins));
};

const syncRegistrations = async () => {
  const [armedOrigins, current] = await Promise.all([readArmed(), readCurrent()]);
  const payloadFile = current?.file ?? null;
  const desired = desiredRegistrations(armedOrigins, payloadFile);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PAYLOAD_SCRIPT_ID, BANNER_SCRIPT_ID] });
  const { toUnregister, toRegister } = registrationDelta(existing, desired);
  if (toUnregister.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: toUnregister });
  }
  if (toRegister.length > 0) {
    await chrome.scripting.registerContentScripts(toRegister);
  }
  await propagateRebuild(armedOrigins, payloadFile);
};

// `yarn override:sync --watch` restages the payload under a new filename; armed
// pages pick it up on their own from here. The baseline is written BEFORE the
// reloads because the alarm and a popup `status` message can run this
// concurrently — a late write would make the second caller reload again.
const propagateRebuild = async (armedOrigins, payloadFile) => {
  const { payloadBaseline = null } = await chrome.storage.session.get('payloadBaseline');
  const rebuilt = shouldReloadForPayload(payloadBaseline, payloadFile);
  if (payloadBaseline !== payloadFile) {
    await chrome.storage.session.set({ payloadBaseline: payloadFile });
  }
  if (rebuilt) {
    await reloadOrigins(armedOrigins);
  }
};

const arm = async (origin) => {
  const armedOrigins = await readArmed();
  if (!armedOrigins.includes(origin)) {
    await chrome.storage.local.set({ armedOrigins: [...armedOrigins, origin] });
  }
  // Registration must land before the reload — the payload has to be there at
  // document_start of the very load this triggers.
  await syncRegistrations();
  await reloadOrigins([origin]);
};

const disarm = async (origin) => {
  const armedOrigins = (await readArmed()).filter((o) => o !== origin);
  await chrome.storage.local.set({ armedOrigins });
  await syncRegistrations();
  await reloadOrigins([origin]);
};

const syncRedirects = async () => {
  const { redirects = [] } = await chrome.storage.local.get('redirects');
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: buildRedirectRules(resolveRedirectTargets(redirects, chrome.runtime.getURL('payload/dist/'))),
  });
};

const setRedirects = async (redirects, tabId = null) => {
  await chrome.storage.local.set({ redirects });
  await syncRedirects();
  if (tabId !== null) {
    await reloadTabs([tabId]);
  }
};

const updateBadge = async (tabId, url) => {
  if (!url || !/^https?:/.test(url)) {
    return;
  }
  const armedOrigins = await readArmed();
  const armed = armedOrigins.includes(new URL(url).origin);
  await chrome.action.setBadgeText({ tabId, text: armed ? 'ON' : '' });
  if (armed) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f37' });
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void syncRegistrations();
  void syncRedirects();
  void chrome.alarms.create('blok-override-poll', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  void syncRegistrations();
  void syncRedirects();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'blok-override-poll') {
    void syncRegistrations();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => updateBadge(tabId, tab.url));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    void updateBadge(tabId, tab.url);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'arm') {
      await arm(message.origin);
      sendResponse({ ok: true });
    } else if (message?.type === 'disarm') {
      await disarm(message.origin);
      sendResponse({ ok: true });
    } else if (message?.type === 'setRedirects') {
      await setRedirects(message.redirects, message.tabId ?? null);
      sendResponse({ ok: true });
    } else if (message?.type === 'reloadTab') {
      await reloadTabs([message.tabId]);
      sendResponse({ ok: true });
    } else if (message?.type === 'status') {
      await syncRegistrations();
      const [armedOrigins, current] = await Promise.all([readArmed(), readCurrent()]);
      const { redirects = [] } = await chrome.storage.local.get('redirects');
      sendResponse({ armedOrigins, current, redirects });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

// E2E hooks — the Playwright spec drives arming through the same code paths
// the popup uses (worker.evaluate cannot post runtime messages to itself).
globalThis.armOriginForTests = arm;
globalThis.disarmOriginForTests = disarm;
globalThis.setRedirectsForTests = setRedirects;
