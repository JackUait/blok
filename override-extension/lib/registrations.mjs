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
export function registrationDelta(existing, desired) {
  const sortById = (regs) => [...regs].sort((a, b) => a.id.localeCompare(b.id));
  const unchanged = JSON.stringify(sortById(existing)) === JSON.stringify(sortById(desired));
  if (unchanged) {
    return { toUnregister: [], toRegister: [] };
  }
  return {
    toUnregister: existing.map((r) => r.id),
    toRegister: desired,
  };
}
