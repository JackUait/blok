import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Build the `npm publish` command that publishes a pre-packed tarball.
 *
 * @param {object} opts
 * @param {string} opts.packJson - Raw JSON string returned by `npm pack --json`
 * @param {string} opts.packDir  - Directory the tarball was written to
 * @param {string} opts.tag      - npm dist-tag (e.g. "beta", "latest")
 * @returns {string} The shell command to run
 */
export function gprPublishCommand({ packJson, packDir, tag }) {
  const tarballPath = join(packDir, JSON.parse(packJson)[0].filename);

  return `npm publish ${tarballPath} --tag ${tag}`;
}

// --- Only run the release flow when executed directly (not imported by tests) ---

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  // Load .env so BLOK_NPM_TOKEN is available without polluting the shell profile
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf-8').split('\n')) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);

      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }

  let cleanupNpmrc = false;

  const version = process.argv[2];

  if (!version) {
    console.error('Usage: yarn release <version>');
    console.error('Examples:');
    console.error('  yarn release 1.0.0            # stable');
    console.error('  yarn release 1.0.0-beta.1     # beta (auto-detected)');
    process.exit(1);
  }

  const isBeta = version.includes('-');
  const tag = isBeta ? 'beta' : 'latest';
  const gitTag = `v${version}`;

  function run(cmd, opts = {}) {
    console.log(`\n> ${cmd}`);

    return execSync(cmd, { stdio: 'inherit', ...opts });
  }

  function runCapture(cmd) {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  }

  // --- Validate ---

  const status = runCapture('git status --porcelain');

  if (status) {
    console.error('Working tree is not clean. Commit or stash changes first.');
    process.exit(1);
  }

  const npmToken = process.env.BLOK_NPM_TOKEN;

  if (npmToken) {
    // Write a project-scoped .npmrc so npm publish uses the automation token
    writeFileSync('.npmrc', `//registry.npmjs.org/:_authToken=${npmToken}\n`);
    cleanupNpmrc = true;
  }

  try {
    runCapture('npm whoami');
  } catch {
    console.error('Not logged in to npm. Set BLOK_NPM_TOKEN in .env or run `npm login` first.');
    process.exit(1);
  }

  // --- Preflight ---

  console.log(`\nReleasing ${version} (tag: ${tag})\n`);

  run('yarn release:preflight');

  // --- Bump version (package.json only, no git tag yet) ---

  run(`npm version ${version} --no-git-tag-version`);

  // --- Build once, pack twice (npm + GPR), publish both as tarballs ---

  run('yarn build');

  // Pack @jackuait/blok tarball for npm
  const npmPackJson = runCapture('npm pack --ignore-scripts --pack-destination /tmp --json');

  run(gprPublishCommand({ packJson: npmPackJson, packDir: '/tmp', tag }));

  // --- Cleanup temporary .npmrc ---

  if (cleanupNpmrc) {
    unlinkSync('.npmrc');
  }

  // --- Publish to GitHub Packages as @dodopizza/blok ---

  const pkgJson = JSON.parse(readFileSync('package.json', 'utf-8'));

  try {
    // Rewrite name so the tarball contains @dodopizza/blok
    pkgJson.name = '@dodopizza/blok';
    writeFileSync('package.json', JSON.stringify(pkgJson, null, 2) + '\n');

    // Pack a second tarball under the @dodopizza name
    const gprPackJson = runCapture('npm pack --ignore-scripts --pack-destination /tmp --json');

    const gprToken = process.env.BLOK_GITHUB_TOKEN;

    if (gprToken) {
      writeFileSync('.npmrc', [
        '@dodopizza:registry=https://npm.pkg.github.com',
        `//npm.pkg.github.com/:_authToken=${gprToken}`,
        '',
      ].join('\n'));
    }

    run(gprPublishCommand({ packJson: gprPackJson, packDir: '/tmp', tag }));
    console.log('\nPublished @dodopizza/blok to GitHub Packages');
  } catch (err) {
    console.error('\nFailed to publish @dodopizza/blok to GitHub Packages:');
    console.error(err.message || err);
    process.exitCode = 1;
  } finally {
    pkgJson.name = '@jackuait/blok';
    writeFileSync('package.json', JSON.stringify(pkgJson, null, 2) + '\n');

    if (existsSync('.npmrc')) {
      unlinkSync('.npmrc');
    }
  }

  // --- Git: commit, tag, push ---

  run('git add package.json');
  run(`git commit -m "chore(release): ${version}"`);
  run(`git tag ${gitTag}`);
  run('git push');
  run(`git push origin ${gitTag}`);

  // --- GitHub release ---

  const prereleaseFlag = isBeta ? ' --prerelease' : '';

  run(`gh release create ${gitTag}${prereleaseFlag}`);

  console.log(`\nReleased ${version} successfully.`);
}
