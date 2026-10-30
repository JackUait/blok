/**
 * How the build splits English. Database keys leave the core chunk; the
 * Database tools declare them under `blok.toolMessages` instead. The keys
 * below stay in core because code outside the database tool reads them:
 * the assistant, CSV paste and the shared filter and formula code.
 * test/unit/architecture/core-english-keys-law.test.ts rebuilds this list
 * from the core import graph and fails when it drifts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATABASE_PREFIX = 'tools.database.';

export const CORE_DATABASE_KEYS = [
  'tools.database.buttonActionCallback',
  'tools.database.buttonActionSendNotification',
  'tools.database.buttonConfirmContinue',
  'tools.database.buttonConfirmDefault',
  'tools.database.csvPasteConvert',
  'tools.database.csvPasteOffer',
  'tools.database.csvUntitledColumn',
  'tools.database.dateRelative.lastFriday',
  'tools.database.dateRelative.lastMonday',
  'tools.database.dateRelative.lastSaturday',
  'tools.database.dateRelative.lastSunday',
  'tools.database.dateRelative.lastThursday',
  'tools.database.dateRelative.lastTuesday',
  'tools.database.dateRelative.lastWednesday',
  'tools.database.dateRelative.nextFriday',
  'tools.database.dateRelative.nextMonday',
  'tools.database.dateRelative.nextSaturday',
  'tools.database.dateRelative.nextSunday',
  'tools.database.dateRelative.nextThursday',
  'tools.database.dateRelative.nextTuesday',
  'tools.database.dateRelative.nextWednesday',
  'tools.database.formAccessComment',
  'tools.database.formAccessEdit',
  'tools.database.formAccessFull',
  'tools.database.formAccessNone',
  'tools.database.formAccessView',
  'tools.database.formAnonymous',
  'tools.database.formSubmissionAccess',
  'tools.database.formWhoCanFill',
  'tools.database.formWhoNone',
  'tools.database.formWhoPublic',
  'tools.database.formWhoWorkspaceGeneric',
  'tools.database.optionDeleteCancel',
  'tools.database.settingsOff',
  'tools.database.settingsOn',
  'tools.database.viewTypeTable',
];

/** Core builds these keys from a prefix, so every key under them stays. */
export const CORE_DATABASE_PREFIXES = [
  'tools.database.filterOperator.',
  'tools.database.formula.error.',
];

/**
 * Database keys v1.16.1 shipped in core's English. `i18n.t`, `has` and
 * `getEnglishTranslation` answered them without the Database tool, so they stay.
 */
export const RELEASED_DATABASE_KEYS = [
  'tools.database.addColumn',
  'tools.database.renameColumn',
  'tools.database.deleteColumn',
  'tools.database.addCard',
  'tools.database.newPage',
  'tools.database.deleteCard',
  'tools.database.editCardTitle',
  'tools.database.cardMenuLabel',
  'tools.database.cardTitlePlaceholder',
  'tools.database.columnTitlePlaceholder',
  'tools.database.emptyColumn',
  'tools.database.rowTitlePlaceholder',
  'tools.database.addRow',
  'tools.database.newRow',
  'tools.database.openRow',
  'tools.database.deleteRow',
  'tools.database.titlePlaceholder',
  'tools.database.renameView',
  'tools.database.duplicateView',
  'tools.database.deleteView',
  'tools.database.addView',
  'tools.database.viewTypeBoard',
  'tools.database.viewTypeList',
  'tools.database.viewTypeBoardDescription',
  'tools.database.viewTypeListDescription',
  'tools.database.propertyTypeHeading',
  'tools.database.propertyTypeText',
  'tools.database.propertyTypeNumber',
  'tools.database.propertyTypeSelect',
  'tools.database.propertyTypeMultiSelect',
  'tools.database.propertyTypeDate',
  'tools.database.propertyTypeCheckbox',
  'tools.database.propertyTypeUrl',
  'tools.database.listView',
  'tools.database.kanbanBoard',
  'tools.database.cardDetails',
  'tools.database.cardTitle',
  'tools.database.close',
  'tools.database.defaultTitleProperty',
  'tools.database.defaultStatusProperty',
  'tools.database.defaultStatusNotStarted',
  'tools.database.defaultStatusInProgress',
  'tools.database.defaultStatusDone',
  'tools.database.defaultViewBoard',
  'tools.database.checkboxChecked',
  'tools.database.checkboxUnchecked',
  'tools.database.moreViews',
];

/** True for a database key that core itself never reads. */
export const isDatabaseOnlyKey = (key) =>
  key.startsWith(DATABASE_PREFIX) &&
  !CORE_DATABASE_KEYS.includes(key) &&
  !RELEASED_DATABASE_KEYS.includes(key) &&
  !CORE_DATABASE_PREFIXES.some((prefix) => key.startsWith(prefix));

/**
 * Put the full English back together in en.json's key order. `runs` lists
 * pairs: core keys to copy, then database keys to copy. The plugin emits
 * this function's source, and the build checks the result with it.
 * @param {Record<string, string>} core
 * @param {Record<string, string>} database
 * @param {number[]} runs
 * @returns {Record<string, string>}
 */
export const mergeEnglish = (core, database, runs) => {
  const coreKeys = Object.keys(core);
  const databaseKeys = Object.keys(database);
  const merged = {};
  let c = 0;
  let d = 0;

  for (let r = 0; r < runs.length; r += 2) {
    for (const end = c + runs[r]; c < end; c++) {
      merged[coreKeys[c]] = core[coreKeys[c]];
    }
    for (const end = d + runs[r + 1]; d < end; d++) {
      merged[databaseKeys[d]] = database[databaseKeys[d]];
    }
  }

  return merged;
};

/**
 * Split en.json into the core part and the database part, keeping en.json
 * order in each. Throws if the parts would not merge back byte for byte.
 * @param {Record<string, string>} english
 * @returns {{ core: Record<string, string>, database: Record<string, string>, runs: number[] }}
 */
export const splitEnglish = (english) => {
  const core = {};
  const database = {};
  const runs = [0, 0];

  for (const [key, value] of Object.entries(english)) {
    if (key === '__proto__') {
      throw new Error('blok:english: cannot split key "__proto__"');
    }

    if (isDatabaseOnlyKey(key)) {
      database[key] = value;
      runs[runs.length - 1]++;
    } else {
      if (runs[runs.length - 1] > 0) {
        runs.push(0, 0);
      }
      core[key] = value;
      runs[runs.length - 2]++;
    }
  }

  if (JSON.stringify(mergeEnglish(core, database, runs)) !== JSON.stringify(english)) {
    throw new Error('blok:english: the split English does not merge back to en.json');
  }

  return { core, database, runs };
};

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/i18n/locales');

/** The source modules the build swaps, by file. */
export const ENGLISH_MODULES = {
  core: path.join(LOCALES_DIR, 'english-core.ts'),
  database: path.join(LOCALES_DIR, 'english-database.ts'),
  full: path.join(LOCALES_DIR, 'english-full.ts'),
};

/**
 * The code the build uses for one of ENGLISH_MODULES, or null for any other id.
 * @param {string} id
 * @returns {string | null}
 */
export const englishModuleCode = (id) => {
  const part = Object.keys(ENGLISH_MODULES).find((name) => ENGLISH_MODULES[name] === path.resolve(id));

  if (part === undefined) {
    return null;
  }

  const { core, database, runs } = splitEnglish(JSON.parse(readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8')));
  const data = (value) => `/* @__PURE__ */ JSON.parse(${JSON.stringify(JSON.stringify(value))})`;

  if (part === 'full') {
    return [
      "import core from './english-core.ts';",
      "import database from './english-database.ts';",
      `const mergeEnglish = ${mergeEnglish.toString()};`,
      `export default /* @__PURE__ */ mergeEnglish(core, database, ${data(runs)});`,
    ].join('\n');
  }

  return `export default ${data(part === 'core' ? core : database)};`;
};
