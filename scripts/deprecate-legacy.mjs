/**
 * Release-day runbook: deprecate the legacy @jackuait/* packages on npmjs
 * after the first @bloklabs/* family release ships.
 *
 * Refuses to run without --yes so it can never fire accidentally from CI or
 * an exploratory shell. Requires the same npm auth as a release
 * (BLOK_NPM_TOKEN in .env, or `npm login`).
 *
 * Usage:
 *   node scripts/deprecate-legacy.mjs          # prints the commands only
 *   node scripts/deprecate-legacy.mjs --yes    # actually deprecates
 */
import { execFileSync } from 'child_process';

const MESSAGE_BY_PACKAGE = {
  '@jackuait/blok':
    'Renamed to @bloklabs/core (adapters: @bloklabs/react, @bloklabs/vue, @bloklabs/angular) — see https://github.com/JackUait/blok/blob/master/CHANGELOG.md',
  '@jackuait/blok-cli':
    'Renamed to @bloklabs/cli — see https://github.com/JackUait/blok/blob/master/CHANGELOG.md',
};

const confirmed = process.argv.includes('--yes');

for (const [pkg, message] of Object.entries(MESSAGE_BY_PACKAGE)) {
  const display = `npm deprecate ${pkg} ${JSON.stringify(message)}`;

  if (confirmed) {
    console.log(`> ${display}`);
    execFileSync('npm', ['deprecate', pkg, message], { stdio: 'inherit' });
  } else {
    console.log(`[dry] ${display}`);
  }
}

if (!confirmed) {
  console.log('\nNothing deprecated. Re-run with --yes to execute the commands above.');
}
