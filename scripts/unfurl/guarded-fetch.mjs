import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const forbiddenAddresses = new BlockList();
const forbiddenMappedAddresses = new BlockList();

forbiddenMappedAddresses.addSubnet('::ffff:0:0', 96, 'ipv6');

for (const [network, prefix, type] of [
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['0.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['::', 96, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001::', 23, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['5f00::', 16, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:20::', 28, 'ipv6'],
  ['3fff::', 20, 'ipv6'],
  ['100:0:0:1::', 64, 'ipv6'],
]) {
  forbiddenAddresses.addSubnet(network, prefix, type);
}

const blocked = () => new Error('Outbound destination is not permitted.');

const hostAddress = (hostname) =>
  hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

export function validateOutboundUrl(rawUrl, baseUrl) {
  let target;

  try {
    target = baseUrl === undefined
      ? new URL(rawUrl)
      : new URL(rawUrl, baseUrl);
  } catch {
    throw blocked();
  }

  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    target.hostname === '' ||
    target.username !== '' ||
    target.password !== '' ||
    (target.port !== '' && target.port !== '80' && target.port !== '443')
  ) {
    throw blocked();
  }

  const literal = hostAddress(target.hostname);

  if (isIP(literal) !== 0 && !isAddressAllowed(literal)) {
    throw blocked();
  }

  return target;
}

export function isAddressAllowed(address) {
  const family = isIP(address);

  if (family === 0) {
    return false;
  }

  const type = family === 6 ? 'ipv6' : 'ipv4';

  return !forbiddenAddresses.check(address, type) &&
    !(family === 6 && forbiddenMappedAddresses.check(address, 'ipv6'));
}

const defaultLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

const headerValue = (headers, name) => {
  const entry = Object.entries(headers).find(
    ([header]) => header.toLowerCase() === name,
  )?.[1];

  return Array.isArray(entry) ? entry[0] ?? '' : entry ?? '';
};

const discardBody = (body) => {
  if (typeof body.destroy === 'function') {
    body.destroy();
  }
};

export const createPinnedLookup = (address) => (
  _hostname,
  options,
  callback,
) => {
  if (options.all === true) {
    callback(null, [address]);
    return;
  }

  callback(null, address.address, address.family);
};

const requestPinned = (target, address, init) => new Promise(
  (resolve, reject) => {
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(target, {
      agent: false,
      headers: init.headers,
      lookup: createPinnedLookup(address),
      method: 'GET',
      signal: init.signal,
    }, (response) => {
      resolve({
        body: response,
        headers: response.headers,
        statusCode: response.statusCode ?? 0,
      });
    });

    request.once('error', reject);
    request.end();
  },
);

const resolveAddresses = async (target, lookup) => {
  const hostname = hostAddress(target.hostname);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily === 0
    ? await lookup(hostname)
    : [{ address: hostname, family: literalFamily }];

  // One unsafe answer is enough for DNS rotation to reach it later.
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      family !== isIP(address) || !isAddressAllowed(address))
  ) {
    throw blocked();
  }

  return addresses;
};

const readBodyPrefix = async (body) => {
  const chunks = [];
  let total = 0;

  for await (const value of body) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = MAX_BODY_BYTES - total;

    if (chunk.length >= remaining) {
      chunks.push(chunk.subarray(0, remaining));
      discardBody(body);
      break;
    }

    chunks.push(chunk);
    total += chunk.length;
  }

  return Buffer.concat(chunks).toString('utf8');
};

const responseHeaders = (headers) => ({
  get(name) {
    const value = headerValue(headers, name.toLowerCase());

    return value === '' ? null : value;
  },
});

export function createGuardedFetch({
  lookup = defaultLookup,
  request = requestPinned,
} = {}) {
  return async (rawUrl, init = {}) => {
    let target = validateOutboundUrl(rawUrl);
    let redirectCount = 0;

    while (true) {
      const addresses = await resolveAddresses(target, lookup);
      const headers = new Headers(init.headers);

      headers.set('accept-encoding', 'identity');

      const requestInit = {
        ...init,
        headers: Object.fromEntries(headers.entries()),
        method: 'GET',
        redirect: 'manual',
      };
      const upstream = await request(
        target,
        addresses[0],
        requestInit,
      );
      const location = headerValue(upstream.headers, 'location');

      if (
        REDIRECT_STATUSES.has(upstream.statusCode) &&
        location !== ''
      ) {
        discardBody(upstream.body);

        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error('Too many outbound redirects.');
        }

        target = validateOutboundUrl(location, target);
        redirectCount += 1;
        continue;
      }

      const encoding = headerValue(upstream.headers, 'content-encoding');

      if (encoding !== '' && encoding.toLowerCase() !== 'identity') {
        discardBody(upstream.body);
        throw new Error('Unsupported outbound content encoding.');
      }

      const bodyText = await readBodyPrefix(upstream.body);

      return {
        headers: responseHeaders(upstream.headers),
        ok: upstream.statusCode >= 200 && upstream.statusCode < 300,
        status: upstream.statusCode,
        text: async () => bodyText,
        url: target.href,
      };
    }
  };
}
