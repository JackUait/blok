import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { AGENT_SKILLS } from '../../../../src/shared/skills';

type LifecycleCategory =
  | 'executable-literal'
  | 'finite-dynamic'
  | 'registered-namespace-compatible'
  | 'catalog-only';

const SRC_DIR = resolve(__dirname, '../../../../src');
const ENGLISH_PATH = join(SRC_DIR, 'components/i18n/locales/en.json');
const CATALOG_ONLY_KEYS = new Set([
  // Retain this key for public BlokMessageKey compatibility.
  'blockSettings.blocksSelected',
  'blockSettings.convertWithChildrenWarning',
  'tools.columns.turnInto',
  // emoji.nothingFound moved executable-literal -> catalog-only: the inline
  // ":" trigger's empty state now renders through EmojiPicker's own
  // NO_EMOJIS_FOUND_KEY (tools.callout.noEmojisFound), the same message the
  // Callout picker already used, instead of a second string of its own. Kept
  // in the catalog rather than deleted from all locales — same rationale as
  // tools.bookmark.error above.
  'emoji.nothingFound',
]);

const sourceFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || entry.name.endsWith('.d.ts')) return [];

    return /\.(?:ts|tsx|js|mjs)$/u.test(entry.name) ? [path] : [];
  }).sort();
};

const unwrap = (node: ts.Expression | undefined): ts.Expression | undefined => {
  let current = node;

  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }

  return current;
};

const literalText = (node: ts.Node | undefined): string | undefined => {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
};

const named = (node: ts.PropertyName, expected: string): boolean => {
  return (ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === expected;
};

const parseSource = (path: string): ts.SourceFile => {
  const source = readFileSync(path, 'utf-8');
  let kind = ts.ScriptKind.TS;

  if (path.endsWith('.tsx')) {
    kind = ts.ScriptKind.TSX;
  } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
    kind = ts.ScriptKind.JS;
  }

  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
};

const deriveLifecycle = (): {
  lifecycle: Map<string, LifecycleCategory>;
  directLiteralCalls: Set<string>;
} => {
  const english = JSON.parse(readFileSync(ENGLISH_PATH, 'utf-8')) as Record<string, string>;
  const catalog = new Set(Object.keys(english));
  const literal = new Set<string>();
  const dynamic = new Set<string>();
  const directLiteralCalls = new Set<string>();
  const parsed = new Map<string, ts.SourceFile>();
  const files = sourceFiles(SRC_DIR);
  const addDynamic = (key: string): void => {
    if (catalog.has(key)) dynamic.add(key);
  };
  const addSearchTerms = (elements: ts.NodeArray<ts.Expression>): void => {
    for (const element of elements) {
      const suffix = literalText(element);

      if (suffix !== undefined) addDynamic(`searchTerms.${suffix}`);
    }
  };

  for (const path of files) {
    const sourceFile = parseSource(path);
    const relative = path.slice(SRC_DIR.length + 1).replaceAll('\\', '/');
    const toolHelperNames = new Set(
      sourceFile.statements.flatMap((statement) => {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.endsWith('/i18n') ||
          statement.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          return [];
        }

        return statement.importClause.namedBindings.elements.flatMap(specifier =>
          (specifier.propertyName ?? specifier.name).text === 'tr'
            ? [specifier.name.text]
            : []
        );
      })
    );

    parsed.set(relative, sourceFile);

    const visit = (node: ts.Node): void => {
      const value = literalText(node);

      if (value !== undefined && catalog.has(value)) literal.add(value);

      if (ts.isCallExpression(node)) {
        const isMethodCall =
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 't';
        const isToolHelperCall =
          ts.isIdentifier(node.expression) &&
          toolHelperNames.has(node.expression.text);
        let argument: ts.Expression | undefined;

        if (isMethodCall) {
          argument = node.arguments[0];
        } else if (isToolHelperCall) {
          argument = node.arguments[1];
        }
        const directKey = literalText(argument === undefined ? undefined : unwrap(argument));

        if (directKey !== undefined && catalog.has(directKey)) {
          directLiteralCalls.add(directKey);
        }
      }

      if (
        (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
        named(node.name, 'titleKey') &&
        node.initializer !== undefined
      ) {
        const titleKey = literalText(unwrap(node.initializer));

        if (titleKey !== undefined) {
          addDynamic(titleKey.includes('.') ? titleKey : `toolNames.${titleKey}`);
        }
      }

      if (
        ts.isPropertyAssignment(node) &&
        named(node.name, 'searchTermKeys') &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        addSearchTerms(node.initializer.elements);
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'i18nLabel'
      ) {
        const suffix = literalText(node.arguments[0]);

        if (suffix !== undefined && relative.startsWith('tools/audio/')) {
          addDynamic(`tools.audio.${suffix}`);
        }
        if (suffix !== undefined && relative.startsWith('tools/video/')) {
          addDynamic(`tools.video.${suffix}`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  for (const color of ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']) {
    addDynamic(`tools.colorPicker.color.${color}`);
  }
  for (const count of [2, 3, 4, 5]) addDynamic(`tools.columns.col${count}`);
  for (const level of [1, 2, 3, 4, 5, 6]) addDynamic(`tools.header.toggleHeading${level}`);
  for (const level of [1, 2, 3, 4, 5, 6]) addDynamic(`toolbox.preview.heading${level}`);
  // The Ask AI bar's thinking menu reads assistant.thinking.<level>.
  for (const level of ['off', 'low', 'medium', 'high', 'xhigh', 'max']) addDynamic(`assistant.thinking.${level}`);
  // Ask AI's action chips read assistant.action.<skill id> (actions.ts).
  for (const skill of AGENT_SKILLS) addDynamic(`assistant.action.${skill.id}`);
  addDynamic('tools.image.errorRetry');
  addDynamic('tools.image.errorReplace');
  // The tab block has no toolbox entry. Its name is read as toolNames.<block.name>
  // by translateToolName (blockSelection.ts, inline-tool-convert.ts).
  addDynamic('toolNames.tab');
  // The database block's toolbox entries no longer use it (research/28 renamed them), but
  // its name is still read as toolNames.database the same way.
  addDynamic('toolNames.database');

  for (const key of literal) dynamic.delete(key);

  const registeredNamespaces = new Set<string>();
  const registryFile = parsed.get('tools/index.ts');

  if (registryFile === undefined) throw new Error('missing default tool registry');

  const findRegistry = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'defaultBlockTools'
    ) {
      const registry = unwrap(node.initializer);

      if (registry === undefined || !ts.isObjectLiteralExpression(registry)) {
        throw new Error('defaultBlockTools must remain an object literal');
      }

      const namespaceNames = registry.properties.flatMap((property) => {
        if (!('name' in property) || property.name === undefined) return [];

        return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? [property.name.text]
          : [];
      });

      namespaceNames.forEach(name => registeredNamespaces.add(name));
    }

    ts.forEachChild(node, findRegistry);
  };

  findRegistry(registryFile);

  const result = new Map<string, LifecycleCategory>();

  for (const key of catalog) {
    if (literal.has(key)) {
      result.set(key, 'executable-literal');
    } else if (dynamic.has(key)) {
      result.set(key, 'finite-dynamic');
    } else if (CATALOG_ONLY_KEYS.has(key)) {
      result.set(key, 'catalog-only');
    } else if (key.startsWith('tools.') && registeredNamespaces.has(key.split('.')[1] ?? '')) {
      result.set(key, 'registered-namespace-compatible');
    } else {
      throw new Error(`unclassified English catalog key: ${key}`);
    }
  }

  return { lifecycle: result, directLiteralCalls };
};

let cachedLifecycle: ReturnType<typeof deriveLifecycle> | undefined;
const getLifecycle = (): ReturnType<typeof deriveLifecycle> => {
  cachedLifecycle ??= deriveLifecycle();

  return cachedLifecycle;
};

describe('current English catalog lifecycle coverage', () => {
  it('rebuilds a disjoint 1901 + 136 + 520 + 4 closure for all 2561 keys', () => {
    const { lifecycle } = getLifecycle();
    const counts = Object.fromEntries(
      ([
        'executable-literal',
        'finite-dynamic',
        'registered-namespace-compatible',
        'catalog-only',
      ] as const).map(category => [
        category,
        [...lifecycle.values()].filter(value => value === category).length,
      ])
    );

    expect(lifecycle.size).toBe(2561);
    expect(counts).toEqual({
      // tools.callout.editIcon moved finite-dynamic -> executable-literal when
      // the callout emoji button stopped being named by the emoji glyph and
      // started composing its label from that key at a literal call site.
      // tools.bookmark.error moved executable-literal -> registered-namespace-
      // compatible when a failed preview stopped rendering an error state. The
      // key still ships to every locale: dropping it would rewrite all 69
      // dictionaries and invalidate each sha256 digest recorded in the
      // translation audit ledger.
      // tools.header.toggleHeading moved registered-namespace-compatible ->
      // executable-literal when the convert menu started labelling its
      // toggle-heading group from that key at a literal call site.
      // emoji.search moved catalog-only -> executable-literal once the inline
      // emoji trigger composer called I18n.t('emoji.search') at a literal
      // call site (aria-label for the combobox host). emoji.nothingFound
      // made the same move and then moved BACK to catalog-only: the inline
      // trigger's menu is now the real EmojiPicker (Task 6b), whose own
      // empty state already renders through NO_EMOJIS_FOUND_KEY
      // (tools.callout.noEmojisFound) — see CATALOG_ONLY_KEYS above.
      // +7: the darkroom's local reset keys (tools.image.reset*) are called by literal.
      // +1: tools.code.filename. +1: tools.code.suggested.
      // +18: image markup keys called by literal. +7: the markup swatches name
      // their colours with tools.colorPicker.color.* at a literal call site.
      // +4: the page block calls tools.page.* and toolbox.preview.page by literal.
      // +1: tools.image.markupShapes names the shape picker by literal.
      // +1: tools.image.filterStrength names the strength slider by literal.
      // +8: the filter family tabs and their row name are listed by literal.
      // find.options labels the find bar's options button by literal.
      // +1: a11y.loadingContent names the loading skeleton's status by literal.
      // +12: the darkroom's keyboard shortcut sheet lists its rows by literal.
      // +9: that sheet also names markup tools by literal (see below).
      // +2: the table grips name their merge-lock tooltips by literal.
      // The video context menu calls ctxCopyUrlAtTime and ctxStats by literal.
      // -2: imageFailure.failedMany/restoredMany left the catalog.
      // +5: the page menu keys (blockSettings.copyPageLink/moveToTrash,
      // tools.page.editIcon/rename/openInSidePeek) are called by literal.
      // +3: the table-of-contents block calls its toolNames, tools and
      // toolbox.preview keys by literal.
      // +2: the find bar names why a replace button is disabled by literal.
      // +2: the page title header calls title.placeholder and title.ariaLabel by literal.
      // +2: the page icon calls title.addIcon and title.changeIcon by literal.
      // +21: the database cell editors (tools.database.cellEmpty, select*, option*, date*) call their keys by literal.
      // +1: the database names a new table view with tools.database.viewTypeTable.
      // +61: the database table view calls its tools.database.table*, calc* and viewTypeTableDescription keys by literal.
      // +47: the database property system (type names, person, files, property menu rows, status group names) calls its keys by literal.
      // +11: the database sort prompt (tools.database.removeSorting*) and group menu (group*, hiddenGroups) call their keys by literal.
      // +37: the database view settings call their filterOperator.isWithin/isRelativeToToday, filterDate*, sort*, group* and filterMe keys by literal.
      // +29: the gallery and calendar views call their tools.database.gallery*, calendar* and viewType* keys by literal.
      // +23: the timeline view calls its tools.database.timeline* and viewTypeTimeline* keys by literal.
      // +1: the calendar's "No date (N)" button calls tools.database.calendarNoDate by literal.
      // +21: relation, rollup and formula call their type names, relation*, rollup* and formula* keys by literal.
      // +14: the row page drawer calls its 13 new keys (peek*, icon, cover, properties, rowBodyEmpty) and
      // tools.database.settingsOpenPagesIn by literal.
      // +22: the chart, feed and CSV actions and the CSV paste offer call their tools.database.chart*, csv* and viewType* keys by literal.
      // +29 / +35: Phase 6 (buttons, templates, sub-items, dependencies, linked views) keys, by literal
      // or composed from a short name in a registered namespace.
      // +30: the row page layout builder calls its tools.database.layout* keys by literal.
      // +18: Tier 3 (D6) calls its place, verification, form, map, dashboard and comment keys by literal.
      // +14: the peek's hidden properties fold, "Default for", tab "Display as", 99+, the row menu
      // (Move to, search, last edited) and Edit property options call their keys by literal.
      // +4: the layout builder's Customize page layout, pin arrows and Property icons call their keys by literal.
      // +3: the agent turn summary (agent.changedOneBlock/changedBlocks) and the
      // agent presence label (presence.agentFor) are called by literal.
      // +2: the layout builder's discard question (layoutDiscardTitle, layoutDiscard) calls its keys by literal.
      // +1: the row menu footer calls tools.database.rowWordCount by literal.
      // +7: the form question menu calls its tools.database.formShowOptions* and formSelection* keys by literal.
      // +1 / -1: the full-window layout builder calls tools.database.layoutMoreSaveOptions by literal;
      // tools.database.layoutCustomizing lost its caller with the old builder bar (see below).
      // +7 / -1: the AI Autofill cell button, header ••• menu and Notion trigger choices call their
      // tools.database.aiAutofill* keys by literal; tools.database.aiAutofillTriggerOn lost its caller (see below).
      // +1: the comment badge calls tools.database.openComments by literal.
      // +4: the builder's Preview switch, its search and empty line, and the New page placeholder call their keys by literal.
      // +6: the builder's Page settings column calls its Structure, Options, Full width and Database templates keys and hints by literal.
      // +10 / -2: the builder's module cards and Heading menu call their keys by literal;
      // tools.database.layoutPin and layoutUnpin left with the per-property pin items.
      // +5 / -4 / -2: the Property group eye and "N more properties" toggles call their keys by literal;
      // hiddenProperties, hideHiddenProperties and layoutGroupIn* left with the old toggle and Page settings choice;
      // tools.database.searchLabel and searchPlaceholder moved to registered-namespace (see below).
      // +5: the builder's Add page module button, its add menu rows and the sidebar toggle call their keys by literal.
      // +3 / -1: the section menu's Rename, Done and delete hint call their keys by literal;
      // tools.database.layoutItemOptions left with the per-property ⋯ menu.
      // +3: the builder's Reset confirm calls its title, body and button keys by literal.
      // +15: the assistant bar calls its assistant.* keys by literal.
      // +3: the empty row page's template prompt calls rowBodyEmptyOr, rowBodyCreateTemplate and rowBodyPickTemplate by literal.
      // +2: its picker also calls tools.database.templateNew and templateUntitled by literal (see below).
      // +3: the details panel's Hide details, Close panel and Page info call their keys by literal.
      // +9: the Tabbed tab bar's Add tab, data source picker, view name and delete view keys are called by literal.
      // +1: tools.database.settingsTitle titles the tab menu by literal (see below).
      // +3: the AI Autofill page content switch, its value and the property-trigger heading call their keys by literal.
      // +10: the Tabbed layout's related tabs, View of / Add new relation form, Duplicate view and the "This page" filter value call their keys by literal.
      // +1: the row page view tab menu calls tools.database.layoutCopyLinkToView by literal.
      // +3: the view overflow list calls searchViews, newView and settingsDragToReorder by literal.
      // +1: the gallery card rename calls tools.database.cardNamePlaceholder by literal.
      // +2: the table's url, email and phone pill calls tools.database.cellCopy and cellCopied by literal.
      // +2: the thinking picker calls assistant.thinking and assistant.thinkingCurrent by literal.
      // +4: the row page's backlinks count, its zero form and "Linked to this page" call their keys by literal.
      // +25: the button editor's Notion actions, confirmation, variables, recipients and header warning call their tools.database.button* keys by literal.
      // +2: it also calls tools.database.automationPageAdded and filterValue by literal (see below).
      // +4: the date picker's Remind row, its None, the alarm label and the property's Notifications row, by literal.
      // +29: the form's Select type panel, question type labels, page picker, file limit and Share panel call their tools.database.form* keys by literal.
      // +3: the feed card's Add reaction, React and "reacted with" hint call their keys by literal.
      // +12: the built-in comments thread, composer and row page section call their tools.database.comment* keys by literal.
      // +2: the feed card's comment summary row calls tools.database.feedCommentReplyOne/feedCommentReplies by literal.
      // +2: the page block's creating title and Draft badge call tools.page.creating/draft by literal.
      // +1: the row menu's "Page" heading calls tools.database.rowMenuPage by literal.
      // +2: the row menu's Layout and Property visibility call tools.database.settingsLayout and
      // settingsPropertyVisibility by literal (they left registered-namespace-compatible).
      // +5: the map's "No place (N)" chip, Add pin button (label, on/off names) and the Place editor's
      // "Open in Google Maps" call their tools.database.* keys by literal.
      // +1: the Place editor's name chip × calls tools.database.placeClear by literal.
      // +6: the linked view's source panel calls its eight tools.database.linked* keys by literal;
      // the old inline picker's linkedPickSource and linkedNoSources are gone.
      // +5 / -1: the Ask AI status line calls its five assistant.status.* keys by literal; assistant.working is gone.
      // +19: the Ask AI status line names the block being written, by literal key in step-status.ts.
      // +1: the form question chip calls tools.database.formEditQuestion by literal.
      // -2 / +1: the feed summary's plural keys left (see below); the number range bucket calls
      // tools.database.groupRangeBucket by literal.
      // +2: the gallery's Moved to Trash toast calls its two keys by literal.
      // +1: the board 99+ switch's hint calls tools.database.calcShowLargeCountsHint by literal.
      // +1: the favorited row page star's hint calls tools.database.peekUnfavoriteHint by literal.
      // +1: the number range "Out of range" group calls tools.database.groupOutOfRange by literal.
      // +4: the date picker's Now button and time zone search, current and select labels by literal.
      // +4: the form's anonymous pill, Anonymous name and thank-you buttons call their keys by literal.
      // +1: the New data source row calls tools.database.newDataSource by literal.
      // +6: the named-source row and the last-view question call their keys by literal.
      // +1: the New database AI prompt box calls tools.database.aiSetupPlaceholder by literal.
      // +60: the Suggested database templates (names, chips, views, options, sample rows) call their keys by literal.
      // +13: the CSV import dialog calls its keys by literal.
      // +1: the Priority and Effort level "Medium" options got a key each.
      // +1: toolNames.mapView, which also names the Map view entry's first view.
      // +1: the paragraph's AI placeholder calls tools.paragraph.placeholderAi by literal.
      // +24: research/28's "/" Database entries: their toolNames.* labels, toolbox.preview.* hints and
      // tools.database.seed* names are called by literal.
      // +4: the template "Undo … database" rows and the "New task" / "New project" templates.
      // +2: "Learn about reminders" and "Learn about imports" call their keys by literal.
      // +1: the property menu's (i) calls tools.database.addPropertyDescription by literal.
      // +1: and tools.database.editPropertyDescription once a description exists.
      // +14: the Relative date format's "Last <weekday>" / "Next <weekday>" keys by literal.
      // +2: the CSV dialog's "Use first row as headers" switch and "New table" preview title.
      // -1: tools.database.dateFormat.full left for registered-namespace-compatible: the CSV type
      // label now builds its date-format key from the picked format.
      // +62: the "More templates" gallery and its four templates (60 new keys; net 2 moved over from registered-namespace-compatible).
      // +2: the side peek resize hint calls tools.database.peekResizeHint and peekResizeHintAction by literal.
      // +1: the Ask AI bar's Continue button calls assistant.continue by literal.
      // +1: the CSV merge dialog's "Import Location".
      // +77: Campaign Management, Content Calendar and Goals Tracker's Quarter and Progress (research/31 §7, §8).
      // +2: Goals Tracker's Days until due chip and its "Overdue" text (research/31 §8).
      // +12: the Ask AI action buttons, Insert, its done line and the group name, by literal.
      // +1: the "/" menu footer calls toolbox.closeMenu by literal (research/30 §B7c).
      // +1: the merge dialog's subtitle, tools.database.csvMergeDescription (research/31 §5a).
      // +2: a status option's "Set as default" and "Default" call templateSetDefault / templateDefault by literal.
      // +277: the twelve research/33 templates and Campaign / Content Calendar's off chips, views and page templates.
      // +2: rowEditedTodayAt and feedCreatedAt (research/35 §19).
      // +1: the form's respondent chip, formRespondentPill (research/36 §13).
      // +1: tools.file.preview, called by literal for the form's Preview button.
      // +3: the relative date chip's "This" label (filterDateThisMonth / filterDateThisYear) and the search empty state's searchClear, called by literal.
      // +3: the calendar and timeline "No date" popover's search and hints (findings-caltimeline C03/C04).
      // +2: the timeline's ‹ › labels, timelinePrevious / timelineNext (findings-caltimeline C05).
      // +2: the row page's "…" hint (peekActionsHint) and its "Edit view default" item, by literal.
      // +1: popover.filteredResults, the "/" menu's search header.
      // -2: tools.database.openRow and deleteRow; the list row lost its "›" and "×" (findings-listgallery L03).
      // -1: tools.database.galleryNew; the gallery tile reads tools.database.newPage (findings-listgallery L14).
      // +1: tools.database.addNewView, the Add view heading (feel/findings-toolbar V04).
      // -12: the 10 Add view descriptions, and duplicateView/deleteView now that the tab menu
      // reads "Duplicate view"/"Delete view" (feel/findings-toolbar V04, V07). The keys still ship.
      // -2: tools.database.addCard and addRow; the add buttons are named by their visible
      // "New page" text (axe label-content-name-mismatch). The keys still ship.
      // -9: the Ask AI action labels, now read as assistant.action.<skill id> (25d88cef).
      // +16: toolbox.preview.databaseFullPage, the Ask AI unlock/restore questions and answers, assistant.edited,
      // discardPartial, discardRestored, and the property menu's propertyTypeListHeading, editFormula, showNumber
      // and rollupTargetProperty, all by literal.
      // -2: tools.database.propertyNamePlaceholder (58acb411) and rollupProperty (47825485) lost their literal callers.
      // +1: tools.database.formulaLimitReached, the warning mark's label on a capped formula cell, by literal.
      // +6: the Edit property panel's rollupSelect, relationThisDatabase, relationRelatedToHint,
      // relationTwoWayEnable, relationTwoWayHint and rollupShowUniqueHint, by literal (1fb560cd).
      // +3: settingsSearchProperty, settingsOn and settingsOff gained literal callers in the same panel (1fb560cd).
      // +5: the Ask AI sharing question, its untitled form, Allow, Keep as is and Calendar sync, all by literal.
      // +4: groupSort, groupSortManual, groupSortAlphabetical and groupSortReverse gained literal callers
      // in the select option Sort row (a71fed2d).
      // +3: the button's Send message to agent action, its busy toast and its failed toast, by literal.
      // +1: its confirmation, tools.database.buttonAgentConfirm, by literal.
      // +1: tools.database.propertyNamePlaceholder is the table header "+" field's placeholder again, by literal.
      'executable-literal': 1901,
      // +10: the tabs block calls its 9 tools.tabs.* keys and toolbox.preview.tabs by literal.
      // toolNames.page moved here from finite-dynamic when the page-reference picker called it directly.
      // -5: tools.video.back/on/off/speedDecrease/speedIncrease left i18nLabel
      // when the video settings became one pane (1b400077); still shipped.
      // +3: toolNames.tabs (titleKey), searchTerms.tabs, toolNames.tab (block name).
      // +1: the "Linked view of data source" toolbox entry's toolNames.linkedDatabase.
      // +1: toolNames.askAi, the Ask AI inline tool's titleKey.
      // +6: the thinking menu's assistant.thinking.<level> labels.
      // +1: the Table view toolbox entry's toolNames.tableView (toolNames.mapView is a literal: the seeded map view's name).
      // +9: the Ask AI action labels, assistant.action.<skill id>.
      // +1: toolNames.databaseFullPage (f6d462a0).
      'finite-dynamic': 136,
      // 12 of the 20 image darkroom keys are called by literal. The 8 filter
      // names stay here: filter-strip.ts builds them from the preset name.
      // +9: the markup tool names; markup-panel.ts builds them from a short key.
      // +6: the new shape names, built the same way.
      // +16: the new filter names, built from the preset name like the first 8.
      // +5: the video keys above.
      // -9: the shortcut sheet now names those 9 markup tools by literal.
      // +81: the database filter operators, number formats, date/time formats, show-as, visibility and
      // display-as choices are composed from tools.database.* namespaces.
      // +115: the database view settings panel builds its tools.database.* keys from a short name.
      // +57: formula error codes (formulaErrorKey), the 24 rollup functions (rollupFn.<fn>) and
      // the any/every/none rollup filter operators are composed from tools.database.* namespaces.
      // -1: tools.database.settingsOpenPagesIn moved to executable-literal (see above).
      // +43: the chart settings rows build their tools.database.chart* keys from a short name.
      // +1: the view settings panel builds tools.database.settingsMoreSettings from a short name.
      // +1: tools.database.layoutCustomizing, the old builder bar's title. Still shipped in every locale.
      // +1: tools.database.aiAutofillTriggerOn, the old trigger value. Still shipped in every locale.
      // +2: tools.database.searchLabel and searchPlaceholder lost their last literal caller with the builder bar search.
      // -2: tools.database.templateNew and templateUntitled gained literal callers in the row page template picker.
      // -1: tools.database.settingsTitle gained a literal caller in the builder's tab menu.
      // -1: tools.database.settingsDragToReorder gained a literal caller in the view overflow list.
      // +1: tools.database.aiAutofillNew, called through the view settings panel's namespaced t().
      // +5: "Save chart as…" swaps chartSavePng/chartSaveSvg for 7 chart export keys, all built from a short name.
      // -2: tools.database.automationPageAdded and filterValue gained literal callers in the button editor.
      // +11: the date reminder choices, built from tools.database.dateRemind.<offset>.
      // +6: the form auto-create prompt's five keys and the toolbar's "Share form", called through a namespaced t().
      // -2: settingsLayout and settingsPropertyVisibility, now also called by literal (see above).
      // +2: the map settings' Style section and Map by row, called through the panel's namespaced t().
      // +1: the view settings panel builds tools.database.settingsLockViews from a short name.
      // +8 / -1: the repeat interval's plural keys (templateRepeatEvery<Unit>_one/_other) replace templateRepeatEvery,
      // all built from a short name.
      // +25 / -2: the template banner's "Duplicate every…" summary, presets, ↻ hints and Cancel recurrence
      // replace templateRepeat and templateRepeatOff, all built from a short name.
      // +2: the feed summary's tools.database.feedCommentReplies_one/_other replace feedCommentReplyOne/feedCommentReplies.
      // +3 / -1: the number range's groupRange, groupRangeEvery and groupRangeExample replace groupRangeSize,
      // all built from a short name.
      // +21 / -12: Edit cadence's labels, Weekday and the unit plurals (templateRepeatUnit<Unit>_*) replace the
      // Every-N plurals and Daily/Weekly/Monthly/Yearly, all built from a short name.
      // +2: the gallery trash toast's screen-reader plural tools.database.blocksDeleted_one/_other.
      // +1: the view settings "Source" row, tools.database.settingsSource.
      // +6: Edit cadence's months row, "On the", the ordinals (templateRepeatOrdinal<Category>) and "Day", all built from a short name.
      // +1: the template menu's "Default" (tools.database.templateDefault, via the menu's prefixing t).
      // +1: tools.database.dateFormat.full (see executable-literal).
      // -2: see executable-literal ("More templates").
      // -2: see executable-literal (status default).
      // +2: the board's Card layout box (settingsCardLayout, settingsCardLayoutCompact), via the panel's prefixing t.
      // +1: the template row's "…" hint, tools.database.templateMore (research/30 X1).
      // -1: tools.file.preview moved to executable-literal (form Preview).
      // +1: the feed's Property visibility header, settingsShownInFeed, via the panel's prefixing t.
      // +1: Edit cadence's "Discard unsaved changes?" (templateRepeatDiscardTitle), via the panel's prefixing t.
      // +12: the relative date filter, filter bar minimize and template menu heading keys,
      // called through the database's prefixing t() (filterOperator.isBetween is composed from a short name).
      // +7: the other layouts' Property visibility headers (settingsShownIn<Layout>) and its search
      // (settingsSearchProperty), via the panel's prefixing t.
      // +2: tools.database.openRow and deleteRow (see executable-literal).
      // +1: tools.database.galleryNew (see executable-literal).
      // +12: see executable-literal (Add view descriptions, old tab menu labels).
      // +2: tools.database.addCard and addRow (see above).
      // +2: the formula errors tooComplex and patternTooComplex, composed from formulaErrorKey.
      // +2: propertyNamePlaceholder and rollupProperty (see executable-literal); still shipped.
      // -3: settingsSearchProperty, settingsOn and settingsOff (see executable-literal).
      // -4: the groupSort* keys (see executable-literal).
      // -1: propertyNamePlaceholder (see executable-literal).
      'registered-namespace-compatible': 520,
      'catalog-only': 4,
    });
    expect(
      [...lifecycle.entries()]
        .filter(([, category]) => category === 'catalog-only')
        .map(([key]) => key)
        .sort()
    ).toEqual([...CATALOG_ONLY_KEYS].sort());
  }, 60_000);

  it('classifies every new migration key as an executable literal with a direct caller', () => {
    const { lifecycle, directLiteralCalls } = getLifecycle();
    const migrationKeys = [
      'tools.video.statsResolution',
      'tools.video.statsDroppedFrames',
      'tools.video.statsBufferHealth',
      'tools.video.statsViewport',
      'tools.video.statsUnavailable',
      'tools.database.moreViews',
      'tools.video.errorNotMediaUrl',
      'tools.video.errorUnplayable',
    ];

    expect(migrationKeys.map(key => lifecycle.get(key)))
      .toEqual(Array.from({ length: migrationKeys.length }, () => 'executable-literal'));
    expect(migrationKeys.filter(key => !directLiteralCalls.has(key))).toEqual([]);
  }, 60_000);
});
