// Grafts the version picker onto a checkout of an old release tag, so its docs
// can be built as an archived snapshot.
// Usage: node apply-versioning-overlay.mjs --tag-docs <dir> --source-docs <dir>
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Must stay in step with the same lines in the current docs (overlay.test.ts checks).
const PATCHES = [
  {
    file: 'react-router.config.ts',
    anchor: '  ssr: false,',
    after: [
      '  // `/v/1.14/` for an archived minor, `/next/` for main. Assets and links follow it.',
      "  basename: process.env.DOCS_BASE || '/',",
    ],
  },
  {
    file: 'vite.config.ts',
    anchor: 'export default defineConfig({',
    after: [
      '  // Must match react-router.config.ts `basename`, or assets 404 under a subpath.',
      "  base: process.env.DOCS_BASE || '/',",
    ],
  },
  {
    file: 'src/components/layout/Nav.tsx',
    anchor: 'import { LanguageSelector } from "../common/LanguageSelector";',
    after: [
      'import { VersionPicker } from "../../versioning/VersionPicker";',
      'import { VersionBanner } from "../../versioning/VersionBanner";',
    ],
  },
  {
    file: 'src/components/layout/Nav.tsx',
    anchor: '        data-blok-testid="nav"\n      >',
    after: ['        <VersionBanner />'],
  },
  {
    file: 'src/components/layout/Nav.tsx',
    anchor: '            <LanguageSelector />',
    before: ['            <VersionPicker />'],
  },
  {
    file: 'src/vite-env.d.ts',
    anchor: '  readonly VITE_APP_TITLE: string;',
    after: ['  readonly VITE_DOCS_VERSION?: string;'],
  },
];

const SCRIPTS = ['docs-versions.mjs', 'build-snapshot.mjs'];

const applyPatch = (tagDocsDir, { file, anchor, before = [], after = [] }) => {
  const path = join(tagDocsDir, file);
  const text = readFileSync(path, 'utf8');
  const patched = [...before, anchor, ...after].join('\n');
  // Already grafted: a second run must be a no-op.
  if (text.split(patched).length === 2) {
    return;
  }
  if (text.split(anchor).length !== 2) {
    throw new Error(`Overlay anchor not found in ${path}: ${anchor}`);
  }
  writeFileSync(path, text.replace(anchor, () => patched));
};

export const applyOverlay = ({ tagDocsDir, sourceDocsDir }) => {
  cpSync(join(sourceDocsDir, 'src', 'versioning'), join(tagDocsDir, 'src', 'versioning'), {
    recursive: true,
    filter: (source) => !/\.test\.[^/]+$/.test(source),
  });
  mkdirSync(join(tagDocsDir, 'scripts'), { recursive: true });
  for (const script of SCRIPTS) {
    cpSync(join(sourceDocsDir, 'scripts', script), join(tagDocsDir, 'scripts', script));
  }
  for (const patch of PATCHES) {
    applyPatch(tagDocsDir, patch);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'tag-docs': { type: 'string' },
      'source-docs': { type: 'string' },
    },
  });
  if (!values['tag-docs'] || !values['source-docs']) {
    console.error('Usage: apply-versioning-overlay.mjs --tag-docs <dir> --source-docs <dir>');
    process.exit(1);
  }
  applyOverlay({ tagDocsDir: resolve(values['tag-docs']), sourceDocsDir: resolve(values['source-docs']) });
  console.log(`versioning overlay applied to ${resolve(values['tag-docs'])}`);
}
