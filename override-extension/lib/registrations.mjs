export const PAYLOAD_SCRIPT_ID = 'blok-override-payload';
export const BANNER_SCRIPT_ID = 'blok-override-banner';

const originPattern = (origin) => `${origin.replace(/\/+$/, '')}/*`;

export function desiredRegistrations(armedOrigins, payloadFile) {
  if (armedOrigins.length === 0 || !payloadFile) {
    return [];
  }
  const matches = armedOrigins.map(originPattern);
  return [
    {
      id: PAYLOAD_SCRIPT_ID,
      js: [`payload/${payloadFile}`],
      matches,
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    },
    {
      id: BANNER_SCRIPT_ID,
      js: ['banner.js'],
      matches,
      world: 'ISOLATED',
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ];
}

// Whole-set comparison, not per-id: a changed payload filename still leaves
// the banner registration byte-identical, so a per-id diff would never
// unregister it even though we must re-register the whole set together.
// Only the fields the extension sets. chrome.scripting.getRegisteredContentScripts
// echoes its own key order and adds matchOriginAsFallback, so whole-object JSON
// never matches and every sync would churn the registrations.
const fingerprint = (regs) => JSON.stringify(
  [...regs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => [r.id, r.js, r.matches, r.world, r.runAt, r.allFrames, r.persistAcrossSessions]),
);

export function registrationDelta(existing, desired) {
  const unchanged = fingerprint(existing) === fingerprint(desired);
  if (unchanged) {
    return { toUnregister: [], toRegister: [] };
  }
  return {
    toUnregister: existing.map((r) => r.id),
    toRegister: desired,
  };
}
