/**
 * Generates `types/message-keys.d.ts` — the self-contained public declaration
 * of every built-in translation key — from `src/components/i18n/locales/en.json`.
 *
 * WHY THIS EXISTS: `config.i18n.messages` (and `i18n.update({ messages })`) let
 * a host override built-in strings by key. Those keys were a loose
 * `Record<string, string>`, so when a built-in key was renamed the host's
 * override silently stopped matching — no compile error, the translation just
 * reverted to the default. Consumers hit exactly this on a table-key rename.
 *
 * The generated `BlokMessageKey` union is the stability-guaranteed contract: a
 * host that types its overrides as `BlokMessages` (`Partial<Record<
 * BlokMessageKey, string>>`) gets a compile error the moment a key it overrides
 * is renamed or removed, instead of a silent revert.
 *
 * en.json is the single source of truth (every other locale is validated
 * against it). Run this whenever built-in keys change:
 *   node scripts/generate-message-keys-dts.mjs
 *
 * `test/unit/architecture/published-types-no-src-refs.test.ts` fails until the
 * declaration matches en.json, so drift cannot ship silently.
 *
 * The declaration is intentionally self-contained (no `../src` re-export); see
 * the Published-types law in CLAUDE.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO_ROOT, 'src', 'components', 'i18n', 'locales', 'en.json');
const TARGET = join(REPO_ROOT, 'types', 'message-keys.d.ts');

const HEADER = `/**
 * Public union of every built-in Blok translation key.
 *
 * AUTO-GENERATED from \`src/components/i18n/locales/en.json\` by
 * \`scripts/generate-message-keys-dts.mjs\`. Do NOT edit by hand — re-run the
 * script whenever built-in keys change.
 *
 * Self-contained (no \`../src\` re-export) so consumers' \`tsc\` never pulls raw
 * implementation source into their program. Kept in sync with en.json by
 * \`test/unit/architecture/published-types-no-src-refs.test.ts\`.
 */

/**
 * A translation key targeting a tool's toolbox label. The \`toolNames.\` prefix
 * is the documented namespace contract for tool display names; \`<name>\` is the
 * tool's registration name (\`toolNames.paragraph\`, \`toolNames.header\`). Custom
 * tools use the same convention, which is why it is an open template type.
 */
export type ToolNameMessageKey = \`toolNames.\${string}\`;
`;

const raw = JSON.parse(readFileSync(SOURCE, 'utf-8'));
const keys = Object.keys(raw).sort();

if (keys.length === 0) {
  throw new Error('generate-message-keys-dts: en.json has no keys — refusing to write an empty declaration.');
}

for (const key of keys) {
  if (typeof raw[key] !== 'string') {
    throw new Error(
      `generate-message-keys-dts: en.json value for "${key}" is not a string. ` +
        'The dictionary must stay a flat key→string map.',
    );
  }

  if (key.includes("'")) {
    throw new Error(`generate-message-keys-dts: key "${key}" contains a single quote and cannot be emitted safely.`);
  }
}

const union = keys.map((key) => `  | '${key}'`).join('\n');

const body = `/**
 * Every built-in translation key shipped in en.json. A stable, typed contract:
 * a renamed or removed key surfaces as a compile error at every override site
 * typed against it, instead of a silent fallback to the default string.
 */
export type BlokMessageKey =
${union};

/**
 * Host message overrides typed against the built-in key contract.
 *
 * Use it with \`satisfies\` to opt into rename-safety for the built-in strings
 * you override, while still spreading in any custom-tool keys separately:
 *
 * \`\`\`ts
 * const overrides = {
 *   'toolNames.text': 'Текст',
 *   'tools.link.addLink': 'Добавить ссылку',
 * } satisfies BlokMessages;
 * \`\`\`
 */
export type BlokMessages = Partial<Record<BlokMessageKey, string>>;
`;

writeFileSync(TARGET, `${HEADER}\n${body}`, 'utf-8');

console.log(`Wrote ${keys.length} message-key declarations to types/message-keys.d.ts`);
