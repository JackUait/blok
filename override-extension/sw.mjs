import { desiredRegistrations, registrationDelta, PAYLOAD_SCRIPT_ID, BANNER_SCRIPT_ID } from './lib/registrations.mjs';

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

const syncRegistrations = async () => {
  const [armedOrigins, current] = await Promise.all([readArmed(), readCurrent()]);
  const desired = desiredRegistrations(armedOrigins, current?.file ?? null);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PAYLOAD_SCRIPT_ID, BANNER_SCRIPT_ID] });
  const { toUnregister, toRegister } = registrationDelta(existing, desired);
  if (toUnregister.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: toUnregister });
  }
  if (toRegister.length > 0) {
    await chrome.scripting.registerContentScripts(toRegister);
  }
};

const arm = async (origin) => {
  const armedOrigins = await readArmed();
  if (!armedOrigins.includes(origin)) {
    await chrome.storage.local.set({ armedOrigins: [...armedOrigins, origin] });
  }
  await syncRegistrations();
};

const disarm = async (origin) => {
  const armedOrigins = (await readArmed()).filter((o) => o !== origin);
  await chrome.storage.local.set({ armedOrigins });
  await syncRegistrations();
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
  void chrome.alarms.create('blok-override-poll', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => void syncRegistrations());
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
    } else if (message?.type === 'status') {
      const [armedOrigins, current] = await Promise.all([readArmed(), readCurrent()]);
      sendResponse({ armedOrigins, current });
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
