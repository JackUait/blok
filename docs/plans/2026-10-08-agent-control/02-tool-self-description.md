# 02: Tool self-description and the capability manifest

Date: 2026-10-08. Builds on `00-brief.md`. Owner of this spec: how a tool **declares** its data schema and its named actions, and the **manifest** core builds from the live tool registry. Spec 01 owns the command envelope and dispatch. This spec only declares; 01 runs.

Citations are `path:line` against the tree at `fb62db72`. "Unverified" marks anything not read in code.

Revised to match `06-reconciliation.md`, rounds 1, 2 and 2b. Where 06 conflicts with an earlier draft of this spec, 06 wins; where 06's round-2 sections (§7–§11) differ from its §3, round 2 wins. Shapes marked "canonical" are copied from 06 §3, plus round-2 additions marked "(06 R2)". "06 D#" markers cite the user's decisions in 06 §5. All of D1–D6 and D1a are decided.

---

## 1. Purpose and success criteria

Agents break documents today because nothing tells them what a block's data looks like or what they can do to it. They write Markdown into `text`, invent fields, or skip features they cannot see.

This spec gives every tool a machine-readable self-description:

1. **A data schema.** What the tool's `data` holds, which fields are rich text, value ranges and enums.
2. **Named actions.** Tool-specific operations a human can reach in the UI (`table.insertRows`, `image.crop`, `database.addView`). Each has an args schema, preconditions and the host services it needs.
3. **Structure facts.** The container contracts core already enforces (`childTools`, `acceptsChildren`, `isLayout`, ...), restated for an agent.
4. **Guidance.** A few lines of agent-facing text per tool: when to use it, and the traps.

Core assembles these into one **manifest** from the live registry. `buildAgentContract` merges the manifest with 01's core commands into one `AgentContract` (06 §3.6). Specs 03 and 04 render that contract into LLM tool definitions and MCP tools with one shared renderer, `renderAgentTools` (06 §3.7).

Success criteria:

- **S1.** Every built-in block tool, inline tool and tune has a description. A law test fails when one is missing.
- **S2.** Every built-in schema is checked against the tool's real `save()` output, in both directions, and an instance of that output validates against it. A renamed field turns a test red.
- **S3.** Every human-reachable tool-specific data action in section 2.6 has a declared action, or a recorded reason why it is covered by a generic 01 command instead. (Spec 05 enforces the coverage; this spec provides the declarations it checks.)
- **S4.** A third-party tool that declares nothing still appears in the manifest with what core already knows. An agent can do generic CRUD on it. It never gets a fabricated schema.
- **S5.** The manifest is buildable without a DOM. In v1 it is built in Node (04, from `BUILT_IN_BLOCK_DESCRIPTIONS`, 06 04-Q9) and in the C# server's Jint runtime through a `manifest` op (06 D1, §7.2).
- **S6.** Nothing published changes shape. `blokDocumentSchema` stays byte-identical through the refactor, with one deliberate change: the new optional top-level `page` property (06 §10.1 A). The snapshot is re-pinned once for it.

---

## 2. What exists today

### 2.1 Tool statics core already reads

`BlockToolConstructable` (`types/tools/block-tool.d.ts:216-460`) declares these statics. Core reads them through `BlockToolAdapter` (`src/components/tools/block.ts`), keyed by `InternalBlockToolSettings` (`src/components/tools/base.ts:68-168`).

| Static | Declared | Read in core | What an agent needs from it |
|---|---|---|---|
| `toolbox` (entries, variants) | `block-tool.d.ts:220`; entry shape `types/tools/tool-settings.d.ts:27-103` | `block.ts:379` | Insertable variants and their seed `data` (e.g. list styles, heading levels) |
| `conversionConfig` `{import, export}` | `block-tool.d.ts:230`; `types/configs/conversion-config.ts:6-25` | `block.ts:500` | Which tools it can turn into |
| `pasteConfig` | `block-tool.d.ts:225` | `block.ts:537` | Not needed by agents (paste path only) |
| `ownsChildren` | `block-tool.d.ts:247` | `block.ts:132` | Children are tool machinery; do not nest user blocks |
| `childTools {allow, deny}` | `block-tool.d.ts:19-27, 278` | `block.ts:146`; enforced in `src/components/utils/child-tools.ts:28-118` | Legal direct children |
| `acceptsChildren` | `block-tool.d.ts:293` | `block.ts:156`; `child-tools.ts:76` | Never has children |
| `richTextFields` | `block-tool.d.ts:300` | `block.ts:555`; `declaredRichTextFields` `base.ts:177-183` | Which fields take rich-text segments, not Markdown |
| `copiesOwnChildren` | `block-tool.d.ts:312` | `block.ts:220` | Not needed by agents |
| `copyAsLink`, `duplicateData`, `prepareInsert` | `block-tool.d.ts:328, 338, 348` | `block.ts:178-235` | `prepareInsert` means "inserting needs the host" |
| `blockMenu` | `block-tool.d.ts:357` | `block.ts:164` | Not needed |
| `keepsChildrenOnEnter`, `deletesChildren`, `isLayout` | `block-tool.d.ts:381, 391, 400` | `block.ts:263-289` | Deleting removes the subtree; layout piece |
| `assetKind` | `block-tool.d.ts:411` | `block.ts:301` | Data holds a host-uploaded URL at `data.url` |
| `upgradeData` | `block-tool.d.ts:450` | `block.ts:329` | Not needed |
| `isReadOnlySupported` | `block-tool.d.ts:235` | `block.ts:94` | Not needed |

Inline tools add `isInline`, `shortcut`, `titleKey`, `sanitize`, `allowCaretShortcut`, `replacesToolbar`, `nativeCaretShortcut`, `hydrate` (`types/tools/tool.d.ts:32-82`, `types/tools/inline-tool.d.ts:35-90`). Tunes add `isTune` and an instance `save()` returning tune data (`types/block-tunes/block-tune.d.ts:26-80`).

The published `BlockToolAdapter` type exposes most of these (`types/tools/adapters/block-tool-adapter.d.ts:15-140`) through `api.tools.getBlockTools()` (`types/api/tools.d.ts:22`). It does **not** expose `richTextFields`, `isLayout`, `deletesChildren` or `ownsChildren` (read of that file; none of those names appear in it).

None of these statics describe the **shape of `data`** or any **tool-specific action**.

### 2.2 A published JSON Schema of saved data already exists

This is the most important finding. Blok already ships a hand-written JSON Schema (draft 2020-12) for the whole saved document:

- `src/view/document-schema.ts:83` exports `blokDocumentSchema`. Its header says consumers use it "to constrain LLM structured output" (`document-schema.ts:8-11`).
- It has one `$defs` entry per built-in block tool, routed by `allOf`/`if` on `type` (`document-schema.ts:148-173`). A custom tool's block still validates, with open `data` (`document-schema.ts:119`).
- Rich text is a shared def: segments or inline HTML (`document-schema.ts:22-80`), mirroring `types/rich-text.d.ts:2-53`.
- It carries ranges, enums and agent-friendly descriptions TS types cannot carry. Examples: spacer `height` 38..600 (`:426`), image `rotation` enum (`:504`), "Open state is personal and never saved" for toggle `isOpen` (`:286`).
- It is published at `@bloklabs/core/view` (`src/view/index.ts:24`, `types/view.d.ts:697`).
- The server runtime serves it as the `schema` operation (`src/view/server-runtime.ts:466-467`), and the C# server exposes it as `IBlokDocumentConverter.GetSchemaAsync` (`packages/server/dotnet/Blok.Server/Documents/IBlokDocumentConverter.cs:163-173`).
- It is drift-guarded. `test/unit/view/document-schema.test.ts:1-11` builds each built-in tool, seeds it maximally, calls its real `save()`, and compares key sets with the `$defs` in both directions (`:409-427`). The tool list is `defaultBlockTools` plus `page` and `page-link` (`:63`).

The test compares **key sets**, not values. A wrong enum or a wrong type would pass it (read of `:409-427`).

### 2.3 Purity boundary

- `document-schema.ts` has no imports by design (`document-schema.ts:4-5`).
- No module outside `src/view/` may import from `src/view/` (`test/unit/architecture/view-entry-law.test.ts:59-68`). So a tool class cannot import its `$def` from there today.
- `src/shared/` is the sanctioned pure layer both sides use. The precedent is `src/shared/tool-classes/` — "Pure, DOM-free registry of every tool's STATIC presentational classes. Both the editor's block tools and the view's emitters read from here" (`src/shared/tool-classes/index.ts:1-20`).
- The server runtime imports no tool class (`src/view/server-runtime.ts:1-19`). Tool classes pull in the DOM. Anything the server needs must live in `src/shared/` or `src/view/`.

### 2.4 Other relevant facts

- **No schema library.** None of zod, ajv, valibot, typebox, json-schema, yup, superstruct, joi or arktype is a dependency of the root or any `packages/*`, or imported in `src/`. `package.json` has no `dependencies` field (read via `node -e`). `package.json` may not change without an explicit request (`CLAUDE.md`, Configuration).
- **Keywords the existing schema uses** (counted in `document-schema.ts`): `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `items`, `oneOf`, `anyOf`, `allOf`, `if`/`then`, `$ref`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `deprecated`, `description`.
- **Adapter prop schemas.** React and Vue blocks must declare `propSchema: PropSchema` (`packages/react/src/createReactBlock.tsx:285`, `packages/vue/src/createVueBlock.ts:217`). It is `Record<string, {default, values?}>` (`src/shared/prop-schema.ts:3-16`). It fixes the exact `save()` key set and defaults. `values` is advisory. It is a defaults table, not a type schema. **Unverified:** whether the Angular adapter has an equivalent; I did not find `propSchema` in `createAngularBlock.ts` with grep.
- **Adapter statics forwarding.** Adapters copy an authored `statics` bag onto the generated class, skipping reserved keys: React `createReactBlock.tsx:1043-1060` (reserved `:93-98`), Vue `createVueBlock.ts:722-736` (`:60`), Angular `createAngularBlock.ts:570-584` (`:41`). The bag's type is `Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>` (React `:51`, Vue `:57`, Angular `:38`). So a new optional static on `BlockToolConstructable` reaches adapter authors with no adapter change.
- **Insert-time data handling.** No schema validation runs on insert. `hostDataForTool` (`src/components/modules/api/blocks.ts:946-962`) turns segments into HTML for rich fields, sanitizes with the tool's and the global config, and strips unsafe URLs. `tool.validate()` only runs at save (`src/components/modules/saver.ts:982`).
- **Unknown block types survive.** An unregistered type renders as `Stub`, which keeps its `savedData` (`src/tools/stub/index.ts:15, 46-57`).
- **Rich-text marks.** `RichTextMarks` (`types/rich-text.d.ts:13-29`) has `bold`, `italic`, `underline`, `strikethrough`, `code`, `sup`, `sub`, `highlight`, `color`, `background`, `link`, and `tag:<name>` for custom inline tools. HTML maps to marks in `src/shared/rich-text/html-to-segments.ts:8-12, 127-176`. The `api.marks` API works on DOM ranges, not on data (`types/api/marks.d.ts:84-146`).
- **Colour presets.** `gray, brown, orange, yellow, green, blue, purple, pink, red` (`src/components/shared/color-presets.ts:15-23`).
- **i18n.** `toolNames.*` titles cover block and inline tools (`types/message-keys.d.ts:170-203`). `toolbox.preview.*` has one English caption per block-tool variant, 30 keys (`types/message-keys.d.ts:207-236`), e.g. "Just start writing with plain text" (`src/components/i18n/locales/en.json:20`). Inline tools and tunes have no caption key.
- **Generated declarations.** `scripts/generate-icons-dts.mjs`, `generate-data-attributes-dts.mjs` and `generate-message-keys-dts.mjs` each read one `src/` source and write a `types/` file. `test/unit/architecture/published-types-no-src-refs.test.ts:179-268` compares the sets. These mirror **names**, not data shapes.
- **Last release** is `v1.16.1` (`git tag --sort=-v:refname`).

### 2.5 Tool-method entry points that exist today

- `BlockAPI.call(methodName, param?)` passes exactly one argument (`src/components/block/index.ts:496-508`). Database `renameView(viewId, name)` and table `deleteRowWithCleanup(rowIndex)` cannot be driven through it cleanly.
- There is no `api.table` or `api.database` namespace.
- `api.blocks.update(id, data)` routes to a tool's `setData` when it has one. The gate is `liveBlock.tool.supportsInPlaceSetData` (`src/components/modules/blockManager/block-mutation.ts:316-320`). Without it the block takes the recompose path. Table has `setData` (`src/tools/table/index.ts:1231`). Database has none, so it recomposes. Whether recompose keeps database rows attached is unverified; 01 adds a test (06 02-Q4).

### 2.6 Inventory of human-reachable tool-specific actions

The inventory is split three ways. Only **data actions** become declared actions. **View-state** is per-person and never saved. **View-only** reads or exports and changes nothing.

Legend for the **Route** column (names follow 06 C5):

- **field** — a plain write of one saved field. It goes through 01's generic block update, validated by this tool's data schema. No tool action is declared.
- **`<registryKey>.<action>`** — a declared tool action, a top-level command (section 3.4 says when one is needed).
- **generic** — a 01 core command that works for every block (`block.insert`, `block.delete`, `block.move`, `block.convert`, `block.duplicate`, `text.format`, ...; 06 §3.1).
- **view-state** — per-person state that is never saved. Cut from v1; the user can revisit (06 02-Q5, D6).
- **view-only** — reads, copies or opens. Changes no document. Out of scope.

Sources: each row was read in code by an exploration pass this session. The citation is where the UI lives.

#### Core, for every block

| Human action | Where | Route |
|---|---|---|
| Turn into | `src/components/modules/toolbar/blockSettings.ts:610-622` | generic (convert) |
| Turn selection into columns | `blockSettings.ts:571-608` | `column_list.create` with `from` |
| Duplicate | `blockSettings.ts:648-668`; Cmd+D `src/components/modules/blockManager/shortcuts.ts:73-79` | generic |
| Delete / Move to Trash | `blockSettings.ts:686-732` | generic |
| Move up / down | Cmd+Shift+Up/Down `blockManager/shortcuts.ts:73-79` | generic |
| Drag to move, nest, or into a column | `src/components/modules/dragManager.ts`; side drop `src/tools/column-drop.ts:73, 262` | generic `block.move` into an existing column (06 01-Q7); side drop = `column_list.create` beside a plain block, `column_list.addColumn` on an existing column list |
| Block text / background colour (slash entries) | `src/components/ui/toolbox.ts:1063-1087, 898-905` | field (`textColor`, `backgroundColor`) |
| Copy as Markdown, Copy link | `blockManager/shortcuts.ts`; `src/components/block-tunes/block-tune-copy-link.ts:52-92` | view-only |
| Markdown shortcuts (`# `, `- `, `> `, `---`, ...) | `src/components/modules/blockEvents/composers/markdownShortcuts.ts:211-847` | generic insert/convert with variant data |

Built-in tunes: only `delete` and `copyLink`, registered at `src/components/modules/tools.ts:323-341`. Neither has `save()`, so neither stores tune data.

#### Text and simple blocks

| Tool | Human action | Where | Route |
|---|---|---|---|
| paragraph | Colour | `src/tools/paragraph/index.ts:421` | field |
| header | Level | `src/tools/header/index.ts:568-590` | field (`level`, narrowed by config `levels`) |
| header | Toggle heading on/off | toolbox / `>#` shortcut / turn into only (`header/index.ts:1489-1521`) | generic convert, **not** a field write. Turning a toggle heading into a plain heading releases its children to its own level (`src/components/utils/turn-into-children.ts:25-39`). A raw `isToggleable: false` write does not run that path (no such handling found in `header/index.ts`; `isToggleable` is only a re-render key, `:74`). So `isToggleable` is a guarded field (section 3.5) |
| header | Open / close | `header/index.ts:1024, 1172-1181` | view-state |
| list | Style | `src/tools/list/index.ts:650`, `block-operations.ts:211-224` | field (`style`, narrowed by config `styles`) |
| list | Check | `list/index.ts:208`; Cmd+Enter `:477` | field (`checked`) |
| list | Indent / outdent | Tab / Shift+Tab `list/index.ts:510-541` | generic (set parent). `depth` is derived from the tree on save (`list/index.ts:703-709`) |
| list | Start number | only `N. ` shortcut or paste (`markdownShortcuts.ts:308-321`) | field (`start`) |
| toggle | Colour | `src/tools/toggle/index.ts:257` | field |
| toggle | Open / close (and shortcuts) | `toggle/index.ts:386-395`; `toggle-shortcuts.ts:18-20` | view-state |
| callout | Icon | `src/tools/callout/index.ts:407-412, 575, 536` | field (`emoji`) |
| callout | Colour | `callout/index.ts:414-425, 386-392` | field |
| quote | Size | `src/tools/quote/index.ts:164-189` | field (`size`) |
| code | Language | `src/tools/code/index.ts:694-731, 808-824` | field (`language`) |
| code | Filename | `code/index.ts:497-535` | field (`filename`) |
| code | Code / preview / split | `code/index.ts:203-218` | view-state (not in `save()`) |
| spacer | Height | `src/tools/spacer/index.ts:217, 429-444` | field (`height`, 38..600) |
| table_of_contents | Colour | `src/tools/table-of-contents/index.ts:159` | field |
| divider | none | — | — |

#### Layout containers

| Tool | Human action | Where | Route |
|---|---|---|---|
| column_list | Create with N columns | toolbox `src/tools/column-list/index.ts:253` (2-5) | `column_list.create` |
| column | Resize / equalize | `src/tools/columns-shared.ts:183-186, 289-302` | `column_list.setWidths` (writes `widthRatio` on several children) |
| column | Add a column by side drop | `column-drop.ts:73, 262` | `column_list.addColumn` (target is an existing column list; a side drop beside a plain block is `column_list.create`) |
| column | Remove (unwraps when one is left) | `src/tools/column/index.ts:303-311` | `column_list.removeColumn` |
| tabs | Create | toolbox `src/tools/tabs/index.ts:403` | `tabs.create` |
| tabs | Add tab | `tabs/index.ts:565-576, 379` | `tabs.addTab` |
| tab | Rename | `tabs/index.ts:808-811, 705-707, 291` | field on the `tab` block (`title`) |
| tab | Icon | `tabs/index.ts:814-817, 941-953` | field (`icon`) |
| tabs | Delete tab (last one deletes the tabs block) | `tabs/index.ts:307-322` | `tabs.deleteTab` |
| tabs | Reorder | `tabs/index.ts:366`; `pill-gestures.ts:35-38` | generic move within parent |
| tabs | Active tab | `tabs/registry.ts:21, 39` | view-state |

#### Table (`src/tools/table/`)

The pure model is `TableModel` in `table-model.ts` (TM). Its row/column ops return what to populate or delete; the caller creates and deletes blocks (exploration finding; e.g. `addRow` `:352` returns `cellsToPopulate`). Whether `table-model.ts` is DOM-free at import is **unverified**.

| Human action | Where | Route | Reusable op |
|---|---|---|---|
| Create N x M | toolbox `index.ts:488` | `table.create` | `normalizeTableData` `table-operations.ts:648` |
| Insert row above/below, append, drag-add | `table-row-col-popover.ts:219-234`; `table-add-controls.ts:158, 403`; `table-corner-drag.ts:197` | `table.insertRows` | TM `addRow` `:352` |
| Insert column left/right, append | `table-row-col-popover.ts:158-173` | `table.insertColumns` | TM `addColumn` `:430`; `planInsertColumnWidths` `table-operations.ts:245` |
| Delete rows / columns | `table-row-col-popover.ts:178-189, 239-250` | `table.deleteRows`, `table.deleteColumns` | TM `deleteRow` `:380`, `deleteColumn` `:467` |
| Move row / column | `table-row-col-drag.ts:449, 459` | `table.moveRow`, `table.moveColumn` | TM `moveRow` `:404`, `moveColumn` `:501`, guards `:794, 811` |
| Duplicate rows / columns | `table-row-col-popover.ts:99-106` | `table.duplicateRows`, `table.duplicateColumns` | none pure (`duplicateRangeContent` `table-subsystems.ts:826`) |
| Clear contents of a range | `table-row-col-popover.ts:107-115`; pill `table-cell-selection.ts:1532-1547`; Delete on selection `:748-762` | `table.clearCells` | none pure (`clearCellsContent` `table-subsystems.ts:910`) |
| Cell / row / column colour | `table-row-col-popover.ts:59-87`; `table-cell-selection.ts:1425-1460` | `table.styleCells` | TM `setCellColor` `:268`, `setCellTextColor` `:298` |
| Cell placement (9-way) | `table-cell-selection.ts:1463-1490` | `table.styleCells` | TM `setCellPlacement` `:325` |
| Merge / split | `table-cell-selection.ts:1493-1525` | `table.mergeCells`, `table.splitCell` | TM `canMergeCells` `:555`, `mergeCells` `:616`, `splitCell` `:708` |
| Fill right / down | Cmd+R / Cmd+D `table-cell-selection.ts:153-165` | `table.fillCells` | TM `setCellBlocks` `:219` |
| Heading row / column | `table-row-col-popover.ts:139-154, 200-215`; `index.ts:702-717` | field (`withHeadings`, `withHeadingColumn`) | TM `setWithHeadings` `:947` |
| Column widths, fit to page | `table-resize.ts:90, 514`; `index.ts:718-724, 809` | field (`colWidths`; absent = fit) | TM `setColWidths` `:959` |
| Full width | `index.ts:725-732, 787` | field (`stretched`). The UI also sets `block.stretched` (`index.ts:787`); whether a data write alone updates it is **unverified** |
| Text size | `index.ts:733-755, 777` | field (`textSize`) |
| Format text across cells | `table-cell-selection.ts:119-141` | generic rich-text format on each cell block |
| Edit cell content | cells are child blocks (`types/tools/table.d.ts:10-16`) | generic, addressed by cell block id |

#### Database (`src/tools/database/`)

The pure model is `DatabaseModel` in `database-model.ts` (DM). Rows are child `database-row` blocks inserted with `api.blocks.insertAt(..., { parentId })` (`index.ts:1103-1107`).

| Human action | Where | Route | Reusable op |
|---|---|---|---|
| Create (table or board variant) | toolbox `index.ts:104` | generic insert with variant data, or `database.create` for seeded rows | — |
| Title | `index.ts:181-228` | field (`title`) | — |
| Add view (board or list) | `database-tab-bar.ts:125-131` → `index.ts:753` | `database.addView` (board needs a `groupBy`) | DM `addView` `:155` |
| Rename / duplicate / delete / reorder view | `database-tab-bar.ts:297-322, 601` → `index.ts:765-818` | `database.renameView`, `.duplicateView`, `.deleteView`, `.moveView` | DM `updateView` `:173`, `deleteView` `:179`, `positionBetween` `:249` |
| Switch view | `database-tab-bar.ts:255` → `index.ts:717` | field (`activeViewId`, saved at `index.ts:270`). **Unverified** whether a UI switch persists (06 B5: `switchView` rebuilds DOM, so the mutation observer may catch it); if it does not, this is view-state |
| Add property | `database-card-drawer.ts:588-604` → `index.ts:1327` | `database.addProperty` | DM `addProperty` `:54` |
| Add / rename / reorder board column (select option) | `database-board-view.ts:69`; `database-column-controls.ts:44-108`; `index.ts:1461` | `database.addOption`, `.renameOption`, `.moveOption` | DM `updateProperty` `:68` |
| Delete board column (also deletes its rows) | `database-column-controls.ts:52-60` → `index.ts:1549` | `database.deleteOption` with explicit `rows: 'delete' \| 'keep'` | — |
| Add row / card | `database-board-view.ts:237`; `database-list-view.ts:346` → `index.ts:1090, 1118` | `database.addRow` | DM `createRowData` `:93` |
| Delete row | `database-board-view.ts:313`; `database-list-view.ts:263` | generic delete of the row block | — |
| Move card between groups / reorder | `index.ts:1378-1403, 1427, 1440` | `database.moveRow` | `positionBetween` |
| Edit row title | `database-board-view.ts:300-361`; `database-card-drawer.ts:252-263` | `database.setRowValues` (title mirrors the title property) | row `updateTitle` `database-row/index.ts:115` |
| Edit row description | `database-card-drawer.ts:741, 839` → `index.ts:1273` | `database.setRowValues` (may add a richText property) | — |

No UI exists for property rename/delete/retype, sorts, filters, visible properties, a view's type or a board's `groupBy` (exploration finding; `DM.deleteProperty` `:75` has no caller in `index.ts`). These stay out of v1. Spec 05 can decide whether "human-reachable" will later grow to include them.

#### Media and links

| Tool | Human action | Where | Route |
|---|---|---|---|
| image | Upload / from URL | `src/tools/image/index.ts:1137-1144, 436-444` | `image.setSource` (uses `uploader` for a durable URL when present; a GIF may become a video block, `:286-290`) |
| image | Replace (clear) | `index.ts:869-875, 1512-1523` | field (`url: ''`) |
| image | Alignment, caption, caption toggle, alt, width | `index.ts:846-868, 1320-1327, 1562-1593, 1401-1450` | field |
| image | Crop / aspect / shape | `darkroom/index.ts:258-265, 422-430, 808-864` | `image.crop` (rescales `width` like `applyCrop` `image/index.ts:993-1000`) |
| image | Rotate 90°, flip | `darkroom/index.ts:216-223, 650-690` | `image.rotate`, `image.flip` (also turn `crop` and `markup`) |
| image | Straighten | `darkroom/index.ts:443-466` | `image.straighten` (shrinks crop, `geometry.ts:114`) |
| image | Adjust, filter, strength | `darkroom/index.ts:485-504` | field (`adjust`, `filter`, `filterStrength`; filter enum narrowed by config `filters`) |
| image | Markup: draw, shape, text, move, delete, clear | `markup-panel.ts`, `markup-editor.ts` | `image.addMarkup`, `image.updateMarkup`, `image.removeMarkup` (clear all = `removeMarkup { all: true }`, since `markup` is guarded) |
| image | Lightbox, download, copy URL | `index.ts:883-903` | view-only |
| image | `size`, `frame`, `rounded` | no UI writes them (`ui.ts:1153-1221`; `setFrame`/`setRounded` `index.ts:1492, 1499` have no caller) | field (schema already lists them) |
| video | Upload / URL | `src/tools/video/index.ts:698-705, 330-385` | `video.setSource` |
| video | Alignment, caption, autoplay, loop, hide controls, width | `video/index.ts:211-257, 841-865` | field |
| audio | Upload / URL | `src/tools/audio/index.ts:161-172` | `audio.setSource` (fills title/artist/cover/peaks, `:443-482`) |
| audio | Cover set / remove | `audio/index.ts:236-251, 832-890` | `audio.setCover` (uses `uploader` when present); remove = field |
| audio | Alignment, caption, title, artist, loop | `audio/index.ts:200-228, 651-687` | field |
| file | Upload / URL | `src/tools/file/index.ts:521-529, 208-263` | `file.setSource` (may become image/video, `:348-403`) |
| file | Rename, caption | `file/ui.ts:106-134`; `file/index.ts:124-131` | field |
| embed | Set URL | `src/tools/link/embed/index.ts:839-866, 237-272` | `embed.setUrl` (derives `service`/`embed`/`kind` with `matchEmbedService` `registry.ts:1600`) |
| embed | Alignment, caption, width %, height | `embed/index.ts:943-1012, 1063-1064, 1215` | field |
| bookmark | Create from URL | paste only, `src/tools/link/bookmark/index.ts:108-120, 196-225` | `bookmark.create` (needs `linkMetadata`) |
| page | Create | `prepareInsert` `src/tools/page/index.ts:157-164` | generic insert; core runs `prepareInsert` (needs `pageBackend`) |
| page | Colour | `page/index.ts:418-430` | field |
| page | Rename, icon | `page/index.ts:320-329, 311-318, 432-521` | `page.rename`, `page.setIcon` (another page's fields; host hooks in the browser, cross-document headless; section 3.8) |
| page / page-link | Open, side peek | `page/index.ts:860-898`; `src/tools/page-link/index.ts:124-148` | view-only |
| text blocks | Inline page reference (`@`, `[[`) | `src/components/modules/blockEvents/composers/pageReferenceTrigger.ts:18-28` | generic rich-text (`embed: {page}` segment) |

Two possible existing bugs surfaced by this inventory. They belong to the tool owners, not this spec. 06 §6 checked both:

- **Embed URL submit** (06 B4): likely not a bug. `submitUrl` calls no `dispatchChange`, but `renderState` replaces the tool root's children (`embed/index.ts:421-445`), so the mutation observer likely saves it. Needs a test.
- **Database view changes** (06 B5): plausible only for `renameView` (`database/index.ts:765-768`). It updates the model and the host sync but neither dispatches a change nor rebuilds the DOM. The other view actions rebuild DOM. Needs a failing test first.

#### Inline tools (`src/components/inline-tools/`)

| Tool | Mark it writes (`types/rich-text.d.ts:13-44`) | Args |
|---|---|---|
| bold, italic, underline, strikethrough, inlineCode | `bold`, `italic`, `underline`, `strikethrough`, `code` | none |
| marker | `color`, `background`, or `highlight` (`src/shared/rich-text/html-to-segments.ts:127-141`) | mode + preset or CSS colour |
| link | `link {href, target?, rel?}` | href |
| equation | embed `{equation: {expression}}` | LaTeX |
| supSub | `sup` or `sub`, mutually exclusive | which |
| clearFormat | removes marks, keeps links (`inline-tool-clear-format.ts:30`) | none |
| convert | none; it is block conversion | — (generic convert) |

All inline-tool effects route to 01's generic rich-text commands. The manifest only says **which marks exist and which blocks allow them**.

---

## 3. Design

### 3.1 Decisions at a glance

These are this spec's own design choices, numbered K1–K8 so they do not clash with 06's user decisions D1–D6.

| # | Decision | Why |
|---|---|---|
| K1 | Data schemas are **JSON Schema draft 2020-12**, limited to a named keyword profile. No Blok-native format. | Blok already publishes one in this format (section 2.2). LLM tool definitions and MCP tools take JSON Schema directly, so 03 and 04 need no translation. A Blok-native format would need a converter to JSON Schema anyway. |
| K2 | Built-in schemas are **hand-written** and **drift-tested**, not derived from TS types. | Deriving needs a TS-to-schema tool, a new devDependency, and `package.json` may not change without a request (`CLAUDE.md`). TS types cannot carry the ranges, enums and descriptions the schema already has (section 2.2). The existing save()-based drift test (section 2.2) is extended to validate values, not just keys. |
| K3 | Each built-in tool's description lives in a **pure module** under `src/shared/tool-descriptions/`. The tool class points a static at it. `blokDocumentSchema` is **assembled** from the same modules. | One source for the editor, the view and Node. The view-entry law forbids tools importing `src/view/` (section 2.3). `src/shared/tool-classes/` is the precedent. |
| K4 | A tool declares itself with two new **optional** statics: `describe(config)` (JSON data only) and `actionHandlers` (code, `ToolActionImpl` per action). Built-in tools also get a code-side `ToolRuntime` (section 3.5). New public statics are additive (approved, 06 D4). | `describe` output must travel as JSON: to Node, to MCP, into an LLM prompt. Handlers and sanitize functions cannot (06 C10). |
| K5 | Declare a tool action **only** when a plain field write is not enough (rule in section 3.4). Everything else is a field write through 01's generic update, checked by the schema. | Keeps the action set small and the coverage law honest. Most UI items are single field writes. |
| K6 | Undeclared tools **degrade to "structural"**: core describes what it already knows; `data` stays open except for `richTextFields`. Adapter blocks get a derived schema from their `propSchema`. | Satisfies S4 with no fabricated schema. |
| K7 | Agent guidance is **English, authored in the description**. Titles come from i18n. | Guidance is model-facing, not user-facing. 71 locales of prompt text would cost translation work and help no model. |
| K8 | The manifest is a **pure function** of a registry snapshot. The browser and Node each feed it their own snapshot. | S5. Node does not load tool classes in v1 (section 2.3; 06 04-Q9). |

### 3.2 The schema profile

A schema in a description may use only these keywords. They are the set `document-schema.ts` already uses (section 2.4), minus `$ref` and `$defs`, plus `default` and `examples`:

`type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `items`, `oneOf`, `anyOf`, `allOf`, `if`, `then`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `deprecated`, `description`, `default`, `examples`.

`$ref` and `$defs` are **not** in the per-tool profile. Every tool schema is self-contained, with rich text inlined. Reasons:

- Today `richText(description)` is inlined per field, each with its own `description` (`document-schema.ts:47-80`). A `$ref` would change the published JSON and break S6.
- `document-schema.test.ts:276` requires exactly one `$defs` entry per built-in block tool. A shared rich-text def would fail it.
- A self-contained schema can be pasted into one LLM tool definition with no resolver.

`$ref` stays only in the envelope's per-type routing inside `blokDocumentSchema` (`document-schema.ts:149-173`), which this spec does not change.

Why a profile:

- Blok needs a validator (01 validates args and data). There is no schema library, and adding one is a `package.json` change. A small in-house validator for a closed keyword set is feasible. A law test rejects any keyword outside the profile, so the validator never silently ignores one.
- The rich-text helpers (`RICH_TEXT_MARKS` and `richText(description)`, `document-schema.ts:22-80`) move to `src/shared/tool-descriptions/rich-text.ts`. Each tool module calls `richText(...)` and inlines the result, exactly as today.

The validator lives at `src/shared/schema/validate.ts`. It is pure and returns a list of `{ path, message }` problems. 01 owns when it runs; this spec provides it.

### 3.3 Where descriptions live

Paths follow 06 §3.8.

```
src/shared/tool-descriptions/
  rich-text.ts        RICH_TEXT_MARKS, richText(description) (moved from document-schema.ts)
  sanitize/           each built-in tool's own sanitize rules, moved out of the tool class (06 C10)
  paragraph.ts        describeParagraph(config) -> BlockToolDescription
  header.ts           describeHeader(config)
  ...                 one module per built-in block tool
  inline.ts           descriptions of the built-in inline tools
  index.ts            BUILT_IN_BLOCK_DESCRIPTIONS: Record<registryKey, describeFn>
src/shared/tool-actions/
  table.ts            ToolActionImpl per table action, plus normalizeTable (pure)
  database.ts         ...
  columns.ts          column_list actions + the shared emptied-column cleanup helper (06 01-Q7)
  index.ts            BUILT_IN_ACTION_HANDLERS, BUILT_IN_TOOL_RUNTIMES
src/shared/tool-manifest.ts   buildToolManifest(snapshot, overrides?), buildAgentContract(manifest, COMMANDS, where)
src/shared/schema/validate.ts validateAgainst(schema, value)
```

Rules for these modules, the same two that bind `src/shared/tool-classes/` (`index.ts:1-20`):

1. **Pure.** No DOM, no `window` at load, no import from `src/components/` or `src/tools/`.
2. **Enumerable.** `BUILT_IN_BLOCK_DESCRIPTIONS` has one entry per built-in tool. A law test checks it against the same list the schema test uses (`document-schema.test.ts:63`).

Then:

- `src/tools/header/index.ts` gets `static describe = describeHeader` and `static actionHandlers = HEADER_ACTIONS` (if any).
- `src/view/document-schema.ts` builds each `$defs` entry by calling `describeX({}).data`. Its JSON output must stay **byte-identical** (S6). A snapshot test is taken **before** the refactor and kept.
- `src/view/server-runtime.ts` gets a `manifest` operation, beside today's `schema` op (`src/view/server-runtime.ts:466-467`) and 01's `agentExecute` (06 D1, §7.2). Shape, from 06 §7.2:

  ```ts
  // blokServerInvoke('manifest', JSON.stringify(input)) → JSON.stringify(output)
  input:  { customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides }
  output: { manifest: BlokToolManifest; contract: AgentContract }
  ```

  It builds a snapshot from `BUILT_IN_BLOCK_DESCRIPTIONS` plus `customTools`, with `services: []`. So every action with a `prepare` step or a `requires` service is `available: false`, and custom tools are JSON descriptions with no handlers (06 §7.2). The bundle's single entry is `server-runtime.ts` (`scripts/build-server-runtime.mjs:67`), so everything in `src/shared/tool-descriptions/`, `src/shared/tool-actions/` and `src/shared/tool-manifest.ts` lands in it.
- Node builds the same snapshot from the same modules (06 04-Q9). Custom tools come from a `BlokCustomToolsFile` (section 4).

**Sanitize rules move to `src/shared/` (06 C10 open blocker).** Node needs each built-in tool's sanitize rules without loading tool classes. Today they are statics on the classes, e.g. `src/tools/paragraph/index.ts:484`, `src/tools/header/index.ts:754`. Plan:

1. The move is required. The Jint bundle carries `BUILT_IN_TOOL_RUNTIMES` and loads no tool class (06 §7.1). Whether the classes would import cleanly in Node no longer matters.
2. Move only each tool's **own** rules into `src/shared/tool-descriptions/sanitize/` (06 R2-02-1). The class `sanitize` getter returns the shared value.
3. Move `INLINE_TEXT_SANITIZE` and `BLOCK_COLOR_SANITIZE` into `src/shared/` (06 R2-02-2). `INLINE_TEXT_SANITIZE` lives in `src/components/shared/inline-content-sanitize.ts` and imports only a type and two `src/shared/` modules (`:11-13`). `BLOCK_COLOR_SANITIZE` lives in `src/components/shared/block-color.ts:33`, a file that also imports the color picker and icons (`:14-15`). Only the constant moves; the picker stays. Both old files re-export the constants, so existing imports keep working. `BLOCK_COLOR_SANITIZE` is also used by header, toggle, table-of-contents and the toolbox (grep of `src/`).

**Effective sanitize config is per registry, not per tool.** In the editor, a tool's field rules are merged with the sanitize configs of its enabled inline tools and tunes (`src/components/tools/block.ts:562-617`). The global `sanitizer` config is applied on top (`src/components/modules/api/blocks.ts:980-988`). So `ToolRuntime.sanitize` (section 3.5) is built by `buildToolRuntimes(config)` from the tool's own rules plus the enabled inline tools' rules, the same way (06 R2-02-1). 01 builds the registry lazily per batch, cached on `AgentContract.revision` (06 R2-02-1). Function rules travel by reference in-process; no JSON form is needed in v1 (06 01-Q6). The headless sanitizer already runs function rules against an Element facade (`src/view/sanitize.ts:341-345`, `:410-412`).

Action handlers that need logic now inside `src/tools/` (TableModel, DatabaseModel, crop math, markup model, embed registry) need that logic in `src/shared/`. Each move is a refactor with its own tests. Whether each candidate is already DOM-free is **unverified** and is checked per move during implementation.

### 3.4 When a tool action is declared

Declare a tool action when **any** of these hold. Otherwise the human gesture is a field write, and the inventory row says "field".

1. **It changes child blocks together with the tool's data.** Table rows (cells are child blocks), tabs, columns, database rows.
2. **It keeps an invariant across fields or blocks** that a raw write would break. Merging cells, rotating an image (crop and markup turn with it), deleting a board column (its rows go too).
3. **It needs a host service.** Upload, link metadata, page backend.
4. **It creates a block whose children are machinery.** A table needs one cell block per cell. A column list needs columns. These are **create actions**: they run with no target block. They take `parentId?` and `position?` and return `{ id, childIds }` (06 §3.1).
5. **It edits one element of an id-keyed array** in the data: database `views` and select `options`, image `markup`. A whole-array replace through a field write races in collab (two agents or a human and an agent each rewrite the array, and one loses) and can drop or re-mint ids. The action names the element by id.

A write of one scalar or one plain object is a field write even when the UI shows it as a menu (`activeViewId`, `level`, `colWidths`).

Field writes still get safety. 01 validates the new data against the tool's schema, so a bad enum or an out-of-range number fails loudly instead of corrupting the block.

This rule is also the coverage test (06 C4). Spec 05's ledger takes a field write as `{ field: '<registryKey>.<field>' }`. 05's law checks that the field is in the tool's manifest `data` schema and not in `viewState` or `guardedFields`. `{ command: 'block.update' }` is not a valid ledger entry. Every UI item this spec routes to `<registryKey>.<action>` must map to that action (06 05-Q8).

### 3.5 The declaration API

A tool adds two optional statics. Both are new, so nothing breaks (approved with a release note, 06 D4).

JSON side, published:

```ts
// types/tools/tool-description.d.ts (new, hand-authored; no src/ imports)

/** A JSON Schema object restricted to the Blok schema profile. */
export type BlokSchema = { readonly [keyword: string]: unknown };

/** Something only the host can provide. An action that needs it fails without it. */
export type HostService = 'uploader' | 'linkMetadata' | 'pageBackend' | 'host';
// 'host': a custom tool's prepareInsert; Blok cannot tell what it needs.

// Canonical (06 §3.4).
export interface ToolActionDeclaration {
  name: string;                       // camelCase; command = `${registryKey}.${name}`
  summary: string; guidance?: string;
  args: BlokSchema; result?: BlokSchema;
  target: 'block' | 'create';
  runtime?: 'any' | 'editor';         // default 'any'
  preconditions?: string[];
  requires?: HostService[]; uses?: HostService[];
  mirrors?: string[];                 // 05 capability ids, e.g. 'menu:table/insert-row-above'
  effects?: 'host';                   // 06 R2-02-3: prepare changes the world outside this document
}
```

Field notes for `ToolActionDeclaration`:

- `args` is the schema of the action's **own** args. It may **not** declare `id`, `parentId` or `position`. Core adds them by `target` (06 §3.1): `target: 'block'` gets `id`; `target: 'create'` gets `parentId?` and `position?`. The law test enforces this (section 6).
- `runtime: 'editor'` means the action runs only in the browser editor. Headless, `buildAgentContract` lists it with `available: false` (`reason: 'runtime'`), and every renderer lists only available commands (06 R3-1). **No built-in action is `'editor'`**: `page.rename` / `page.setIcon` are `runtime: 'any'` and gated by the `pageBackend` service (section 3.8; 06 R3-2). The field stays for host tools.
- `effects: 'host'` means the action's `prepare` changes something outside this document. Such an action must be the **only** command in its batch, else 01 returns `INVALID_ARGS` (06 R2-02-3). Then nothing can fail after the host call. Built-ins with it: `page.rename`, `page.setIcon`.
- `preconditions` is plain text for the model. The handler enforces them with `ctx.fail`.
- `requires`: a missing service marks the action `available: false`; calling it returns `COMMAND_UNAVAILABLE` with `details.reason: 'service'` (06 R3-1). `uses`: used when present, works without, in every runtime including Jint (06 R3-3).
- `mirrors` lists spec 05 **capability ids**, not i18n keys (06 05-Q7). A capability id listed in some action's `mirrors` needs no separate ledger row in 05. Order (06 R2-05-4): 05 first names every unnamed menu item; only then does this spec fill `mirrors`. Until an item is named, its action leaves it out of `mirrors`.

```ts
export interface BlockToolDescription {
  /** One line: what this block is for. */
  summary: string;
  /** When to use it, when not to, traps. English. */
  guidance?: string;
  /** JSON Schema (profile) of `data`. Narrowed by the tool config passed to describe(). */
  data: BlokSchema;
  /** Starting data for a new block when the agent gives none. */
  defaultData?: Record<string, unknown>;
  /** Short realistic examples of valid `data`, for prompts. */
  examples?: Array<Record<string, unknown>>;
  /** Scalar fields shown in the outline view (06 §3.4, 01-Q8). */
  summaryFields?: string[];
  /**
   * Stable raw input slots for top-level plain/rich-text fields (06 §10.2).
   * [] disables inference. Absent: one rich field supplies candidate input 0.
   * Consumers must validate the live binding or use a block marker.
   */
  inputFields?: string[];
  /** Fields that are view-state and must never be written by an agent. */
  viewState?: string[];
  /**
   * Fields a plain field write may not change, because a command keeps an
   * invariant around them. Maps the field to the command to use instead.
   * The value is returned as FIELD_NOT_WRITABLE.details.use.
   * Example: header { isToggleable: 'block.convert' }, table { content: 'table.*' }.
   */
  guardedFields?: Record<string, string>;
  actions?: ToolActionDeclaration[];
}

export interface InlineToolDescription {
  summary: string;
  /** The rich-text effect. */
  effect:
    | { mark: string; value: BlokSchema }          // e.g. { mark: 'bold', value: { const: true } }
    | { marks: string[]; value: BlokSchema }       // marker: color | background | highlight
    | { embed: string; value: BlokSchema }         // equation
    | { clears: 'marks' };                         // clearFormat
}

export interface BlockTuneDescription {
  summary: string;
  /** Schema of this tune's entry in a block's `tunes`, or null when it saves nothing. */
  data: BlokSchema | null;
}
```

Statics, added to the existing constructable types:

```ts
// types/tools/block-tool.d.ts, on BlockToolConstructable
describe?(config: ToolConfig): BlockToolDescription;
actionHandlers?: { readonly [actionName: string]: ToolActionImpl };

// types/tools/inline-tool.d.ts, on InlineToolConstructable
describe?(config: ToolConfig): InlineToolDescription;

// types/block-tunes/block-tune.d.ts, on BlockTuneConstructable
describe?(config: ToolConfig): BlockTuneDescription;
```

`describe` rules:

- **Pure and synchronous.** No DOM, no network. It may read `config`.
- **Config narrows, never widens.** Header with `levels: [1, 2]` returns `level: { enum: [1, 2] }`. List with `styles` narrows `style`. Image `filters` narrows `filter`. Called with `{}` it returns the widest schema, which is what `blokDocumentSchema` uses.
- **Output is JSON.** Core checks `JSON.parse(JSON.stringify(x))` deep-equals `x` in a dev-only assertion and in the law test.

Code side. Canonical (06 §3.4). `InsertSpec`, `RichText`, `RichTextHelpers` and `BlockPosition` are 01's (01 §5.1; `BlockPosition` is `types/api/blocks.d.ts:33`).

```ts
/** Code side. Never serialized in v1. */
interface ToolRuntime {
  name: string;
  sanitize: SanitizerConfig;          // function rules by reference
  normalize?(data: Record<string, unknown>): Record<string, unknown>;   // pure
  defaultChildren?: InsertSpec[];
  actions: Record<string, ToolActionImpl>;
}

interface ToolActionImpl<Args = unknown, Prepared = unknown, Result = unknown> {
  /** Optional async host work, run before planning. Nothing is written. */
  prepare?(ctx: { services: Partial<Record<HostService, unknown>> }, args: Args): Promise<Prepared>;
  /** Synchronous. Writes are recorded as Edit[]; reads see earlier writes. */
  run(ctx: ToolActionContext, args: Args, prepared: Prepared | undefined): Result;
}

interface ToolActionContext {
  block?: { id: string; type: string; data: Readonly<Record<string, unknown>>; children: readonly string[] };
  read(id: string): { id: string; type: string; data: unknown; parentId: string | null; children: readonly string[] } | null;
  insert(input: { type: string; data?: Record<string, unknown>; parentId?: string | null; position?: BlockPosition; children?: InsertSpec[] }): string;
  update(id: string, patch: Record<string, unknown>): void;
  setRichText(id: string, field: string, value: RichText): void;
  move(id: string, to: { parentId?: string | null; position: BlockPosition }): void;
  remove(id: string, opts?: { withChildren?: boolean }): void;
  newId(): string;
  richText: RichTextHelpers;
  fail(code: 'PRECONDITION_FAILED' | 'INVALID_ARGS', message: string): never;
}

type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>;   // keyed by registry key
```

`ToolActionImpl` and `ToolActionContext` are published in `types/tools/tool-description.d.ts`, since `actionHandlers` names them. They import `InsertSpec` and `RichTextHelpers` from 01's `types/agent.d.ts`, where both are published (06 R2-02-5, D4), `RichText` from `types/rich-text.d.ts`, and `BlockPosition` from `types/api/blocks.d.ts`. `ToolRuntime` and `ToolRuntimeRegistry` are internal.

What each `ToolRuntime` field is for:

- `sanitize`: the effective rules for this tool under the current config (section 3.3). 01's planner sanitizes every recorded write with it.
- `normalize`: fills data the tool would otherwise fill on load, e.g. table column and row ids (`types/tools/table.d.ts:12-14`, per 06 C17). A browser never writes normalised data back for a peer's block (06 C17). So a headless author must write complete data. **`normalize` for table is a v1 blocker for live mode** (06 C17, 01-Q11). Until each tool has it, 01's parity tests ignore a listed set of tool-minted fields.
- `defaultChildren`: the children a container seeds when the agent gives none (06 01-Q4). Built-in containers that need it: `column_list`, toggle heading, `tabs`, `table`. Explicit `children` in the insert suppress seeding. 01's parity tests pin that.
- `actions`: the handlers. Same keys as the declared `actions`.

How 01 runs an action (06 C6, 02-Q2, 02-Q3):

1. Find the block, check its type has this action, validate `args` against the declaration. A missing action is `UNKNOWN_COMMAND` with `details.tool`.
2. Fail early with `COMMAND_UNAVAILABLE` when a `requires` service is missing.
3. Run `prepare`, if any, before planning. It may call host services. It writes nothing.
4. Run `run` synchronously. The ctx records `Edit[]` into the plan and keeps an overlay, so later reads see earlier writes.
5. Every recorded edit goes through 01's rules: placement, sanitize, validation, undo, attribution.
6. After planning, 01 validates the keys the batch wrote, and the whole `data` of every inserted block, against the tool's schema. It does not re-validate untouched legacy keys (06 02-Q3). A failure aborts the batch with `DATA_REJECTED`. This is the runtime drift guard for actions.

The handler returns its result (e.g. `{ rowIds }`). A create action returns `{ id, childIds, ... }` (06 §3.1).

**Custom tool actions are editor-only in v1** (06 01-Q5; D6: cut, user can revisit). A host's `actionHandlers` run in the browser. Node (MCP) and Jint load custom tools as a `BlokCustomToolsFile` of JSON descriptions only: structural facts and field writes (06 §7.2). Actions declared in that file have no handler there, so they are listed with `available: false`.

### 3.6 The manifest

`buildToolManifest(snapshot, overrides?)` is pure. Core supplies the snapshot. The manifest is the model-facing JSON half of 06 C10; the code half is `ToolRuntime` (section 3.5).

```ts
// types/tool-manifest.d.ts (new, hand-authored)
export interface BlokToolManifest {
  /** Bumped only on a breaking change to this shape. */
  formatVersion: 1;
  blokVersion: string;
  /** Hash of the content. Changes when tools, config or settings change. 03/04 cache on it. */
  revision: string;
  readOnly: boolean;
  defaultBlock: string;
  blocks: BlockToolManifestEntry[];
  inlineTools: InlineToolManifestEntry[];
  tunes: TuneManifestEntry[];
}

export interface BlockToolManifestEntry {
  /** Registry key. This is the `type` a block carries. */
  name: string;
  /** Localized title (toolbox title / toolNames.*). For talking to the user. */
  title: string;
  summary: string;
  guidance?: string;
  /** 'described': declared via describe(). 'structural': core's facts only. */
  level: 'described' | 'structural';
  /** False when the host hid it (toolbox: false). Existing blocks still edit. */
  insertable: boolean;
  /** Toolbox entries an agent can insert directly, e.g. numbered list, heading 2. */
  variants: Array<{ name: string; title: string; data: Record<string, unknown> }>;
  data: BlokSchema;
  defaultData?: Record<string, unknown>;
  examples?: Array<Record<string, unknown>>;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: {
    accepts: boolean;              // acceptsChildren
    allow?: string[];              // childTools.allow
    deny?: string[];               // childTools.deny
    ownedByTool: boolean;          // ownsChildren: do not nest user blocks here
    layout: boolean;               // isLayout
    deletedWithParent: boolean;    // deletesChildren
  };
  /** This tool places its children itself (per cell / per view). From SELF_PLACING_PARENTS. */
  selfPlacesChildren: boolean;
  /** This tool may not be placed inside a table cell. From isRestrictedInTableCell. */
  restrictedInTableCell: boolean;
  /** Scalar fields shown in the outline view. From describe().summaryFields. */
  summaryFields?: string[];
  /** Data field per DOM input, for drawing an agent caret (06 §10.2). From describe().inputFields. */
  inputFields?: string[];
  /** Tools this block can be turned into, from both sides' conversionConfig. */
  convertsTo: string[];
  /** Which data field carries the text on conversion. Absent when that side is a function or missing. */
  conversion: { import?: string; export?: string };
  assetKind?: 'image' | 'video' | 'audio' | 'file';
  /** Insertion needs the host (prepareInsert present). */
  insertRequires?: HostService[];
  /** Inline tools enabled in this block's rich text: names from inlineTools. */
  inlineTools: string[];
  tunes: string[];
  actions: Array<ToolActionDeclaration & { command: string; available: boolean }>;
  /** Set when the registry key is a reserved namespace, so no action is exposed (06 C5). */
  actionsWithheld?: 'reserved-namespace';
}

export interface InlineToolManifestEntry {
  name: string;
  title: string;
  summary: string;
  level: 'described' | 'structural';
  effect: InlineToolDescription['effect'] | { mark: string; value: BlokSchema }; // structural: tag:<name>
  shortcut?: string;
}

export interface TuneManifestEntry {
  name: string;
  summary: string;
  level: 'described' | 'structural';
  /** null: saves nothing. Open object for an undeclared tune. */
  data: BlokSchema | null;
}
```

How each field is filled:

| Field | Source |
|---|---|
| `name`, `insertable` | registry key; `toolbox` setting `false` (`types/api/tools.d.ts:40-44`) |
| `title` | toolbox entry title through i18n (`types/tools/tool-settings.d.ts:27-48`) |
| `summary` | `describe().summary`, else the `toolbox.preview.*` English caption of the first entry (`types/message-keys.d.ts:207-236`), else `"Custom block <name>"` |
| `variants` | toolbox entries with their `data` (`block.ts:379`) |
| `data` | `describe(config).data`, self-contained; else the structural schema (section 3.7) |
| `richTextFields` | `block.ts:555` |
| `children.*` | `block.ts:132-157, 271-289` |
| `selfPlacesChildren` | `SELF_PLACING_PARENTS.has(name)` (`src/tools/nested-blocks.ts:110`). That set is keyed by the names `table` and `database`, so a host that registers the table under another key gets `false` (06 B7, impact unverified). The manifest mirrors core's behaviour; it does not fix it. |
| `restrictedInTableCell` | `isRestrictedInTableCell(name)` (`src/tools/table/table-restrictions.ts:100-102`). Defaults are `header`, `table`, `column_list`, `tabs` (`:9`), plus config additions. |
| `summaryFields` | `describe().summaryFields`; absent for structural entries |
| `conversion` | `conversionConfig.import` / `.export` when the value is a string (a data key). A function value leaves that side absent (`types/configs/conversion-config.ts:15`, `:24`). |
| `convertsTo` | computed the way the convert menu does today. **Unverified:** the exact helper; the convert menu builder is noted in memory as shared but not re-read this session |
| `insertRequires` | `prepareInsert` present (`block.ts:200`) → `['pageBackend']` for page; a custom tool's `prepareInsert` reads as `['host']` |
| `inlineTools` | `enabledInlineTools` (`block.ts:508`) resolved to names. Meaning: these inline tools are **enabled** for this block. It does **not** mean "the only marks that survive" (06 02-Q13). The base sanitize config is built from the enabled inline tools only (`src/components/modules/tools.ts:528-570`, `src/components/tools/block.ts:605-617`). But the tool's own field rule and the global `sanitizer` config can allow more tags (`block.ts:562-597`, `src/components/modules/api/blocks.ts:980-988`). Guidance text says so. |
| `tunes` | `enabledBlockTunes` (`block.ts:522`) |
| `actions[].command` | `<registryKey>.<name>` (06 C5). A host that registers Header as `heading` gets `heading.*`. Names are stable strings and valid enum members (06 03-Q8). A registry key in `RESERVED_NAMESPACES` (`doc`, `block`, `text`, `markdown`, `history`) gets `actions: []` and `actionsWithheld: 'reserved-namespace'`. |
| `actions[].available` | computed by `buildAgentContract` for the runner (06 R3-1): false when a `requires` service is missing, when `runtime: 'editor'` runs headless, in read-only mode, or for any action with no handler (custom tools outside the browser). A `prepare` step alone never makes an action unavailable, in Jint either (06 R3-3). `page.rename` / `page.setIcon` follow section 3.8. |
| `inputFields` | `describe().inputFields`; absent for structural entries (the default rule in section 3.5 then applies) |

Live changes. The manifest is computed on demand and is cheap. `api.tools.update()` and `setInlineToolbar()` (`types/api/tools.d.ts:50, 62`) change `config`, `insertable` and `inlineTools`; the next build reflects them and `revision` changes. How 03 surfaces a change (event or poll) is 03's call.

Host overrides. A host may want to hide a tool or an action from agents, or add guidance. `buildToolManifest` takes an optional `ManifestOverrides`. Canonical (06 §3.6):

```ts
type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;
```

Where the host passes it (06 02-Q10): in the browser, a new optional `BlokConfig.agent.overrides` (03; additive, approved in 06 D4). In MCP, an `overrides` option and `--manifest-overrides <file>` (04). In Jint, the `manifest` and `agentExecute` ops take `overrides` (06 §7.2). A hidden action is absent from the contract, so calling it is `UNKNOWN_COMMAND` (06 R2-03-7). I deliberately do **not** add an `agent` key to **tool** settings: flat tool settings pass unknown keys to the tool as config (`types/tools/tool-settings.d.ts:193-231`), so a new reserved key would steal `agent` from any custom tool config that uses it. That would be breaking.

### 3.6a The agent contract and guidance

Models need one list of every command, core and tool alike. `buildAgentContract` merges 01's `COMMANDS` with every tool's actions (06 C10, 03-Q9). 03, 04 and 05 consume the contract, not the manifest alone. Canonical (06 §3.6):

```ts
interface CommandEntry {
  name: CommandName;
  summary: string; guidance?: string;
  args: BlokSchema; result?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  source: 'core' | { tool: string; target: 'block' | 'create' };
  requires?: HostService[];
  effects?: 'host';
  available: boolean;                // false → COMMAND_UNAVAILABLE (06 R3-1)
  unavailableReason?: 'runtime' | 'service';
}

interface AgentGuidance { general: string; commands: Record<string, string>; tools: Record<string, string> }

interface AgentContract {
  formatVersion: 1;
  revision: string;                 // hash; changes with tools, config, overrides
  commands: CommandEntry[];         // 01 COMMANDS + every tool action, sorted by name
  manifest: BlokToolManifest;       // 02, with the C10 additions
  guidance: AgentGuidance;
}

function buildToolManifest(snapshot: ToolRegistrySnapshot, overrides?: ManifestOverrides): BlokToolManifest;
function buildAgentContract(manifest: BlokToolManifest, core: typeof COMMANDS,
  where: { runtime: 'editor' | 'node' | 'jint' | 'node-live' | 'csharp-live'; services: HostService[] }): AgentContract;
// `available` is computed here, once, for every surface (06 R3-1, R3-2).
```

How `buildAgentContract` turns a tool action into a `CommandEntry`:

- `name` = `actions[].command`. `source` = `{ tool: <registryKey>, target }`. `runtime` = the declaration's, default `'any'`.
- `args` = the declaration's `args` plus the target fields from 06 §3.1. `target: 'block'` adds required `id`. `target: 'create'` adds optional `parentId` and `position`.
- `readOnly` = `false` for every tool action. `available` = the manifest's `available`.
- A hidden tool or action (overrides) is left out. A tool in a reserved namespace adds nothing.
- The tool action and a core command can never share a name, because core names start with a reserved namespace.

`AgentGuidance` is filled from text this spec owns:

- `tools[<registryKey>]` = the entry's `guidance`, then the override's `guidance`.
- `commands[<command>]` = the action's `guidance`, then its `preconditions` as a list.
- `general` is 01's and 03's text. The anti-Markdown rule lives there: rich fields take segments, never Markdown; use `markdown.insert` for Markdown.

Provider adaptation is **not** done here. The shared renderer `renderAgentTools` (06 §3.7) owns it. This spec adds no `flattenForProvider` helper (06 02-Q9). Which schema keywords providers reject is unverified; 03's law test checks the rendered output.

### 3.7 How undeclared tools degrade

| What the agent faces | Level | Data schema | What it can do |
|---|---|---|---|
| Built-in tool | described | full | everything |
| Custom tool with `describe` | described | the tool's own | everything it declares |
| React/Vue block without `describe` | structural+ | derived from `propSchema` (below) | generic CRUD |
| Any other custom tool | structural | `{ type: 'object', additionalProperties: true, properties: { <each richTextField>: richText } }` | generic CRUD; rich-text fields are typed |
| Block type in a document with no registered tool (renders as `Stub`, `src/tools/stub/index.ts:15`) | not in the manifest | — | 01's document view marks it `opaque: true`; only `block.move` and `block.delete` accept it; data never written (06 §3.3) |

Structural entries still carry everything in section 3.6 that core knows: title, variants with seed data, children rules, conversion, rich-text fields. `richTextFields` alone tells the model which fields take segments, which is the anti-Markdown fix even with no schema.

Derived schema for adapter blocks. React and Vue `createXBlock` already require `propSchema` (section 2.4). When the author did not pass `statics.describe`, the factory sets one:

- every `propSchema` key becomes a property;
- `type` comes from `typeof default` (`string`, `number`, `boolean`; arrays and objects stay open);
- `values` becomes `enum`;
- `additionalProperties: false`, because `propSchema` keys are exactly the `save()` keys (`src/shared/prop-schema.ts:11-15`).

A pure `describeFromPropSchema(propSchema, richTextFields)` in `src/shared/prop-schema.ts` does this, so all adapters share it. Angular has no `propSchema` that I found (**unverified**); its blocks stay structural unless the author declares `describe`.

A custom inline tool with no `describe` gets `effect: { mark: 'tag:<tag>' }`, where `<tag>` is the single tag in its sanitize config. Any other tag becomes `tag:<name>` on parse (`html-to-segments.ts:176`). Reading the tag from the sanitize config is a **hypothesis** to check at implementation; with zero or several tags the entry has no effect and the model is told to leave it alone.

A custom tune with no `describe` gets `data: { type: 'object', additionalProperties: true }` if the instance has `save()`. It cannot be known statically whether it has one without constructing it, so the entry says "unknown" through `level: 'structural'`.

### 3.8 Built-in declared actions (v1)

Derived from section 2.6 by the rule in 3.4. Names follow 06 C5: `<registryKey>.<action>`, flat args. Args are sketched; exact schemas are written with the code, test-first. The sketches leave out the core-added `id` (block target) and `parentId` / `position` (create target). No sketch declares those names itself.

The **Prepare** column marks actions with an async `prepare` step (06 C6). All other actions are a synchronous `run` only.

| Command | Target | Args (sketch) | Requires / uses | Prepare | Reuses |
|---|---|---|---|---|---|
| `table.create` | create | `{ rows, cols, withHeadings?, cells?: richText[][] }` | — | — | `normalizeTableData` |
| `table.insertRows` / `insertColumns` | block | `{ at, count?, cells? }` | — | — | TM `addRow`, `addColumn`, width plan |
| `table.deleteRows` / `deleteColumns` | block | `{ at, count }` (must leave one) | — | — | TM `deleteRow`, `deleteColumn` |
| `table.moveRow` / `moveColumn` | block | `{ from, to }` | — | — | TM `moveRow`, `moveColumn`, `canMove*` |
| `table.duplicateRows` / `duplicateColumns` | block | `{ at, count }` | — | — | new pure helper |
| `table.clearCells` | block | `{ range }` | — | — | new pure helper |
| `table.styleCells` | block | `{ range, color?, textColor?, placement? }` (`null` clears) | — | — | TM `setCell*` |
| `table.mergeCells` / `splitCell` | block | `{ range }` / `{ row, col }` | — | — | TM `canMergeCells`, `mergeCells`, `splitCell` |
| `table.fillCells` | block | `{ range, direction: 'right' \| 'down' }` | — | — | TM `setCellBlocks` |
| `column_list.create` | create | `{ count } \| { from: blockIds[] }`, plus `widths?` | — | — | column-drop logic |
| `column_list.addColumn` / `removeColumn` | block | `{ at, from?: blockIds[] }` / `{ index }` | — | — | shared emptied-column helper (06 01-Q7) |
| `column_list.setWidths` | block | `{ ratios: number[] }` | — | — | — |
| `tabs.create` | create | `{ tabs: [{ title, icon? }] }` | — | — | — |
| `tabs.addTab` / `deleteTab` | block | `{ title, icon?, at? }` / `{ tabId }` | — | — | `addTab`, `deleteTab` logic |
| `database.create` | create | `{ variant, properties?, rows? }` | — | — | DM |
| `database.addView` | block | `{ type, name?, groupBy? }` | — | — | DM `addView` |
| `database.renameView` / `duplicateView` / `deleteView` / `moveView` | block | `{ viewId, name }` / `{ viewId }` / `{ viewId }` / `{ viewId, before? \| after? }` | — | — | DM `updateView`, `deleteView`, `positionBetween` |
| `database.addProperty` | block | `{ name, type, options? }` | — | — | DM `addProperty` |
| `database.addOption` / `renameOption` / `moveOption` / `deleteOption` | block | `{ propertyId, ... }`; delete takes `rows: 'delete' \| 'keep'` | — | — | DM `updateProperty` |
| `database.addRow` / `moveRow` / `setRowValues` | block | `{ values?, group?, before?/after? }`; `moveRow` / `setRowValues` name the row as `rowId` | — | — | DM `createRowData`, `positionBetween` |
| `image.setSource` / `video.setSource` / `audio.setSource` / `file.setSource` | block | `{ url }` | uses `uploader` (without it the URL is stored as given) | yes: re-host through `uploader` | tool uploaders |
| `audio.setCover` | block | `{ url }` | uses `uploader` | yes: re-host through `uploader` | `cover-picker.ts` |
| `image.crop` | block | `{ rect, shape? }` | — | — | `crop-math.ts` |
| `image.rotate` / `flip` / `straighten` | block | `{ turns }` / `{}` / `{ degrees }` | — | — | `geometry.ts`, `turnMarkupLeft`, `flipMarkup` |
| `image.addMarkup` / `updateMarkup` / `removeMarkup` | block | items / `{ markupId, ...patch }` / `{ markupIds } \| { all: true }` | — | — | `markup/model.ts` (`readMarkup` mints ids) |
| `embed.setUrl` | block | `{ url }` | — | — | `matchEmbedService`, `buildEmbedUrl` |
| `bookmark.create` | create | `{ url }` | requires `linkMetadata` | yes: fetch metadata | `MetadataFetcher` |
| `page.rename` / `page.setIcon` | block; `effects: 'host'` | `{ title }` / `{ icon }` (`PageIcon`, `types/tools/page.d.ts:13`) | requires `pageBackend` (meaning per runtime below) | yes: the whole effect | host hooks, or cross-document `doc.set*` |

`setSource` and `audio.setCover` are URL-only (06 02-Q6, D6: file uploads cut by the user). No action takes bytes, and no byte path exists. In Jint they are available: `prepare` runs with no `uploader`, so the URL is stored as given (06 R3-3).

**Page title and icon: two different things (06 §10.1, D6: kept in v1).**

- **This document's own title and icon** are core commands `doc.setTitle` / `doc.setIcon` (01, 06 §10.1 A). They are not tool actions.
- **Another page's title and icon** are the page-block actions `page.rename` / `page.setIcon`. The page block holds a `pageId` pointer to its own document. Today the UI calls the host hooks `config.rename(pageId, title)` and `config.setIcon(pageId, icon)` (`src/tools/page/index.ts:432-475`, `:489-521`).

Both page-block actions declare `effects: 'host'` and `requires: ['pageBackend']`. Their whole effect runs in `prepare`, and they must be alone in their batch (06 R2-02-3). What provides `pageBackend` differs by runtime:

- **Browser:** the host hooks. Unchanged.
- **Node (MCP):** a cross-document write. The server opens the target page document with the same source, mode and principal rules as `blok_open`, and runs `doc.setTitle` / `doc.setIcon` there (06 §10.1 B; 01 owns the session hook). Result: `{ pageId, applied: true }`. Opt-in: available only with `pageTitles: 'page-map'`; off by default.
- **C# (Jint path):** `pageBackend` is present only when the host passes an `IBlokPageTarget` and sets `BlokAgentOptions.PageTitles` (06 §10.1 B). C# then passes `services: ['pageBackend']` to the Jint ops. The action itself never runs inside Jint: C# runs it outside the Jint call, since it is alone in its batch (06 R3-2, R3-7; 01 §3.14). Otherwise `available: false`.

One mechanism everywhere (06 R3-2): `runtime: 'any'`, `effects: 'host'`, `requires: ['pageBackend']`; availability comes from whether `pageBackend` is present.

Unverified (06 §10.1 B): whether hosts treat the target document's `page` map as the source of truth for a title. That is why the headless form is opt-in.

Columns and moves (06 01-Q7). Moving an existing block into an existing column is core `block.move`. Creating columns and a side drop are `column_list.*` actions. Cleanup of an emptied column (unwrap when one column is left, `src/tools/column/index.ts:303-311`) is one pure helper that `block.move` and `column_list.removeColumn` both use.

### 3.9 Error handling

This spec adds no error envelope. Every error is 01's `AgentError` with a code from the one `UPPER_SNAKE` union in 06 §3.2 (06 C7). The codes this spec's parts raise:

| Code | Raised by | When |
|---|---|---|
| `UNKNOWN_COMMAND` | 01 dispatch | the tool declares no such action; `details.tool` names the tool |
| `INVALID_ARGS` | validator, or handler via `ctx.fail` | args fail the declaration's schema; `details` carries the validator's `{ path, message }` list |
| `DATA_REJECTED` | validator | a field write or an action's written keys fail the tool's data schema |
| `PRECONDITION_FAILED` | handler via `ctx.fail` | e.g. delete the last table row |
| `COMMAND_UNAVAILABLE` | 01 dispatch | the command has `available: false`: a `requires` service is missing (`details.reason: 'service'`) or `runtime: 'editor'` runs headless (`'runtime'`) (06 R3-1) |
| `FIELD_NOT_WRITABLE` | 01 `block.update` | the write names a field in `viewState` (`details.reason: 'view-state'`) or `guardedFields` (`details.reason: 'guarded'`); `details.use` names the command to use |
| `INVALID_ARGS` | 01 dispatch | an `effects: 'host'` action shares its batch with another command (06 R2-02-3) |

A `describe` that throws is caught by the manifest builder. The tool falls back to `structural` and a warning goes to the dev log, the same pattern core uses for a throwing `upgradeData` (`types/tools/block-tool.d.ts:444-446`).

`describe` is a common name, and a third-party tool may already have a static `describe` with another meaning. The builder therefore also falls back to `structural`, with a warning, when the output is not a description: not a plain object, no string `summary`, or no object `data`. A tool in the wild with an unrelated `describe` keeps working.

---

## 4. Public surface and breaking changes

New, all optional or additive. The user approved all of it, to ship with a release note listing the new surface (06 D4):

- Types: `types/tools/tool-description.d.ts` (section 3.5: `BlokSchema`, `HostService`, `ToolActionDeclaration`, `ToolActionImpl`, `ToolActionContext`, `BlockToolDescription`, `InlineToolDescription`, `BlockTuneDescription`) and `types/tool-manifest.d.ts` (sections 3.6 and 3.6a). Paths per 06 §3.8. Hand-authored, describing a new API rather than mirroring a `src/` value, so the generate-instead rule does not apply. No `src/` imports (published-types law).
- Statics: `describe` on block tools, inline tools and tunes; `actionHandlers` on block tools.
- Exports: `buildToolManifest` and `validateAgainst` from `@bloklabs/core` (the editor entry), and from `@bloklabs/core/view` for DOM-free use (06 §3.8). No new core subpath. `buildAgentContract`, `ToolRuntime` and `BUILT_IN_TOOL_RUNTIMES` stay internal; 03's renderer and 04 import them from source (06 C13).
- Jint server-runtime operation `manifest` (section 3.3; 06 D1, §7.2), next to `schema`. C# reaches the contract through `IBlokAgentExecutor.GetContractAsync` (06 §7.3, owned by 01 + 04).
- Type `BlokCustomToolsFile` in `types/tool-manifest.d.ts` (06 R2-04-Q17, D4). It is the `--manifest <file>` format for MCP and the `customTools` input of the Jint ops:

  ```ts
  type BlokCustomToolsFile = { formatVersion: 1; blocks: Array<{ name: string; description: BlockToolDescription; statics: ToolRegistrySnapshot['blocks'][number]['statics'];
    /** The tool's own sanitize rules as JSON: object and boolean rules only (06 R3-9). Absent: rich fields get the global inline rules. */
    sanitize?: Record<string, unknown> }> };
  ```

- `blokDocumentSchema` gains an optional top-level `page` property: `{ title?: string; icon?: PageIcon }` (06 §10.1 A). The root has `additionalProperties: false` (`src/view/document-schema.ts:91`), so without it a document carrying `OutputData.page` (01) would fail validation. A document valid today stays valid.
- Every new value exported from `src/view/index.ts` is also declared in `types/view.d.ts`, as `published-types-no-src-refs.test.ts:214-247` requires.
- `src/view/document-schema.ts` loses its "no imports at all" purity banner (`:4-5`). It will import the pure description modules from `src/shared/`, which the view purity contract allows. The banner is rewritten to say "imports only `src/shared/tool-descriptions/`".
- Built-in tools' `sanitize` getters return values moved to `src/shared/tool-descriptions/sanitize/` (section 3.3). The returned config is the same, so this is internal.
- Adapters: `createReactBlock` / `createVueBlock` set a derived `describe` when the author gave none.

**Breaking: none**, under these conditions:

- `blokDocumentSchema` JSON stays byte-identical after it is assembled from the new modules. Pinned by a snapshot taken before the change. The one planned change is the additive `page` property; the snapshot is re-pinned once, in that commit.
- Each moved built-in `sanitize` config stays deep-equal to today's, pinned by a snapshot taken before the move. `block-color.ts` and `inline-content-sanitize.ts` re-export the moved constants (06 R2-02-2).
- No new key is reserved in **tool** settings (section 3.6, host overrides). The new `BlokConfig.agent` key is top-level editor config, owned by 03 (06 02-Q10).
- Adding statics to `BlockToolConstructable` changes the adapter `statics` bag type by addition only (`Omit<BlockToolConstructable, ...>`), so existing adapter code still compiles.
- None of these surfaces shipped before `v1.16.1`, the last tag (06 header).

One behaviour to watch: the derived adapter `describe` makes `additionalProperties: false`. 01 would then **reject** a write with an extra key that the adapter's `fillDefaults` would have silently dropped (`src/shared/prop-schema.ts:23-35`). That only affects agent writes, a new path, so it is not a break for existing consumers.

---

## 5. Interfaces

### 5.1 Interfaces I provide

| To | Interface | Shape |
|---|---|---|
| 01 | Tool data schema per type | `BlockToolManifestEntry.data` (section 3.6); `describe(config).data` |
| 01 | Validator | `validateAgainst(schema: BlokSchema, value: unknown): Array<{ path: string; message: string }>` (pure) |
| 01 | Action declarations | `ToolActionDeclaration` (3.5, canonical) |
| 01 | Tool runtimes | `ToolRuntime`, `ToolActionImpl`, `ToolRuntimeRegistry` (3.5, canonical); `buildToolRuntimes(config)` and `BUILT_IN_TOOL_RUNTIMES`. 01 builds the registry lazily per batch, cached on contract revision (06 R2-02-1) |
| 01 | `normalize`, `defaultChildren` | on `ToolRuntime` (3.5). Table `normalize` is a v1 blocker for live mode (06 C17) |
| 01 | View-state and guarded field lists | `BlockToolManifestEntry.viewState`, `.guardedFields` |
| 01 | Structure facts | `selfPlacesChildren`, `restrictedInTableCell`, `summaryFields`, `conversion` on the manifest entry (3.6) |
| 01 | Error codes | section 3.9 (06 §3.2 union) |
| 03, 04, 05 | The contract | `AgentContract`, `CommandEntry`, `AgentGuidance`, `buildAgentContract` (3.6a, canonical) |
| 03, 04 | The manifest | `BlokToolManifest` (3.6), `buildToolManifest(snapshot, overrides?)`, `ManifestOverrides` |
| 04 | DOM-free manifest in Node | `BUILT_IN_BLOCK_DESCRIPTIONS`, `BUILT_IN_ACTION_HANDLERS`, `BUILT_IN_TOOL_RUNTIMES`. Custom tools come in as a `BlokCustomToolsFile` via `--manifest <file>` (06 02-Q8, R2-04-Q17) |
| 01, C# server | Jint `manifest` op | section 3.3 shape; the same modules in the server-runtime bundle (06 §7.1–7.2) |
| 03, 04 | Field → input map | `inputFields` on the description and manifest entry, for drawing `agentCursor` (06 §10.2) |
| 01 | Host-effect flag | `ToolActionDeclaration.effects` (06 R2-02-3) |
| 05 | Coverage hooks | `ToolActionDeclaration.mirrors` (05 capability ids, 06 05-Q7), kept in the model-facing manifest at `blocks[].actions[].mirrors`. 05's law checks they are still emitted (05 §3.1.2); `{ field: '<registryKey>.<field>' }` checks read `data`, `viewState`, `guardedFields` (06 C4); section 2.6 inventory with routes |
| Tool authors | Declaration API | `describe`, `actionHandlers`, `describeFromPropSchema` |

Registry snapshot, the input to `buildToolManifest`:

```ts
export interface ToolRegistrySnapshot {
  blokVersion: string;
  readOnly: boolean;
  defaultBlock: string;
  services: HostService[];
  blocks: Array<{
    name: string;
    title: string;
    description: BlockToolDescription | null;   // null: no describe()
    statics: {
      toolbox: Array<{ name: string; title: string; data?: Record<string, unknown>; previewCaption?: string }>;
      richTextFields: string[];
      acceptsChildren: boolean; childTools?: { allow?: string[]; deny?: string[] };
      ownsChildren: boolean; isLayout: boolean; deletesChildren: boolean;
      selfPlacesChildren: boolean; restrictedInTableCell: boolean;
      conversion: { import?: string; export?: string };   // string sides only
      assetKind?: string; hasPrepareInsert: boolean;
    };
    insertable: boolean; inlineTools: string[]; tunes: string[];
  }>;
  inlineTools: Array<{ name: string; title: string; description: InlineToolDescription | null; sanitizeTags: string[]; shortcut?: string }>;
  tunes: Array<{ name: string; description: BlockTuneDescription | null }>;
}
```

The browser builds it from the Tools module (`src/components/tools/collection.ts`, `block.ts`). Node and Jint build it from `BUILT_IN_BLOCK_DESCRIPTIONS` with default configs, plus any `BlokCustomToolsFile` (06 04-Q9, §7.2). Jint passes `services: []`.

### 5.2 Interfaces I consume

| From | What | Assumption, now settled by 06 |
|---|---|---|
| 01 | Tool-scoped dispatch | A tool action is a top-level command `<registryKey>.<action>` with flat args. No generic `tool.action` (06 C5, 02-Q1). Reserved namespaces `doc`, `block`, `text`, `markdown`, `history` (06 §3.1). |
| 01 | `ToolActionContext` | The canonical recording ctx in section 3.5. `run` is synchronous; async host work goes in `prepare` (06 C6, 02-Q2). |
| 01 | Core commands | `block.insert`, `block.update` (field write), `block.delete`, `block.move`, `block.convert`, `block.duplicate`, `text.*` (06 §3.1). Field-write routes in section 2.6 rely on them. |
| 01 | Post-write validation | 01 validates the keys a batch wrote and the whole `data` of inserted blocks. Plain writes to `viewState` / `guardedFields` → `FIELD_NOT_WRITABLE` (06 02-Q3). |
| 01 | Sanitizing | Every recorded edit is sanitized with `ToolRuntime.sanitize`: the same rules host data gets in `hostDataForTool` (`src/components/modules/api/blocks.ts:946-962`) (06 §3.4). That function also turns segments into HTML and strips unsafe URLs (`stripUnsafeUrlsDeep`). Those steps are 01's planner's job, not part of `ToolRuntime`. |
| 01 | Live re-render | A data write to a mounted block reaches the tool via `setData` where present, else recompose (`block-mutation.ts:316-320`). Whether recompose keeps database rows attached is unverified; 01 tests it (06 02-Q4). |
| 01 | Read-only guard | 01's executor refuses every write with `READ_ONLY` (06 C18). |
| 01 | Batch rules for host effects | 01 rejects a batch that holds an `effects: 'host'` action beside any other command, with `INVALID_ARGS` (06 R2-02-3). |
| 01 | Published helper types | `InsertSpec` and `RichTextHelpers` are published in `types/agent.d.ts` (06 R2-02-5). `types/tools/tool-description.d.ts` imports them from there. |
| 01 | Cross-document hook | A session hook that opens a target page document for headless `page.rename` / `page.setIcon` (06 §10.1 B, 01 item 14). |
| 01 | Page fields in the saved format | `OutputData.page` (06 §10.1 A). This spec only adds it to `blokDocumentSchema`. |
| 03 | Surface and renderer | 03 exposes the contract on `editor.agent` and renders it with `renderAgentTools` (06 §3.7). |
| 04 | Node snapshot | 04 builds the manifest and contract in Node (06 04-Q9, C1). |

---

## 6. Testing strategy

All TDD: each test is written first and watched failing.

1. **Byte-identical document schema.** Before refactoring `document-schema.ts`, add a test that pins `JSON.stringify(blokDocumentSchema)` to a stored snapshot. It stays green through the refactor. The `page` property lands in its own commit: first a failing test that a document with `page: { title, icon }` validates, then the property, then the snapshot is re-pinned once.
2. **Extend `test/unit/view/document-schema.test.ts`.** Keep the two-way key check (`:409-427`). Add value validation: each tool's maximal `save()` sample and its fresh default data must pass `validateAgainst(describe({}).data, sample)`. This catches a wrong enum or type that the key check misses.
3. **Config narrowing.** Per tool with narrowing config: header `levels: [1, 2]` rejects `level: 3`; list `styles`; image `filters`.
4. **New law `test/unit/architecture/tool-description-law.test.ts`:**
   - every built-in block tool (the list at `document-schema.test.ts:63`), inline tool and tune has `describe`;
   - every `richTextFields` entry is a property whose schema deep-equals `richText(<its description>)` in shape (the segment array branch plus the HTML string branch), and no other property has that shape;
   - every schema uses only profile keywords (section 3.2);
   - `describe` output survives a JSON round trip;
   - every declared action has a handler, and every handler has a declaration; the same for `ToolRuntime.actions` keys;
   - no action `args` schema declares `id`, `parentId` or `position` (06 §3.1);
   - every `runtime: 'editor'` action is listed with a reason (today: none among built-ins);
   - every action with `effects: 'host'` has a `prepare` step (today: `page.rename`, `page.setIcon`);
   - every `guardedFields` value names a real command or a `<tool>.*` family;
   - action names are camelCase and unique per tool;
   - every action is named in at least one test file as `'<tool>.<action>'` (a static scan, like `table-cell-content-law.test.ts`);
   - modules under `src/shared/tool-descriptions/` and `src/shared/tool-actions/` import nothing from `src/components/` or `src/tools/` (static scan, like `view-entry-law.test.ts:59-68`);
   - every `ToolActionImpl.run` returns a non-Promise (a sync check on a fixture call).
5. **Validator unit tests.** One case per profile keyword, pass and fail. A mutation-worthy area: boundaries (`minimum` vs `exclusiveMinimum`) silently corrupt data.
6. **Action parity tests.** For each declared action: run it through 01's planner and each applier (`EditorApplier`, `JsonApplier`, `StoreApplier`, and the Jint and C# room runners; 06 C1, §7.5) on a fixture document. Run the matching UI path in jsdom on the same fixture. Assert the saved documents are equal, ignoring a listed set of tool-minted fields until each tool has `normalize` (06 01-Q11). This is the drift test for actions: it fails when the UI changes behaviour and the action does not. Actions that are `available: false` in a runtime expect that runtime's refusal instead (06 R2-05-1).
7. **Structural degradation.** A custom tool with no `describe` appears as `structural` with its rich-text fields typed and open `data`. A React block with a `propSchema` gets the derived schema.
8. **Manifest builder.** Pure unit tests over hand-built snapshots: `toolbox: false` → `insertable: false`; missing `linkMetadata` → `bookmark.create` has `available: false`, while missing `uploader` leaves `setSource` available (it is `uses`); read-only → all actions unavailable; `revision` changes with config; a tool registered under `block` gets `actionsWithheld: 'reserved-namespace'`; `conversion` holds only string sides; `hiddenActions` removes an action.
9. **Contract builder.** `buildAgentContract` lists core and tool commands sorted by name. A tool action's `args` gains `id` (block target) or `parentId` / `position` (create target). Overrides' `guidance` lands in `AgentGuidance.tools`.
10. **Tool runtimes.** Each moved built-in `sanitize` config deep-equals a snapshot of today's class static, taken before the move. The old import paths of `BLOCK_COLOR_SANITIZE` and `INLINE_TEXT_SANITIZE` still resolve to the same values. `buildToolRuntimes(config)` merges enabled inline tools' rules the same way `BlockToolAdapter.sanitizeConfig` does (`block.ts:562-617`). Table `normalize` fills missing column and row ids and is idempotent. Explicit `children` on insert suppress `defaultChildren` (06 01-Q4).
11. **Node build.** Build the default manifest and contract in a plain Node test with no jsdom, from `BUILT_IN_BLOCK_DESCRIPTIONS` and `BUILT_IN_TOOL_RUNTIMES`.
12. **Jint `manifest` op.** Extend `test/unit/scripts/build-server-runtime.test.ts` (06 §7.5) with an `invoke('manifest')` round trip in the globals-free realm. Assert: the output equals the Node build for the same input; every action with `prepare` or `requires` is `available: false`; a `customTools` file adds a structural-plus-description entry whose actions are `available: false`; `overrides.hidden` removes a tool.
13. **Input field order.** Render every built-in through real `Block.inputs`, including contradictory caption/rename/child states, and retain exact raw identity, count and order checks (06 §10.2). Declare only stable own top-level plain/rich-text slots; use `[]` for unsafe inference. Optional trailing Audio/File captions may use a maximal stable prefix. Code's shifting filename, foreign/nondata controls, nested schema/views and host-only page rename use block fallback. Live binding and topology revalidation are separate unmet 03 consumer gates, not proof supplied by these description tests.
14. **Adapters.** Extend the existing `statics` forwarding tests (React `test/unit/react/createReactBlock.test.tsx:1025`, Vue `test/unit/vue/createVueBlock.test.ts:515`, Angular `test/unit/angular/createAngularBlock.test.ts:497`) to cover `describe` and `actionHandlers`.

E2E: one per container family (table, database, columns/tabs) driving actions through 03's in-app surface in a real browser. These belong to 03's test plan; this spec only requires they exist.

---

## 7. Open questions for other specs

### 7.1 Resolved by 06

1. **To 01, command shape.** Resolved (06 C5, 02-Q1): top-level `<registryKey>.<action>`, flat args, no generic `tool.action`.
2. **To 01, `ToolActionContext`.** Resolved (06 C6, 02-Q2): a recording ctx, synchronous `run`, optional async `prepare`. Shape in section 3.5.
3. **To 01, post-write validation and guarded fields.** Resolved (06 02-Q3): yes. Plain writes to `viewState` / `guardedFields` → `FIELD_NOT_WRITABLE`. 01 validates the keys a batch wrote and the whole `data` of inserted blocks, not untouched legacy keys. Built-in guarded fields: header `isToggleable` (`block.convert`), table `content` (`table.*`), database `schema` and `views` (`database.*`), image `markup` (`image.*Markup`).
4. **To 01, database without `setData`.** Resolved (06 02-Q4): recompose path (`block-mutation.ts:316-320`). 01 tests that rows stay attached. Adding `setData` to database is the fallback fix.
5. **To 01 and 03, view-state.** Resolved (06 02-Q5, D6): no view-state control in v1; the user can revisit.
6. **To 03 and 04, file bytes.** Resolved (06 02-Q6, D6): URL only. The user cut file uploads.
7. **To 01 and 04, page rename / icon.** Resolved (06 §10.1, D6, superseding C15): browser keeps the host hooks; headless is an opt-in cross-document `doc.setTitle` / `doc.setIcon`. Both declare `effects: 'host'`. This document's own title and icon are 01's `doc.setTitle` / `doc.setIcon`.
8. **To 04, custom tools headless.** Resolved (06 02-Q8, 01-Q5): JSON descriptions via `--manifest <file>` in v1. The file type is `BlokCustomToolsFile` (06 R2-04-Q17). Custom handlers are editor-only (D6: cut outside the browser, user can revisit).
9. **To 03 and 04, provider keyword limits.** Resolved (06 02-Q9): the shared renderer owns provider adaptation. No `flattenForProvider` here.
10. **To 03 and 04, where overrides go.** Resolved (06 02-Q10, D4): both. `BlokConfig.agent.overrides` in the browser; `overrides` and `--manifest-overrides <file>` in MCP; `overrides` on the Jint ops. A hidden action is `UNKNOWN_COMMAND` (06 R2-03-7).
11. **To 05, coverage unit.** Resolved (06 02-Q11, C4, 05-Q7): yes, with 05's `{ field }` ledger kind. `mirrors` holds 05 capability ids, not i18n keys.
12. **To 05, capabilities with no UI.** Resolved (06 02-Q12): no. The law counts only human-reachable UI. Image `size` / `frame` / `rounded` are field writes already.
13. **To 01, marks of a non-enabled inline tool.** Resolved (06 02-Q13): the base sanitize config comes from enabled inline tools only, but the tool's field rule and the global `sanitizer` can allow more. Per-block `inlineTools` means "enabled", not "only survivors" (section 3.6).

Questions from other specs addressed to 02, answered in this revision: 01-Q4 (`defaultChildren`, section 3.5), 01-Q5 (section 3.5), 01-Q6 (section 3.3), 01-Q7 (section 3.8), 01-Q8 (`summaryFields`), 01-Q11 (`normalize`), 03-Q8, 03-Q9 (section 3.6a), 04-Q9, 04-Q10, 04-Q12, 05-Q7 to 05-Q9. 05's Q15 (does `mirrors` stay in the published manifest?): yes, at `blocks[].actions[].mirrors`.

### 7.2 Round-2 answers to this spec's earlier questions

1. **Host side effect in `prepare` when a batch fails.** Resolved (06 R2-02-3): such actions declare `effects: 'host'` and must be alone in their batch.
2. **When to rebuild `ToolRuntimeRegistry`.** Resolved (06 R2-02-1): lazily per batch, cached on `AgentContract.revision`.
3. **Are `InsertSpec` and `RichTextHelpers` published?** Resolved (06 R2-02-5): yes, in `types/agent.d.ts`.

### 7.3 Still open

None. The former question (C# running page actions outside Jint) is closed by 06 R3-2 and R3-7: yes, C# runs them itself.

---

## 8. Out of scope

- The command envelope, dispatch, batching, undo, collab and the document view (01).
- The `blok.agent` surface, LLM tool generation and adapter parity of that surface (03).
- The MCP server, auth and packaging (04).
- The coverage law itself and evals (05).
- View-state control (06 02-Q5; D6: cut, user can revisit).
- Capabilities with no UI today (06 02-Q12).
- Fixing the two possible bugs the inventory surfaced (embed submit and database view changes without `dispatchChange`). They are reported here, not fixed.
- Translating agent guidance into other locales.
- Custom tool action handlers outside the browser, in Node or Jint (D6: cut, user can revisit).
- Byte upload for `setSource` (D6: cut by the user).
- `doc.setTitle` / `doc.setIcon` and `OutputData.page` themselves (01). This spec only adds `page` to `blokDocumentSchema`.
- `IBlokAgentExecutor` and the C# side of the Jint path (01 + 04, 06 §7.3).
- The renderer and provider adaptation (`renderAgentTools`, 03; 06 §3.7).

---

## Issues with 06

None open (closed in 06 round 3).
