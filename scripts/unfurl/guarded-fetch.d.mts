export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface GuardedResponseBody extends AsyncIterable<Uint8Array> {
  destroy?(): void;
}

export interface GuardedUpstreamResponse {
  body: GuardedResponseBody;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
}

export interface GuardedFetchOptions {
  lookup?(hostname: string): Promise<ResolvedAddress[]>;
  request?(
    target: URL,
    address: ResolvedAddress,
    init: RequestInit,
  ): Promise<GuardedUpstreamResponse>;
}

export type GuardedFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function createGuardedFetch(options?: GuardedFetchOptions): GuardedFetch;

export function createPinnedLookup(address: ResolvedAddress): (
  hostname: string,
  options: { all?: boolean },
  callback: (...args: unknown[]) => void,
) => void;

export function isAddressAllowed(address: string): boolean;

export function validateOutboundUrl(rawUrl: string, baseUrl?: string | URL): URL;
