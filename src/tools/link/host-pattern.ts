/**
 * `[::ffff:a.b.c.d]` as `a.b.c.d`: browsers reach the IPv4 server through the
 * mapped form, so both must match one entry. Takes a hostname as `new URL`
 * spells it; any other host comes back unchanged.
 */
const unmapIPv4 = (host: string): string => {
  if (!host.startsWith('[')) {
    return host;
  }

  const canonical = ((): string => {
    try {
      return new URL(`https://${host}`).hostname;
    } catch {
      return host;
    }
  })();
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(canonical);

  if (mapped === null) {
    return host;
  }

  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

/** A config entry reduced to the host `new URL` would give. */
interface HostEntry {
  /** Written as `*.host`: subdomains only. */
  wildcard: boolean;
  /** Lower case, punycode, no trailing dot; IPv6 in brackets. */
  host: string;
  /** The port the entry named ('' for 443), or null for none. */
  port: string | null;
  /**
   * The entry names nothing beyond an https host and port: no other scheme,
   * no path, no userinfo. Only such an entry may widen an allow list.
   */
  exact: boolean;
}

/** `new URL`'s form of a port, or null when it is not a valid port. */
const canonicalPort = (port: string): string | null => {
  try {
    return new URL(`https://h:${port}`).port;
  } catch {
    return null;
  }
};

/**
 * Reads a host list entry written as a host (`a.com`, `*.a.com`, `bücher.de`,
 * `::1`) or as an origin (`https://a.com:8443/`). Returns null when no host
 * can be read.
 * @param raw - the config entry
 */
function parseHostEntry(raw: string): HostEntry | null {
  const trimmed = raw.trim();

  if (trimmed === '' || /\s/.test(trimmed)) {
    return null;
  }

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  const afterScheme = scheme === null ? trimmed : trimmed.slice(scheme[0].length);
  const cut = afterScheme.search(/[/?#\\]/);
  const authority = cut === -1 ? afterScheme : afterScheme.slice(0, cut);
  const tail = cut === -1 ? '' : afterScheme.slice(cut);
  // The browser reads the host after the last `@`.
  const at = authority.lastIndexOf('@');
  const hostAndPort = authority.slice(at + 1);
  const wildcard = hostAndPort.startsWith('*.');
  const rest = wildcard ? hostAndPort.slice(2) : hostAndPort;
  const split = splitPort(rest);

  if (split === null) {
    return null;
  }

  const host = ((): string => {
    try {
      return unmapIPv4(new URL(`https://${split.host}`).hostname.replace(/\.$/, ''));
    } catch {
      return '';
    }
  })();

  if (host === '') {
    return null;
  }

  const port = split.port === null ? null : canonicalPort(split.port);
  const exact = (scheme === null || scheme[1].toLowerCase() === 'https')
    && (tail === '' || tail === '/')
    && at === -1
    && (split.port === null || port !== null);

  return { wildcard, host, port, exact };
}

/** Splits `host:port`, `[v6]:port` and a bare IPv6 literal. Null when malformed. */
function splitPort(value: string): { host: string; port: string | null } | null {
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    const after = value.slice(close + 1);

    if (close === -1 || (after !== '' && !after.startsWith(':'))) {
      return null;
    }

    return { host: value.slice(0, close + 1), port: after === '' ? null : after.slice(1) };
  }

  const colons = value.split(':').length - 1;

  if (colons >= 2) {
    return { host: `[${value}]`, port: null };
  }

  if (colons === 1) {
    const index = value.indexOf(':');

    return { host: value.slice(0, index), port: value.slice(index + 1) };
  }

  return { host: value, port: null };
}

const hostMatches = (host: string, entry: Pick<HostEntry, 'wildcard' | 'host'>): boolean =>
  entry.wildcard ? host.endsWith(`.${entry.host}`) : host === entry.host;

/**
 * Whether `hostname` matches one of `patterns`, for an ALLOW list: an exact
 * hostname (`dashboards.example.com`) or a wildcard (`*.example.dev`), also
 * written as an https origin. A wildcard matches any subdomain depth but never
 * the bare suffix. An entry that names a port matches only that port, and an
 * entry that names more than an https host (a path, another scheme, userinfo)
 * matches nothing. Pass the hostname parsed by `new URL`, never the raw
 * string, so a listed name in a path or query can't match.
 * @param hostname - the URL's hostname
 * @param patterns - the allow list
 * @param port - the URL's port ('' for the default)
 */
export function matchesHostPattern(hostname: string, patterns: readonly string[], port = ''): boolean {
  const host = unmapIPv4(hostname.toLowerCase());

  return patterns.some((pattern) => {
    const entry = parseHostEntry(pattern);

    return entry !== null && entry.exact && (entry.port === null || entry.port === port) && hostMatches(host, entry);
  });
}

/**
 * The hosts a DENY-side entry (`blockedEmbedOrigins`, `hostAliases`) stands
 * for. The raw spellings are kept next to the parsed one, so reading an
 * origin form can only add matches, never drop one.
 * @param pattern - the config entry
 */
function denyEntries(pattern: string): Array<Pick<HostEntry, 'wildcard' | 'host'>> {
  const raw = pattern.trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  const bare = wildcard ? raw.slice(2) : raw;
  const legacy = ((): string => {
    try {
      return unmapIPv4(new URL(`https://${bare.replace(/\.$/, '')}`).hostname.replace(/\.$/, ''));
    } catch {
      return '';
    }
  })();
  const parsed = parseHostEntry(pattern);
  const hosts = [bare, bare.replace(/\.$/, ''), legacy].filter((host) => host !== '');

  return [
    ...hosts.map((host) => ({ wildcard, host })),
    ...(parsed === null ? [] : [parsed]),
  ];
}

/**
 * Whether `hostname` matches a DENY-side entry, by host only: the port, any
 * path and the scheme of an origin-form entry are ignored, so it blocks at
 * least what it names.
 * @param hostname - the URL's hostname
 * @param patterns - the deny list
 */
export function matchesDenyHostPattern(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  const hosts = [host, host.replace(/\.$/, ''), unmapIPv4(host)];

  return patterns.some((pattern) => denyEntries(pattern).some((entry) => hosts.some((h) => h !== '' && hostMatches(h, entry))));
}

const bareHost = (name: string): string => name.toLowerCase().replace(/\.$/, '').replace(/^\*\./, '');

/**
 * Whether `hostname` is one of `ownHosts`, a subdomain of one, or a parent
 * domain of one. Matching is on dot boundaries only. Sibling subdomains
 * (`cdn.example.com` for `app.example.com`) are NOT caught: that needs the
 * public suffix list. An entry may be written as an origin; its port, path
 * and scheme are ignored.
 */
export function isSameSiteHost(hostname: string, ownHosts: readonly string[]): boolean {
  const host = unmapIPv4(bareHost(hostname));

  if (host === '') {
    return false;
  }

  return ownHosts.some((entry) => denyEntries(entry).some(({ host: own }) => (
    own !== '' && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`))
  )));
}

/** The page's hostname plus the host's `linkPaste.hostAliases`. */
export function pageHosts(aliases: readonly string[] = []): string[] {
  // Empty under file:// and about:blank; it must not count as a host.
  const current = typeof window === 'undefined' ? '' : window.location.hostname;

  return current === '' ? [...aliases] : [current, ...aliases];
}
