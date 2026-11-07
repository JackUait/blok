import { resolve } from 'node:path';

import { parseMcpArgs } from '../../../src/mcp/config';
import { contractFlagsOf, readManifestFiles } from '../../../src/mcp/contract-flags';
import { mcpContractsFor } from '../../../src/view/mcp-contracts';

export interface ContractRevisions { stored: string; live: string }

const cache = new Map<string, ContractRevisions>();

/**
 * The contractRevision Node reports on blok_open for these start flags, worked out
 * with Node's own code at this Blok version. It hashes the version, so fixtures hold
 * a placeholder and every target must still give exactly this value.
 * Undefined when Node would refuse to start with these flags.
 */
export const nodeContractRevisions = async (input: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  version: string;
}): Promise<ContractRevisions | undefined> => {
  const loaded = await (async () => {
    const { options, files } = parseMcpArgs(input.argv, input.env);
    const paths = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, resolve(input.cwd, path)]));

    return { ...options, ...await readManifestFiles(paths) };
  })().catch(() => undefined);

  if (loaded === undefined) {
    return undefined;
  }
  const flags = contractFlagsOf(loaded);
  const key = JSON.stringify([input.version, flags]);
  const known = cache.get(key);

  if (known !== undefined) {
    return known;
  }
  // getBlokVersion() reads the global when the bundler define is absent, as under vitest.
  const holder = globalThis as { VERSION?: unknown };
  const before = holder.VERSION;

  holder.VERSION = input.version;
  try {
    const contracts = mcpContractsFor(flags);
    const revisions = { stored: contracts.stored.revision, live: contracts.live.revision };

    cache.set(key, revisions);

    return revisions;
  } finally {
    holder.VERSION = before;
  }
};
