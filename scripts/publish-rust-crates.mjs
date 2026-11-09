// Publishes blok-mcp and the crates it needs to crates.io, in dependency order.
// Usage: node scripts/publish-rust-crates.mjs <version> [--dry-run]

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { isNewCrateRateLimit, publishOrder, publishedCrates } from './release-cargo.mjs';

const RUST = 'packages/server/rust';
// crates.io refills one new-crate slot every 10 minutes.
const RATE_LIMIT_WAIT_MS = 10 * 60 * 1000 + 30_000;

const version = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!version) {
  console.error('Usage: node scripts/publish-rust-crates.mjs <version> [--dry-run]');
  process.exit(1);
}

const published = new Set(publishedCrates(readFileSync(join(RUST, 'Cargo.toml'), 'utf-8')));
const deps = {};

for (const dir of readdirSync(join(RUST, 'crates'))) {
  const file = join(RUST, 'crates', dir, 'Cargo.toml');

  if (!existsSync(file)) {
    continue;
  }

  const source = readFileSync(file, 'utf-8');
  const name = /^name = "([^"]+)"/m.exec(source)?.[1];

  if (name !== undefined && published.has(name)) {
    const body = source.split(/^\[dependencies\]$/m)[1]?.split(/^\[/m)[0] ?? '';

    deps[name] = [...body.matchAll(/^(blok-[\w-]+)\.workspace = true$/gm)].map((match) => match[1]);
  }
}

const onCratesIo = async (name) => {
  const response = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
    headers: { 'User-Agent': 'blok-release (https://github.com/JackUait/blok)' },
  });

  return response.ok;
};

for (const name of publishOrder(deps)) {
  if (!dryRun && await onCratesIo(name)) {
    console.log(`${name}@${version} is already on crates.io`);
    continue;
  }

  for (;;) {
    const args = ['publish', '-p', name, '--locked', ...(dryRun ? ['--dry-run'] : [])];

    console.log(`\n> cargo ${args.join(' ')}`);
    const result = spawnSync('cargo', args, { cwd: RUST, encoding: 'utf-8', stdio: ['inherit', 'inherit', 'pipe'] });

    process.stderr.write(result.stderr ?? '');

    if (result.status === 0) {
      break;
    }

    if (!isNewCrateRateLimit(result.stderr ?? '')) {
      process.exit(result.status ?? 1);
    }

    console.log('crates.io rate limit for new crates. Waiting 10 minutes.');
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
  }
}
