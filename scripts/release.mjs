import { execSync } from 'child_process';

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

try {
  runCapture('npm whoami');
} catch {
  console.error('Not logged in to npm. Run `npm login` first.');
  process.exit(1);
}

// --- Preflight ---

console.log(`\nReleasing ${version} (tag: ${tag})\n`);

run('yarn release:preflight');

// --- Bump version (package.json only, no git tag yet) ---

run(`npm version ${version} --no-git-tag-version`);

// --- Publish to npm (triggers prepublishOnly → yarn build) ---

run(`npm publish --tag ${tag}`);

// --- Git: commit, tag, push ---

run('git add package.json');
run(`git commit -m "chore(release): ${version}"`);
run(`git tag ${gitTag}`);
run('git push');
run(`git push origin ${gitTag}`);

// --- GitHub release ---

const prereleaseFlag = isBeta ? ' --prerelease' : '';

run(`gh release create ${gitTag} --generate-notes${prereleaseFlag}`);

console.log(`\nReleased ${version} successfully.`);
