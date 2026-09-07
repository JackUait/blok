// docs/src/components/api/api-data.ru-coverage.test.ts
import { describe, expect, it } from 'vitest';
import { translations } from '../../i18n';
import { API_SECTIONS } from './api-data';
import { SECTION_TRANSLATION_KEYS, getMethodKey } from '../../hooks/useApiTranslations';

/**
 * The API reference is the one data module the house coverage pattern was never
 * applied to — see `server-data.test.ts`, `useToolsTranslations.test.tsx` and
 * `migration-data.test.ts` for the same shape. It cost 311 untranslated keys
 * rendering English prose on 32 `/ru/docs/**` pages, invisible to every guard:
 * `safeTranslate` falls back to the `api-data.ts` literal, and en/ru key parity
 * only ever compared two overlays (`en.json` carries 296 of the 761 keys the
 * hook asks for), so a key in neither bundle was unmeasurable.
 */

/**
 * Walks a dot path in one bundle. NOT `getTranslation`: that falls back to
 * English on a Russian miss, so it answers a string for a key ru.json lacks.
 * @param locale - the bundle to look in
 * @param key - the dot-notation key
 */
const holdsKey = (locale: 'en' | 'ru', key: string): boolean => {
  const found = key.split('.').reduce<unknown>(
    (node, part) => (
      node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[part]
        : undefined
    ),
    translations[locale],
  );

  return typeof found === 'string';
};

const valueIn = (locale: 'en' | 'ru', key: string): string | undefined => {
  const found = key.split('.').reduce<unknown>(
    (node, part) => (
      node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[part]
        : undefined
    ),
    translations[locale],
  );

  return typeof found === 'string' ? found : undefined;
};

interface AskedKey {
  key: string;
  /** Where the reader's English comes from when the key is missing. */
  english: string | undefined;
  /** Titles and badges are module names; prose carries the Cyrillic rule. */
  prose: boolean;
  /** For the failure message: which field in api-data.ts produced this. */
  origin: string;
}

/**
 * Every key `useApiTranslations` asks for. The field walk is mirrored rather
 * than imported, so a field the hook stops overlaying shows up here as a change
 * — but `SECTION_TRANSLATION_KEYS` and `getMethodKey` ARE imported, because a
 * second copy of the `/\(.*\)$/` regex is a second place for `save()` -> `save`
 * to diverge in silence.
 */
const askedKeys = (): AskedKey[] => API_SECTIONS.flatMap((section) => {
  const base = SECTION_TRANSLATION_KEYS[section.id];

  if (base === undefined) {
    return [];
  }

  const at = (key: string, english: string | undefined, prose: boolean, origin: string): AskedKey =>
    ({ key, english, prose, origin: `${section.id} › ${origin}` });

  return [
    at(`${base}.title`, section.title, false, 'title'),
    ...(section.badge === undefined ? [] : [at(`${base}.badge`, section.badge, false, 'badge')]),
    ...(section.description === undefined
      ? []
      : [at(`${base}.description`, section.description, true, 'description')]),
    ...(section.methods ?? []).flatMap((method) => {
      const key = `${base}.methods.${getMethodKey(method.name)}`;

      return [
        at(`${key}.description`, method.description, true, `methods["${method.name}"].description`),
        // `note` has no api-data.ts literal for most methods: the hook asks for
        // it unconditionally, and a method with no note authored in ANY language
        // simply renders none. So the English side of the bundle is what makes a
        // note owed — not the hook asking.
        at(`${key}.note`, method.note ?? valueIn('en', `${key}.note`), true, `methods["${method.name}"].note`),
        ...(method.params ?? []).map((param) => at(
          `${key}.params.${param.name}.description`,
          param.description,
          true,
          `methods["${method.name}"].params.${param.name}.description`,
        )),
        ...(method.errors ?? []).flatMap((error, index) => [
          at(`${key}.errors.${index}.condition`, error.condition, true, `methods["${method.name}"].errors.${index}.condition`),
          at(`${key}.errors.${index}.resolution`, error.resolution, true, `methods["${method.name}"].errors.${index}.resolution`),
        ]),
      ];
    }),
    ...(section.properties ?? []).map((property) => at(
      `${base}.properties.${property.name}.description`,
      property.description,
      true,
      `properties.${property.name}.description`,
    )),
    ...(section.table ?? []).map((row) => at(
      `${base}.table.${row.option}.description`,
      row.description,
      true,
      `table.${row.option}.description`,
    )),
  ];
});

const CYRILLIC = /[Ѐ-ӿ]/;

describe('API reference Russian coverage', () => {
  // An unmapped id makes useApiTranslations return the WHOLE section untranslated
  // (`useApiTranslations.ts:116-119`) with no error — the failure mode that costs
  // the most and shows the least.
  it('maps every API section to a translation key', () => {
    const unmapped = API_SECTIONS
      .map((section) => section.id)
      .filter((id) => SECTION_TRANSLATION_KEYS[id] === undefined);

    expect(unmapped, `API_SECTIONS ids with no SECTION_TRANSLATION_KEYS entry:\n${unmapped.join('\n')}`).toEqual([]);
  });

  it('holds a ru.json value for every API string a reader sees', () => {
    const missing = askedKeys()
      .filter((asked) => asked.english !== undefined && !holdsKey('ru', asked.key))
      .map((asked) => `  api-data.ts › ${asked.origin}\n    → add to ru.json:  ${asked.key}\n    English: ${JSON.stringify(asked.english?.slice(0, 120))}`);

    expect(
      missing,
      `ru.json is missing ${missing.length} keys for API strings.\n`
      + 'A missing key silently renders the English literal from api-data.ts '
      + '(useApiTranslations.ts:182).\n\n'
      + missing.join('\n\n'),
    ).toEqual([]);
  });

  // Where a key exists in BOTH en.json and api-data.ts, the bundle wins on the
  // English page (`safeTranslate` resolves before the literal is used). So a
  // drift between them is not cosmetic: the reader sees the bundle's copy and
  // the literal becomes dead text that translators still work from. Four keys
  // had drifted when this was written, including `api.useBlocks.description`,
  // where en.json documented `useBlocks(editor)` and omitted the entire
  // `{ within: blockId }` scoping paragraph.
  it('keeps en.json and the api-data.ts literal identical where both exist', () => {
    const drifted = askedKeys()
      .filter((asked) => asked.english !== undefined)
      .map((asked) => ({ ...asked, bundle: valueIn('en', asked.key) }))
      .filter((asked) => asked.bundle !== undefined && asked.bundle !== asked.english)
      .map((asked) => `  ${asked.key}  (api-data.ts › ${asked.origin})\n`
        + `    en.json:     ${JSON.stringify(asked.bundle?.slice(0, 100))}\n`
        + `    api-data.ts: ${JSON.stringify(asked.english?.slice(0, 100))}`);

    expect(
      drifted,
      `${drifted.length} keys where en.json and api-data.ts disagree.\n`
      + 'en.json wins at the reader, so the api-data.ts literal is what goes stale.\n\n'
      + drifted.join('\n\n'),
    ).toEqual([]);
  });

  it('translates API prose rather than copying the English', () => {
    const untranslated = askedKeys()
      .filter((asked) => asked.prose)
      .map((asked) => ({ ...asked, value: valueIn('ru', asked.key) }))
      .filter((asked) => asked.value !== undefined && !CYRILLIC.test(asked.value))
      .map((asked) => `  ${asked.key}\n    ru.json: ${JSON.stringify(asked.value?.slice(0, 120))}`);

    expect(
      untranslated,
      `ru.json holds ${untranslated.length} API prose values with no Cyrillic:\n\n${untranslated.join('\n\n')}`,
    ).toEqual([]);
  });
});
