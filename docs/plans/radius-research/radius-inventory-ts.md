# Corner radius inventory — TS/TSX (non-.css)

Scope: src/ + packages/{react,vue,angular,presets,server}/src, *.ts/*.tsx/*.vue/*.html/*.mts, tests/specs excluded, src/components/icons excluded. Adapter packages had ZERO radius usages. px assumes 16px root font (Tailwind radii are rem).

## Tailwind class -> px (Tailwind 4.3.3, no project override of --radius-*)

| class | CSS emitted (from built bundle) | value | px |
|---|---|---|---|
| rounded | border-radius:.25rem (inlined from deprecated `--radius`, `@theme default inline reference`) | 0.25rem | 4 |
| rounded-xs | var(--radius-xs) | 0.125rem | 2 (only used via @apply in main.css, not TS) |
| rounded-sm | var(--radius-sm) | 0.25rem | 4 |
| rounded-md | var(--radius-md) | 0.375rem | 6 |
| rounded-lg | var(--radius-lg) | 0.5rem | 8 |
| rounded-xl | var(--radius-xl) | 0.75rem | 12 |
| rounded-2xl | var(--radius-2xl) | 1rem | 16 (index.html playground only) |
| rounded-full | calc(infinity*1px) -> 2147483647px | - | full |
| rounded-[Npx] | literal | - | N |

Evidence: node_modules/tailwindcss/theme.css:397-404 and :508; node_modules/tailwindcss/dist/lib.js (rounded utility: themeKeys ["--radius"], static full = calc(infinity * 1px)); src/styles/main.css:36-37 imports tailwindcss/theme.css + utilities.css; src/styles/tokens.css `@theme {}` and src/styles/colors.css `@theme inline {}` define NO --radius-*; src/styles/isolation.css:150-162 re-pins --radius* to the same defaults on [data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]. The --blok-radius-* tokens (colors.css:331-336, 367-368, 469) are NOT wired to any Tailwind utility; no TS file references them except find-lens.ts:72 (copies --blok-radius-hairline onto its root for CSS use).

Scope limits: searched src/ and packages/*/src only. docs/, override-extension/, codemod/ and index.html (playground) were not inventoried. Catch-all `rg -il radius` over scope found no file beyond those listed. `rg rounded` over *.js/*.mjs/*.cjs in scope found nothing.

Token-scale oddity: colors.css:331-332 sets --blok-radius-xs 0.25rem (4px) but --blok-radius-sm 3px, so xs > sm.


## Tailwind utilities (live code, n=60)

| file:line | class/value | px | element role | size | category |
|---|---|---|---|---|---|
| src/shared/tool-classes/spacer.ts:17 | rounded-md | 6 | Spacer block wrapper | height set by data | container |
| src/shared/tool-classes/code.ts:31 | rounded-xl | 12 | Code block wrapper (border + bg-secondary) | my-2 | container |
| src/shared/tool-classes/callout.ts:26 | rounded-xl | 12 | Callout block panel | pl-8 pr-4 | container |
| src/tools/stub/index.ts:101 | rounded-[10px] | 10 | Stub (unavailable tool) block card | py-3 px-[18px] my-2.5 | container |
| src/components/block/style-manager.ts:22 | rounded-[4px] | 4 | Selected-block content highlight (bg-selection) | block content box | indicator |
| src/components/modules/toolbar/plus-button.ts:123 | rounded-[5px] | 5 | Toolbar "+" button | w-6 h-6 (24px) | control |
| src/components/modules/toolbar/plus-button.ts:134 | mobile:rounded-[6px] | 6 | Toolbar "+" button, mobile overlay-pane look | toolbox-btn-mobile 36px | control |
| src/components/modules/toolbar/settings-toggler.ts:127 | rounded-[5px] | 5 | Block settings toggler / drag handle | w-[18px] h-6 (18x24) | control |
| src/components/modules/toolbar/settings-toggler.ts:140 | mobile:rounded-[6px] | 6 | Settings toggler, mobile | toolbox-btn-mobile 36px | control |
| src/tools/table/table-cell-selection.ts:51 | rounded-sm | 4 | Table selection pill (handle on selection edge) | 4x20 idle, 16x20 active (inline) | indicator |
| src/tools/table/table-add-controls.ts:32 | rounded-sm | 4 | Table add-row/add-col bar visual (bordered) | full width x 16px (inline) | control |
| src/tools/table/table-row-col-controls.ts:65 | rounded-sm | 4 | Table row/col grip capsule | 24x4 / 4x20 idle, 16 on hover (inline) | indicator |
| src/tools/table/table-heading-toggle.ts:16 | rounded-md | 6 | Heading-toggle row inside table popover (menu row) | w-full p-(--item-padding) | control |
| src/tools/table/table-heading-toggle.ts:56 | rounded-full | full | Switch track | w-[30px] h-[18px] | pill |
| src/tools/table/table-heading-toggle.ts:69 | rounded-full | full | Switch thumb | w-[14px] h-[14px] | pill |
| src/tools/table/table-cell-placement-picker.ts:96 | rounded-[10px] | 10 | Cell placement preview panel | h-[84px] | container |
| src/tools/table/table-cell-placement-picker.ts:113 | rounded-full | full | Preview text line | h-1 (4px) | pill |
| src/tools/table/table-cell-placement-picker.ts:123 | rounded-[10px] | 10 | 3x3 options track (segmented group) | p-[3px] | container |
| src/tools/table/table-cell-placement-picker.ts:137 | rounded-[7px] | 7 | Sliding selection thumb | one grid cell (~h-8) | indicator |
| src/tools/table/table-cell-placement-picker.ts:149 | rounded-[7px] | 7 | Placement option button | h-8 (32px) | control |
| src/tools/table/table-cell-placement-picker.ts:176 | rounded-[3px] | 3 | Glyph mini-cell inside option | w-5 h-4 (20x16) p-[2px] | micro |
| src/tools/table/table-cell-placement-picker.ts:185 | rounded-full | full | Glyph line | h-[2px] | pill |
| src/components/shared/color-picker.ts:208 | rounded-lg | 8 | Color swatch button | w-10 h-10 (40px) | control |
| src/components/utils/link-hover-card.ts:69 | rounded-md | 6 | Link hover card button (copy/edit/etc.) | h-6 (24px) | control |
| src/components/utils/link-hover-card.ts:439 | rounded-lg | 8 | Link hover card surface | content height | container |
| src/components/modules/drag/preview/DragPreview.ts:64 | rounded | 4 | Drag preview "hidden children" count badge | px-1 text-xs | micro |
| src/components/utils/notifier/draw.ts:27 | rounded-[14px] | 14 | Toast (notification) surface | py-2 px-6 | container |
| src/components/utils/notifier/draw.ts:33 | rounded-[7px] | 7 | Toast action buttons (ok/cancel) | py-[5px] px-3 text-[13px] | control |
| src/components/utils/notifier/draw.ts:38 | rounded-[7px] | 7 | Toast prompt input | max-w-[140px] py-[5px] px-3 | control |
| src/components/utils/notifier/draw.ts:43 | rounded-full | full | Toast dismiss button | w-6 h-6 (24px) | pill |
| src/components/utils/tooltip.ts:90 | rounded-lg | 8 | Tooltip surface | px-2.5 py-1.5 (content) | container |
| src/components/utils/popover/popover.const.ts:8 | rounded-xl | 12 | Popover container (desktop: toolbox, block settings, menus) | w-(--width) | container |
| src/components/utils/popover/popover.const.ts:12 | rounded-[10px] | 10 | Popover container (mobile sheet) | full width minus offset | container |
| src/components/utils/popover/popover.const.ts:64 | rounded-[14px] | 14 | Inline-toolbar popover card | p-2 | container |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:14 | rounded-lg | 8 | Default popover menu item | px-2 py-1.5 max-h-9 (<=36px) | control |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:41 | rounded-md | 6 | Inline-toolbar popover item | h-7 (28px), mobile h-10 | control |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:53 | rounded | 4 | Nested inline popover item | p-[3px] mobile:p-1 | control |
| src/components/inline-tools/inline-tool-link.ts:22 | rounded-[10px] | 10 | Link suggestion row | px-1.5 py-1.5 | control |
| src/components/inline-tools/inline-tool-link.ts:65 | rounded-lg | 8 | Link option row | h-8 (32px) px-2 | control |
| src/components/inline-tools/inline-tool-link.ts:77 | rounded-xl | 12 | Recent-link card (clickable) | p-2 | container |
| src/components/inline-tools/inline-tool-link.ts:78 | rounded-[10px] | 10 | Recent-link favicon/preview tile | size-9 (36px) | media |
| src/components/inline-tools/inline-tool-link.ts:435 | rounded-[10px] | 10 | "Remove link" row button | px-2 py-1.5 | control |
| src/components/inline-tools/inline-tool-equation.ts:274 | rounded-[10px] | 10 | Equation input field wrapper | w-[300px] h-9 (36px) | control |
| src/components/inline-tools/inline-tool-equation.ts:288 | rounded-md | 6 | Equation "Done" button | h-7 (28px) | control |
| src/tools/code/constants.ts:67 | rounded | 4 | Code block language button | px-1.5 py-0.5 text-xs | control |
| src/tools/code/constants.ts:76 | rounded | 4 | Code header button | h-7 min-w-7 (28px) p-1 | control |
| src/tools/code/constants.ts:77 | rounded-lg | 8 | Code header button (matched size) | h-8.5 min-w-8.5 (34px) p-1.5 | control |
| src/tools/code/constants.ts:103 | rounded-lg | 8 | Code view-mode segmented container | p-0.5 border | container |
| src/tools/code/constants.ts:104 | rounded | 4 | Code view-mode button | p-1 | control |
| src/tools/code/constants.ts:105 | rounded | 4 | Code view-mode button (active) | p-1 | control |
| src/tools/toggle/constants.ts:95 | rounded | 4 | Toggle block arrow button | w-7 h-7 (28px) | control |
| src/tools/callout/emoji-picker/index.ts:484 | rounded-xl | 12 | Emoji picker panel | w-[400px] | container |
| src/tools/callout/emoji-picker/index.ts:539 | rounded-lg | 8 | Skin-tone toggle button | w-[28px] h-[28px] | control |
| src/tools/callout/emoji-picker/index.ts:559 | rounded-lg | 8 | Random-emoji button | w-[34px] h-[34px] | control |
| src/tools/callout/emoji-picker/index.ts:574 | rounded-lg | 8 | Remove-emoji button | w-[34px] h-[34px] | control |
| src/tools/callout/emoji-picker/index.ts:776 | rounded-xl | 12 | Skin-tone popover | p-1 | container |
| src/tools/callout/emoji-picker/index.ts:818 | rounded-lg | 8 | Skin-tone option button | w-[32px] h-[32px] | control |
| src/tools/callout/emoji-picker/index.ts:1198 | rounded-lg | 8 | Emoji category nav button | flex-1 h-[36px] | control |
| src/tools/callout/emoji-picker/index.ts:1602 | rounded-lg | 8 | Emoji grid cell button | aspect-square | control |
| src/tools/spacer/index.ts:422 | after:rounded-full | full | Spacer resize handle pill (::after) | after:h-2.5 after:w-10 (10x40) | indicator |

## Inline style / canvas radii (live code, n=14)

| file:line | class/value | px | element role | size | category |
|---|---|---|---|---|---|
| src/tools/spacer/alignment-guide.ts:158 | style.borderRadius='1px' | 1 | Spacer alignment guide line | height 2px | indicator |
| src/tools/database/database-board-view.ts:177 | style.borderRadius='4px' | 4 | Database board column header | padding 0 0 6px 0 | container |
| src/tools/database/database-board-view.ts:277 | style.borderRadius='10px' | 10 | Database board card | padding 10px 12px | container |
| src/tools/database/database-card-drag.ts:160 | style.borderRadius='8px' | 8 | Database card drag ghost | clone of card | container |
| src/tools/database/database-column-drag.ts:152 | style.borderRadius='10px' | 10 | Database column drag ghost | clone of column | container |
| src/tools/database/database-list-row-drag.ts:150 | style.borderRadius='8px' | 8 | Database list-row drag ghost | clone of row | container |
| src/tools/table/table-row-col-drag.ts:350 | style.borderRadius='1.5px' | 1.5 | Table row/col drop indicator line | thin line | indicator |
| src/tools/table/table-row-col-drag.ts:470 | style.borderRadius='4px' | 4 | Table row/col drag ghost | clone of row/col | container |
| src/tools/table/table-cell-selection.ts:1237 | style.borderRadius='2px' | 2 | Table cell-selection overlay (border rect) | selection bounds | indicator |
| src/tools/image/ui.ts:120 | style.borderRadius='50%' | 50% | Image crop wrapper when shape=circle/ellipse | width 100% | media |
| src/tools/image/ui.ts:386 | style.borderRadius='50%' | 50% | Lightbox crop wrapper when shape=circle/ellipse | image size | media |
| src/components/shared/block-color.ts:64 | border-radius:4px (inline style string) | 4 | Color-menu swatch (bg square / text glyph) | 18x18 | micro |
| src/tools/file/ui.ts:54 | borderRadius:'inherit' | inherit | File card transparent activator overlay | inset 0 | container |
| src/tools/audio/waveform.ts:156 | ctx.roundRect(..., min(barW/2, 2)) | <=2 | Audio waveform bars (canvas) | barW = slot - gap | indicator |

## Dead / non-shipped / excluded (not in histograms)

| file:line | value | note |
|---|---|---|
| src/components/modules/toolbar/styles.ts:32 | rounded-[7px] | `plusButton` key; no `CSS.plusButton` reader found in src (plus-button.ts builds its own classes). Likely dead |
| src/components/modules/toolbar/styles.ts:41 | mobile:rounded-[6px] | same, likely dead |
| src/components/modules/toolbar/styles.ts:52 | rounded-[7px] | `settingsToggler` key, w/h toolbox-btn 26px; likely dead |
| src/components/modules/toolbar/styles.ts:66 | mobile:rounded-[6px] | same, likely dead |
| src/components/utils/logger.ts:84 | border-radius: 30px | console.log badge CSS, not DOM UI |
| src/stories/Tooltip.stories.ts:37, :67 | 6px | Storybook only |
| src/stories/Table.stories.ts:158 / :201 / :915 | 1px / 1.5px / 2px | Storybook only |
| src/stories/helpers.ts:111 | 8px | Storybook only |
| src/components/utils/brand-marks.ts:110 | rx=32 (132 viewBox) | Rutube brand logo, treated as icon |
| index.html:1132 / :1139 | rounded-l-lg (8) / rounded-2xl (16) | playground page, not TS |
| src/styles/main.css:228, :269 | @apply rounded-xs (2) | CSS, out of scope |
| src/tools/database/database-view.ts:152 | style.borderRadius='4px' | column header; DatabaseView is imported only by test/unit/tools/database/database-view*.test.ts, not by src. Dead in product |
| src/tools/database/database-view.ts:225 | style.borderRadius='8px' | kanban card; same file, dead in product |


## SVG rx/ry on UI illustrations (user units; svg renders 1:1)

nothing-found-art.ts (64x48 svg): src/components/utils/popover/nothing-found-art.ts:10 rx=8 on 46.5x34.5 card.

media-preview-art.ts (200x120 viewBox, rendered width 200px, max-width 100%, media-empty.css:165):
| line | rx | shape |
|---|---|---|
| 39 | 1.5 | audio wave bars w3 |
| 51 | 1.5 | table cells 22x7 |
| 55 | 1.5 | chart bars w7 |
| 65 | height/2 (2.5 / 1.75) | doc text lines h5 / h3.5 |
| 72, 76 | 7 | video screen 136x62 (clip + fill) |
| 75 | 12 | video frame 152x94 |
| 84, 85 | 2 | progress track/progress h4 |
| 96 | 16 | audio frame 172x80 |
| 97 | 2.5 | line h5 |
| 98 | 2 | line h4 |
| 103 | 9 | audio art screen 58x60 |
| 108, 114 | 3 | photo 120x70 (clip + fill) |
| 110, 113 | 6 | photo frames 128x96 / 136x100 |
| 122 | 2 | caption line h4 |
| 129, 135 | 8 | sheet frames 62x92 |
| 130 | 2 | table head cell 48x8 |
| 136 | 2 | line 30x4 |
| 147 | 3 | file chip 22x11 |
| 148 | 1.5 | chip mark 14x3 |

src/components/utils/media-preview-3d.ts:18 only lists rx/ry as geometry attribute names (no value).


## Histogram: resolved px (live Tailwind + inline, n=74; SVG illustrations excluded)

| px | total | tailwind | inline |
|---|---|---|---|
| 1 | 1 | 0 | 1 |
| 1.5 | 1 | 0 | 1 |
| 2 | 1 | 0 | 1 |
| <=2 | 1 | 0 | 1 |
| 3 | 1 | 1 | 0 |
| 4 | 14 | 11 | 3 |
| 5 | 2 | 2 | 0 |
| 6 | 7 | 7 | 0 |
| 7 | 4 | 4 | 0 |
| 8 | 15 | 13 | 2 |
| 10 | 10 | 8 | 2 |
| 12 | 6 | 6 | 0 |
| 14 | 2 | 2 | 0 |
| 50% | 2 | 0 | 2 |
| full | 6 | 6 | 0 |
| inherit | 1 | 0 | 1 |

## Histogram: role x px

| role | 1 | 1.5 | 2 | <=2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 14 | 50% | full | inherit | total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| container |  |  |  |  |  | 2 |  | 1 |  | 5 | 6 | 6 | 2 |  |  | 1 | 23 |
| control |  |  |  |  |  | 7 | 2 | 6 | 3 | 10 | 3 |  |  |  |  |  | 31 |
| media |  |  |  |  |  |  |  |  |  |  | 1 |  |  | 2 |  |  | 3 |
| indicator | 1 | 1 | 1 | 1 |  | 3 |  |  | 1 |  |  |  |  |  | 1 |  | 9 |
| pill |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 5 |  | 5 |
| micro |  |  |  |  | 1 | 2 |  |  |  |  |  |  |  |  |  |  | 3 |

## Arbitrary-value classes (live)

| file:line | class | role | category |
|---|---|---|---|
| src/tools/stub/index.ts:101 | rounded-[10px] | Stub (unavailable tool) block card | container |
| src/components/block/style-manager.ts:22 | rounded-[4px] | Selected-block content highlight (bg-selection) | indicator |
| src/components/modules/toolbar/plus-button.ts:123 | rounded-[5px] | Toolbar "+" button | control |
| src/components/modules/toolbar/plus-button.ts:134 | mobile:rounded-[6px] | Toolbar "+" button, mobile overlay-pane look | control |
| src/components/modules/toolbar/settings-toggler.ts:127 | rounded-[5px] | Block settings toggler / drag handle | control |
| src/components/modules/toolbar/settings-toggler.ts:140 | mobile:rounded-[6px] | Settings toggler, mobile | control |
| src/tools/table/table-cell-placement-picker.ts:96 | rounded-[10px] | Cell placement preview panel | container |
| src/tools/table/table-cell-placement-picker.ts:123 | rounded-[10px] | 3x3 options track (segmented group) | container |
| src/tools/table/table-cell-placement-picker.ts:137 | rounded-[7px] | Sliding selection thumb | indicator |
| src/tools/table/table-cell-placement-picker.ts:149 | rounded-[7px] | Placement option button | control |
| src/tools/table/table-cell-placement-picker.ts:176 | rounded-[3px] | Glyph mini-cell inside option | micro |
| src/components/utils/notifier/draw.ts:27 | rounded-[14px] | Toast (notification) surface | container |
| src/components/utils/notifier/draw.ts:33 | rounded-[7px] | Toast action buttons (ok/cancel) | control |
| src/components/utils/notifier/draw.ts:38 | rounded-[7px] | Toast prompt input | control |
| src/components/utils/popover/popover.const.ts:12 | rounded-[10px] | Popover container (mobile sheet) | container |
| src/components/utils/popover/popover.const.ts:64 | rounded-[14px] | Inline-toolbar popover card | container |
| src/components/inline-tools/inline-tool-link.ts:22 | rounded-[10px] | Link suggestion row | control |
| src/components/inline-tools/inline-tool-link.ts:78 | rounded-[10px] | Recent-link favicon/preview tile | media |
| src/components/inline-tools/inline-tool-link.ts:435 | rounded-[10px] | "Remove link" row button | control |
| src/components/inline-tools/inline-tool-equation.ts:274 | rounded-[10px] | Equation input field wrapper | control |

## Notes / caveats

- The compiled-rule evidence (`.rounded{border-radius:.25rem}`, `.rounded-md{border-radius:var(--radius-md)}`, `.rounded-full{border-radius:2147483647px}`, arbitrary 3/4/5/7/10/14px) was read from dist/blok.iife.js (built 2026-09-30 14:53). Another session rebuilt dist during this research, so that file is gone now.
- Every compiled utility is scoped `:where([data-blok-interface], [data-blok-interface] *, [data-blok-popover], [data-blok-popover] *)`.
- Tailwind radii are rem. They scale with the host root font-size; `rounded-[Npx]` and inline px values do not.
- The --radius-* re-pin in isolation.css covers only `[data-blok-interface=blok]`, `[data-blok-interface=tooltip]` and `[data-blok-popover]`. Body-mounted roots with other interface values (notifier, link-hover-card, drag-preview, table-drag-ghost) read --radius-* from Tailwind's `:root, :host` theme block (Tailwind lib.js emits that selector). So a host override of `--radius-lg` on :root would reach link-hover-card's rounded-lg/rounded-md and drag-preview's rounded. This is inferred from the selectors and was not tested at runtime.
- Inconsistencies: board card 10px (database-board-view.ts:277) vs card/list-row drag ghosts 8px vs column ghost 10px; toolbar buttons 5px desktop vs 6px mobile; popover 12px desktop vs 10px mobile vs 14px inline-toolbar card; menu rows 8px (popover item, link option) vs 10px (link suggestion / remove rows) vs 6px (inline item, heading-toggle row).
