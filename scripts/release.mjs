import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';

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

// --- Publish to npm (triggers prepublishOnly → yarn build) ---

run(`npm publish --tag ${tag}`);

// --- Cleanup temporary .npmrc ---

if (cleanupNpmrc) {
  unlinkSync('.npmrc');
}

// --- Git: commit, tag, push ---

run('git add package.json');
run(`git commit -m "chore(release): ${version}"`);
run(`git tag ${gitTag}`);
run('git push');
run(`git push origin ${gitTag}`);

// --- GitHub release ---

const prereleaseFlag = isBeta ? ' --prerelease' : '';

run(`gh release create ${gitTag} --draft${prereleaseFlag}`);

console.log(`\nReleased ${version} successfully.`);
