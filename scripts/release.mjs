import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { readdirSync } from 'fs';

import { FAMILY, prepareManifestForGpr, rewriteSpecifiersForGpr } from './release-manifest.mjs';

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

/**
 * Extract the changelog section for `version` from a markdown changelog string.
 * Returns the body text (everything between the version heading and the next
 * same-level heading), or an empty string if the version is not found.
 *
 * @param {string} version - e.g. "1.2.0" or "1.0.0-beta.1"
 * @param {string} changelog - full CHANGELOG.md content
 * @returns {string}
 */
function extractChangelogSection(version, changelog) {
  // Match the heading line for this exact version (escaped for regex special chars)
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^## \\[${escapedVersion}\\]`, 'm');
  const start = changelog.search(headingPattern);

  if (start === -1) {
    return '';
  }

  // Find the next `## ` heading after the matched one
  const afterStart = changelog.indexOf('\n', start) + 1;
  const nextHeading = changelog.indexOf('\n## ', afterStart);
  const section = nextHeading === -1
    ? changelog.slice(afterStart)
    : changelog.slice(afterStart, nextHeading);

  return section.trim();
}

/**
 * Build the GitHub release notes body combining the main package and blok-cli
 * changelog sections for the given version.
 *
 * @param {string} version        - e.g. "1.2.0"
 * @param {string} mainChangelog  - root CHANGELOG.md content
 * @param {string} cliChangelog   - packages/cli/CHANGELOG.md content
 * @returns {string} Markdown release notes body
 */
/**
 * Publish a package to both npm and GitHub Packages, always restoring the
 * original package name even if either publish step throws.
 *
 * Errors are re-thrown so the caller can abort the release — nothing is
 * silently swallowed.
 *
 * @param {object} opts
 * @param {() => void} opts.publishToNpm - Callback that runs the npm publish
 * @param {() => void} opts.publishToGpr - Callback that runs the GPR publish
 * @param {() => void} opts.restoreName  - Callback that restores package.json name
 * @returns {Promise<void>}
 */
export async function publishPackagePair({ publishToNpm, publishToGpr, restoreName }) {
  try {
    publishToNpm();
    publishToGpr();
  } finally {
    restoreName();
  }
}

export function buildReleaseNotes(version, mainChangelog, cliChangelog) {
  const mainSection = extractChangelogSection(version, mainChangelog);
  const cliSection = extractChangelogSection(version, cliChangelog);

  const parts = [];

  if (mainSection) {
    parts.push(mainSection);
  }

  if (cliSection) {
    parts.push(`## blok-cli\n\n${cliSection}`);
  }

  return parts.join('\n\n');
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

  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const skipPreflight = args.includes('--skip-preflight');
  const version = args.find((a) => !a.startsWith('--'));

  if (!version) {
    console.error('Usage: yarn release <version> [--dry-run] [--skip-preflight]');
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

  function runCapture(cmd, opts = {}) {
    return execSync(cmd, { encoding: 'utf-8', ...opts }).trim();
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

  console.log(`\nReleasing ${version} (tag: ${tag})${isDryRun ? ' [DRY RUN]' : ''}\n`);

  if (!skipPreflight) {
    run('yarn release:preflight');
  }

  // --- Bump versions: root via npm, workspaces by manifest edit (lockstep) ---

  run(`npm version ${version} --no-git-tag-version`);

  const WORKSPACE_MANIFESTS = [
    'packages/react/package.json',
    'packages/vue/package.json',
    'packages/angular/package.json',
    'packages/cli/package.json',
  ];

  for (const manifestPath of WORKSPACE_MANIFESTS) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    manifest.version = version;

    // Adapters peer on the core at the released version (lockstep family).
    if (manifest.peerDependencies && '@bloklabs/core' in manifest.peerDependencies
      && manifest.peerDependencies['@bloklabs/core'] !== '*') {
      manifest.peerDependencies['@bloklabs/core'] = `^${version}`;
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // --- Build once (root build chains every workspace), then the CLI ---

  run('yarn build');
  run('node scripts/build-cli.mjs');

  // --- Publish the whole family: npmjs @bloklabs/* + GHP @dodopizza/* mirrors ---

  const publishSuffix = isDryRun ? ' --dry-run' : '';

  const writeNpmrc = () => {
    if (npmToken) {
      writeFileSync('.npmrc', `//registry.npmjs.org/:_authToken=${npmToken}\n`);
    }
  };

  const writeGprNpmrc = () => {
    const gprToken = process.env.BLOK_GITHUB_TOKEN;

    if (gprToken) {
      writeFileSync('.npmrc', [
        '@dodopizza:registry=https://npm.pkg.github.com',
        `//npm.pkg.github.com/:_authToken=${gprToken}`,
        '',
      ].join('\n'));
    }
  };

  /** Collect the rewritable bundle files for a family entry's GPR tarball. */
  const distFilesForRewrite = (entry) => {
    const files = [];

    for (const dir of entry.distRewriteDirs ?? []) {
      const abs = join(entry.packDir, dir);

      if (!existsSync(abs)) continue;

      for (const name of readdirSync(abs)) {
        if (/\.(mjs|cjs|js|d\.ts)$/.test(name)) {
          files.push(join(abs, name));
        }
      }
    }

    return files;
  };

  for (const entry of FAMILY) {
    const originalManifest = readFileSync(entry.manifestPath, 'utf-8');
    const originalDistFiles = new Map(
      distFilesForRewrite(entry).map((file) => [file, readFileSync(file, 'utf-8')]),
    );

    await publishPackagePair({
      publishToNpm: () => {
        writeNpmrc();

        const packJson = runCapture(
          'npm pack --ignore-scripts --pack-destination /tmp --json',
          { cwd: entry.packDir },
        );

        run(gprPublishCommand({ packJson, packDir: '/tmp', tag }) + publishSuffix);
        console.log(`\nPublished ${entry.npmName} to npm`);
      },
      publishToGpr: () => {
        const gprManifest = prepareManifestForGpr(JSON.parse(originalManifest), entry);

        writeFileSync(entry.manifestPath, JSON.stringify(gprManifest, null, 2) + '\n');

        // Adapter bundles import the core by npm name; the mirror tarball must
        // import the mirror's core name (see release-manifest.mjs).
        for (const [file, source] of originalDistFiles) {
          writeFileSync(file, rewriteSpecifiersForGpr(source));
        }

        writeGprNpmrc();

        const packJson = runCapture(
          'npm pack --ignore-scripts --pack-destination /tmp --json',
          { cwd: entry.packDir },
        );

        run(gprPublishCommand({ packJson, packDir: '/tmp', tag }) + publishSuffix);
        console.log(`\nPublished ${entry.gprName} to GitHub Packages`);
      },
      restoreName: () => {
        writeFileSync(entry.manifestPath, originalManifest);

        for (const [file, source] of originalDistFiles) {
          writeFileSync(file, source);
        }

        if (existsSync('.npmrc')) {
          unlinkSync('.npmrc');
        }
      },
    });
  }

  cleanupNpmrc = false; // the family loop always removes .npmrc in restoreName

  // --- Git: commit, tag, push ---

  if (isDryRun) {
    run('git checkout -- package.json ' + WORKSPACE_MANIFESTS.join(' '));
    console.log(`\nDry run complete for ${version} — nothing was published.`);
    process.exit(0);
  }

  run(`git add package.json ${WORKSPACE_MANIFESTS.join(' ')}`);
  run(`git commit -m "chore(release): ${version}"`);
  run(`git tag ${gitTag}`);
  run('git push');
  run(`git push origin ${gitTag}`);

  // --- GitHub release ---

  const prereleaseFlag = isBeta ? ' --prerelease' : '';

  const mainChangelog = existsSync('CHANGELOG.md')
    ? readFileSync('CHANGELOG.md', 'utf-8')
    : '';
  const cliChangelogPath = join(fileURLToPath(new URL('.', import.meta.url)), '../packages/cli/CHANGELOG.md');
  const cliChangelog = existsSync(cliChangelogPath)
    ? readFileSync(cliChangelogPath, 'utf-8')
    : '';

  const releaseNotes = buildReleaseNotes(version, mainChangelog, cliChangelog);
  let notesFlag = '';

  if (releaseNotes) {
    const notesFile = `/tmp/blok-release-notes-${version}.md`;

    writeFileSync(notesFile, releaseNotes);
    notesFlag = ` --notes-file ${notesFile}`;
  }

  run(`gh release create ${gitTag}${prereleaseFlag}${notesFlag}`);

  console.log(`\nReleased ${version} successfully.`);
}
