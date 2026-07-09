/**
 * Generates `types/icons.d.ts` — the self-contained public declaration for the
 * `@dodopizza/blok/icons` subpath — from `src/components/icons/index.ts`.
 *
 * WHY THIS EXISTS: `types/*.d.ts` is the package's published type surface and
 * MUST NOT re-export from raw `../src/...` (doing so drags implementation `.ts`
 * into every consumer's `tsc` program; see
 * `test/unit/architecture/published-types-no-src-refs.test.ts`). Icons are 130+
 * `export const` values, so hand-maintaining their declaration would drift.
 * This script emits an accurate, self-contained declaration instead.
 *
 * Run it whenever you add/rename/remove an icon:
 *   node scripts/generate-icons-dts.mjs
 *
 * The architecture test fails until `types/icons.d.ts` matches the source, so
 * drift cannot ship silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO_ROOT, 'src', 'components', 'icons', 'index.ts');
const TARGET = join(REPO_ROOT, 'types', 'icons.d.ts');

const HEADER = `/**
 * Public SVG-string icon constants for the \`@dodopizza/blok/icons\` subpath.
 *
 * AUTO-GENERATED from \`src/components/icons/index.ts\` by
 * \`scripts/generate-icons-dts.mjs\`. Do NOT edit by hand — re-run the script.
 *
 * Kept self-contained (no \`../src\` re-export) so consumers' \`tsc\` never pulls
 * raw implementation source into their program. Enforced by
 * \`test/unit/architecture/published-types-no-src-refs.test.ts\`.
 */
`;

/**
 * Derive the declared TypeScript type for one `export const NAME = <rhs>`.
 * Everything in the icons module is either an SVG string or a small builder
 * function; anything else is an unexpected shape and hard-fails so the
 * declaration can never silently misrepresent the runtime value.
 */
function declaredTypeFor(name, rhs) {
  const trimmed = rhs.trimStart();

  // Arrow function with an explicit inline return type, e.g.
  // `(count: number): string => {`
  const arrow = trimmed.match(/^(\([^)]*\))\s*:\s*([^=]+?)\s*=>/);

  if (arrow) {
    return `${arrow[1]} => ${arrow[2].trim()}`;
  }

  // String constants: template literal, quoted literal, or a wrap* helper call
  // that returns a string.
  if (/^(`|'|")/.test(trimmed) || /^wrap[A-Za-z]*Svg\s*\(/.test(trimmed)) {
    return 'string';
  }

  throw new Error(
    `generate-icons-dts: cannot infer a type for exported const "${name}". ` +
      `RHS starts with: ${trimmed.slice(0, 40)}…\n` +
      'Extend declaredTypeFor() to handle this shape explicitly.',
  );
}

const source = readFileSync(SOURCE, 'utf-8');
const exportRe = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)$/gm;

const lines = [];
let match;

while ((match = exportRe.exec(source)) !== null) {
  const [, name, rhs] = match;

  lines.push(`export declare const ${name}: ${declaredTypeFor(name, rhs)};`);
}

if (lines.length === 0) {
  throw new Error('generate-icons-dts: found no exported icon constants — refusing to write an empty declaration.');
}

writeFileSync(TARGET, `${HEADER}\n${lines.join('\n')}\n`, 'utf-8');

console.log(`Wrote ${lines.length} icon declarations to types/icons.d.ts`);
