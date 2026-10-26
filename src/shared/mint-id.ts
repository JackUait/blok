// Keep nanoid's URL-safe alphabet so both minters produce compatible IDs.
const ALPHABET = '57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9';

export const mintId = (length = 10): string => {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.getRandomValues === 'function') {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(length)), byte => ALPHABET[byte & 63]).join('');
  }

  return Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * 64)]).join('');
};
