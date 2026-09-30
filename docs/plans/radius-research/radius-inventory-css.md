# Border-radius inventory — CSS under src/ (+ CSS-in-string / inline styles in .ts)

Generated 2026-09-30 from a read of every `radius`/`rounded` match in `src/**/*.css`, plus TS inline `style.borderRadius` / cssText strings. Tailwind `rounded-*` class strings in .ts are listed separately in the appendix and are NOT classified or counted in the histograms.

## Resolution rules (from source)

- Blok radius tokens, `src/styles/colors.css:331-336,367-368,469`: xs=0.25rem (4px at 16px root), sm=3px, md=6px, lg=12px, xl=16px, pill=999px, hairline=1.5px, none=0, md-plus=8px. Scope: `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])`.
- Spacing tokens, `colors.css:345-364`: space-N = N*4px (0-25=1, 0-5=2, 0-75=3, 1=4, 1-25=5, 1-5=6, 1-75=7, 2=8, 2-25=9, 2-5=10, 3=12, 3-5=14, 5=20). `main.css:708-713` re-declares a subset on `.blok-image-lightbox` with the same values.
- Tailwind radius (`isolation.css:153-161` reset = TW 4.3.3 `theme.css:397-404,508`): `rounded`=var(--radius)=4px, xs=2, sm=4, md=6, lg=8, xl=12, 2xl=16; `rounded-full`=calc(infinity*1px). rem values assume a 16px root.
- Body-mounted roots checked for token scope: lightbox (`image/ui.ts:573` promoteToTopLayer), file preview + crop modal (`openModalDialog` -> `modal-dialog.ts:314` promoteToTopLayer), alt-popover / audio cover-picker (selectors include `[data-blok-top-layer]`), notifier (`notifier/draw.ts:579` data-blok-interface). All carry an in-scope attribute, so tokens resolve.

Role codes: container/surface, control, media, indicator/handle, pill/circle, micro (<=2px notches). Extra non-usage rows: token definition, reset/inherit.

## Inventory (CSS)

| # | file:line | selector | property | raw value | resolved px | source kind | UI element | size (same rule) | role | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | src/styles/audio.css:21 | `[data-blok-tool="audio"]` | --blok-audio-radius | `var(--blok-radius-md)` | 6 | radius | audio: component radius token (no consumer in src/) |  | token definition | DEAD token |
| 2 | src/styles/audio.css:102 | `[data-blok-tool="audio"] .blok-audio-inner` | border-radius | `var(--blok-radius-lg)` | 12 | radius | audio block card (.blok-audio-inner) | width: 100% | container/surface |  |
| 3 | src/styles/audio.css:145 | `[data-blok-tool="audio"] .blok-audio-cover` | border-radius | `var(--blok-radius-md)` | 6 | radius | audio cover-art panel | width: 104px; min-height: 104px | media |  |
| 4 | src/styles/audio.css:213 | `.blok-audio-cover-picker, .blok-audio-cover-picker[data-blok-top-layer][popover]` | border-radius | `var(--blok-radius-lg)` | 12 | radius | audio cover-picker popover (top-layer) | width: min(440px, calc(100vw - 32px)) | container/surface |  |
| 5 | src/styles/audio.css:267 | `[data-blok-tool="audio"] .blok-audio-cover__placeholder::after` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio cover placeholder disc | width: 92px; height: 92px | pill/circle |  |
| 6 | src/styles/audio.css:298 | `[data-blok-tool="audio"] .blok-audio-cover__disc` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio vinyl disc | width: 92px; height: 92px | pill/circle |  |
| 7 | src/styles/audio.css:339 | `[data-blok-tool="audio"] .blok-audio-cover__disc::before` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio disc label ring (::before) | inset: 36% | pill/circle |  |
| 8 | src/styles/audio.css:365 | `[data-blok-tool="audio"] .blok-audio-cover__disc::after` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio disc spindle hole (::after) | inset: 47% | pill/circle |  |
| 9 | src/styles/audio.css:456 | `[data-blok-tool="audio"] .blok-audio-controls button[data-role]` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio control buttons | width: 30px; height: 30px | pill/circle | icon button, circular |
| 10 | src/styles/audio.css:528 | `[data-blok-tool="audio"] .blok-audio-controls__volume` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio volume slider track | width: 0; height: 4px | pill/circle |  |
| 11 | src/styles/audio.css:543 | `[data-blok-tool="audio"] .blok-audio-controls__volume::-webkit-slider-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio volume slider thumb (webkit) | width: 12px; height: 12px | pill/circle | vendor pair |
| 12 | src/styles/audio.css:551 | `[data-blok-tool="audio"] .blok-audio-controls__volume::-moz-range-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio volume slider thumb (moz) | width: 12px; height: 12px | pill/circle | vendor pair dup |
| 13 | src/styles/audio.css:586 | `[data-blok-tool="audio"] .blok-audio-controls__speed-menu` | border-radius | `var(--blok-radius-md)` | 6 | radius | audio speed menu | min-width: 132px | container/surface |  |
| 14 | src/styles/audio.css:617 | `[data-blok-tool="audio"] .blok-audio-controls__speed-step` | border-radius | `var(--blok-radius-sm)` | 3 | radius | audio speed -/+ step button | width: 24px; height: 24px | control |  |
| 15 | src/styles/audio.css:652 | `[data-blok-tool="audio"] .blok-audio-controls__speed-slider` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio speed slider track | min-width: 0; height: 4px | pill/circle |  |
| 16 | src/styles/audio.css:660 | `[data-blok-tool="audio"] .blok-audio-controls__speed-slider::-webkit-slider-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio speed slider thumb (webkit) | width: 12px; height: 12px | pill/circle | vendor pair |
| 17 | src/styles/audio.css:668 | `[data-blok-tool="audio"] .blok-audio-controls__speed-slider::-moz-range-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | audio speed slider thumb (moz) | width: 12px; height: 12px | pill/circle | vendor pair dup |
| 18 | src/styles/audio.css:681 | `[data-blok-tool="audio"] .blok-audio-controls__speed-chip` | border-radius | `var(--blok-radius-sm)` | 3 | radius | audio speed preset chip |  | control |  |
| 19 | src/styles/audio.css:754 | `[data-blok-tool="audio"] .blok-audio-error-state` | border-radius | `var(--blok-radius-lg)` | 12 | radius | audio error-state card |  | container/surface |  |
| 20 | src/styles/audio.css:765 | `[data-blok-tool="audio"] .blok-audio-retry` | border-radius | `var(--blok-radius-md)` | 6 | radius | audio retry button |  | control |  |
| 21 | src/styles/bookmark.css:27 | `[data-blok-tool="bookmark"] .blok-bookmark` | border-radius | `var(--blok-radius-lg)` | 12 | radius | bookmark card | width: 100% | container/surface |  |
| 22 | src/styles/bookmark.css:110 | `[data-blok-tool="bookmark"] .blok-bookmark__placeholder` | border-radius | `var(--blok-radius-lg)` | 12 | radius | bookmark placeholder card |  | container/surface |  |
| 23 | src/styles/checklist.css:12 | `[data-blok-interface] [data-list-style="checklist"] input[type="checkbox"]` | border-radius | `var(--blok-space-1-25)` | 5 | space | checklist checkbox |  | control | size not set in this rule |
| 24 | src/styles/colors.css:331 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-xs | `0.25rem` | 4 | rem | global radius token |  | token definition |  |
| 25 | src/styles/colors.css:332 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-sm | `3px` | 3 | px | global radius token |  | token definition |  |
| 26 | src/styles/colors.css:333 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-md | `6px` | 6 | px | global radius token |  | token definition |  |
| 27 | src/styles/colors.css:334 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-lg | `12px` | 12 | px | global radius token |  | token definition |  |
| 28 | src/styles/colors.css:335 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-xl | `16px` | 16 | px | global radius token |  | token definition |  |
| 29 | src/styles/colors.css:336 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-pill | `999px` | 999 | px | global radius token |  | token definition |  |
| 30 | src/styles/colors.css:367 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-hairline | `1.5px` | 1.5 | px | global radius token |  | token definition |  |
| 31 | src/styles/colors.css:368 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-none | `0` | 0 | zero | global radius token |  | token definition |  |
| 32 | src/styles/colors.css:469 | `:where([data-blok-interface]), :where([data-blok-popover]), :where([data-blok-top-layer])` | --blok-radius-md-plus | `8px` | 8 | px | global radius token |  | token definition |  |
| 33 | src/styles/columns.css:74 | `[data-blok-column-resizer]::before` | border-radius | `9999px` | 9999 | px | column resizer bar (::before) | width: 3px | pill/circle | raw 9999px |
| 34 | src/styles/database.css:38 | `[data-blok-database-board]::-webkit-scrollbar-thumb` | border-radius | `var(--blok-space-1)` | 4 | space | board horizontal scrollbar thumb |  | indicator/handle | scrollbar height 8px |
| 35 | src/styles/database.css:52 | `[data-blok-database-column]` | border-radius | `var(--blok-space-2-5)` | 10 | space | board column surface |  | container/surface |  |
| 36 | src/styles/database.css:70 | `[data-blok-database-card]` | border-radius | `var(--blok-space-2)` | 8 | space | board card |  | container/surface |  |
| 37 | src/styles/database.css:137 | `[data-blok-database-card-actions]` | border-radius | `var(--blok-space-2)` | 8 | space | card hover actions group |  | container/surface | floating mini-toolbar |
| 38 | src/styles/database.css:156 | `[data-blok-database-edit-card], [data-blok-database-card-menu]` | border-radius | `var(--blok-radius-md)` | 6 | radius | card edit/menu buttons | width: 28px; height: 28px | control |  |
| 39 | src/styles/database.css:199 | `[data-blok-database-add-card], [data-blok-database-add-column]` | border-radius | `var(--blok-space-2)` | 8 | space | add card / add column buttons | width: 100% | control |  |
| 40 | src/styles/database.css:233 | `[data-blok-database-add-column]` | border-radius | `var(--blok-space-2)` | 8 | space | add column button |  | control |  |
| 41 | src/styles/database.css:248 | `[data-blok-database-delete-column]` | border-radius | `var(--blok-radius-sm)` | 3 | radius | delete column button |  | control |  |
| 42 | src/styles/database.css:271 | `[data-blok-database-column-pill]` | border-radius | `var(--blok-space-5)` | 20 | space | column header pill (badge) | min-width: 0; width: fit-content | control | chip; 2px v-padding, height not set; 20px likely >= half-height => effectively pill (unverified) |
| 43 | src/styles/database.css:295 | `[data-blok-database-column-dot]` | border-radius | `50%` | 50% | pct | column color dot | width: 8px; height: 8px | pill/circle |  |
| 44 | src/styles/database.css:379 | `[data-blok-database-drawer-close]` | border-radius | `var(--blok-space-1)` | 4 | space | drawer close button |  | control |  |
| 45 | src/styles/database.css:419 | `[data-blok-database-drawer-content]::-webkit-scrollbar-thumb` | border-radius | `var(--blok-space-1)` | 4 | space | drawer content scrollbar thumb |  | indicator/handle |  |
| 46 | src/styles/database.css:491 | `[data-blok-database-drawer-status-pill]` | border-radius | `var(--blok-space-1)` | 4 | space | drawer status pill (named pill, 4px radius) |  | control | chip; name says pill but radius 4px |
| 47 | src/styles/database.css:503 | `[data-blok-database-drawer-status-dot]` | border-radius | `50%` | 50% | pct | drawer status dot | width: 8px; height: 8px | pill/circle |  |
| 48 | src/styles/database.css:531 | `[data-blok-database-add-card]` | border-radius | `var(--blok-space-3)` | 12 | space | add card button (board variant, later rule) |  | control |  |
| 49 | src/styles/database.css:623 | `[data-blok-database-tab]` | border-radius | `var(--blok-space-2-5)` | 10 | space | view tab |  | control |  |
| 50 | src/styles/database.css:660 | `[data-blok-database-add-view]` | border-radius | `var(--blok-space-2)` | 8 | space | add view button | width: 32px; height: 32px | control |  |
| 51 | src/styles/database.css:687 | `[data-blok-database-tab-more]` | border-radius | `var(--blok-radius-md)` | 6 | radius | tab more button |  | control |  |
| 52 | src/styles/database.css:702 | `[data-blok-database-tab-overflow-dropdown]` | border-radius | `var(--blok-space-2-5)` | 10 | space | tab overflow dropdown |  | container/surface |  |
| 53 | src/styles/database.css:723 | `[data-blok-database-view-option]` | border-radius | `var(--blok-radius-md)` | 6 | radius | view option row |  | control | menu item |
| 54 | src/styles/database.css:738 | `[data-blok-database-view-option-icon]` | border-radius | `var(--blok-space-1-75)` | 7 | space | view option icon tile | width: 30px; height: 30px | control | icon tile |
| 55 | src/styles/database.css:775 | `[data-blok-database-tab-overflow-item]` | border-radius | `var(--blok-radius-md)` | 6 | radius | tab overflow item |  | control | menu item |
| 56 | src/styles/database.css:795 | `[data-blok-database-tab-overflow-new]` | border-radius | `var(--blok-radius-md)` | 6 | radius | tab overflow 'new' item |  | control | menu item |
| 57 | src/styles/database.css:812 | `[data-blok-database-tab-rename-input]` | border-radius | `var(--blok-space-1)` | 4 | space | tab rename input | width: 80px | control | input |
| 58 | src/styles/database.css:825 | `[data-blok-database-tab-ghost]` | border-radius | `var(--blok-radius-md)` | 6 | radius | tab drag ghost |  | control |  |
| 59 | src/styles/database.css:857 | `[data-blok-database-list-row]` | border-radius | `var(--blok-space-1)` | 4 | space | list row |  | control | row hover surface |
| 60 | src/styles/database.css:911 | `[data-blok-database-list-row-property]` | border-radius | `var(--blok-space-1)` | 4 | space | list row property chip |  | control | chip |
| 61 | src/styles/database.css:930 | `[data-blok-database-list-row-open]` | border-radius | `var(--blok-space-1)` | 4 | space | list row open button | width: 22px; height: 22px | control |  |
| 62 | src/styles/database.css:944 | `[data-blok-database-list-row-open]::after` | border-radius | `var(--blok-border-width-hairline)` | 1 | borderwidth | list row open chevron (::after) | width: 7px; height: 7px | micro | border-width token used as radius |
| 63 | src/styles/database.css:970 | `[data-blok-database-list-row-properties] [data-blok-database-delete-row]` | border-radius | `var(--blok-radius-sm)` | 3 | radius | list row delete button | width: 18px; height: 18px | control |  |
| 64 | src/styles/database.css:1000 | `[data-blok-database-list] > [data-blok-database-add-row], [data-blok-database-list-rows] ~ [data-blok-database-add-row]` | border-radius | `var(--blok-space-2)` | 8 | space | list add row button | width: 100% | control |  |
| 65 | src/styles/database.css:1033 | `[data-blok-database-list-group-header]` | border-radius | `var(--blok-space-1)` | 4 | space | list group header |  | control |  |
| 66 | src/styles/database.css:1065 | `[data-blok-database-list-group-dot]` | border-radius | `50%` | 50% | pct | list group dot | width: 8px; height: 8px | pill/circle |  |
| 67 | src/styles/database.css:1113 | `[data-blok-database-drawer-add-prop]` | border-radius | `var(--blok-radius-md)` | 6 | radius | drawer add property button | width: 100% | control |  |
| 68 | src/styles/database.css:1144 | `[data-blok-database-property-type-popover]` | border-radius | `var(--blok-space-2-5)` | 10 | space | property type popover | min-width: 210px | container/surface |  |
| 69 | src/styles/database.css:1172 | `[data-blok-database-property-type-option]` | border-radius | `var(--blok-radius-md)` | 6 | radius | property type option |  | control | menu item |
| 70 | src/styles/embed.css:20 | `[data-blok-tool="embed"] [data-role="embed-aspect"]` | border-radius | `var(--blok-radius-md, 8px)` | 6 | radius | embed iframe aspect frame |  | media | fallback 8px disagrees with md=6px |
| 71 | src/styles/embed.css:35 | `[data-blok-tool="embed"] [data-role="resize-handle"]` | border-radius | `var(--blok-radius-pill)` | 999 | radius | embed resize handle | width: 6px; height: clamp(24px, 25%, 50px) | indicator/handle | pill-shaped handle |
| 72 | src/styles/embed.css:90 | `[data-blok-tool="embed"] .blok-embed-toolbar` | border-radius | `var(--blok-space-2)` | 8 | space | embed floating toolbar |  | container/surface |  |
| 73 | src/styles/embed.css:117 | `[data-blok-tool="embed"] .blok-embed-toolbar button, [data-blok-tool="embed"] .blok-embed-toolbar a` | border-radius | `var(--blok-space-1)` | 4 | space | embed toolbar buttons | width: 28px; height: 28px | control |  |
| 74 | src/styles/embed.css:161 | `[data-blok-tool="embed"] .blok-embed-toolbar__align-popover` | border-radius | `var(--blok-space-2)` | 8 | space | embed align popover |  | container/surface |  |
| 75 | src/styles/embed.css:215 | `.blok-embed-empty__submit` | border-radius | `var(--blok-space-1-75)` | 7 | space | embed empty submit button | height: 20px | control |  |
| 76 | src/styles/embed.css:254 | `.blok-embed-empty__kbd` | border-radius | `var(--blok-space-1)` | 4 | space | embed empty kbd hint | height: 16px; max-width: 0 | control | kbd chip |
| 77 | src/styles/embed.css:288 | `.blok-embed-empty__readonly` | border-radius | `var(--blok-radius-md)` | 6 | radius | embed empty read-only notice |  | container/surface |  |
| 78 | src/styles/embed.css:326 | `.blok-embed-linkcard` | border-radius | `var(--blok-space-2-5)` | 10 | space | embed link card | width: 100% | container/surface |  |
| 79 | src/styles/embed.css:399 | `.blok-embed-linkcard__action` | border-radius | `var(--blok-space-1-5)` | 6 | space | embed link card action button | width: 28px; height: 28px | control |  |
| 80 | src/styles/emoji-picker.css:26 | `[data-blok-emoji-picker][data-blok-popover]` | border-radius | `var(--blok-radius-xl)` | 16 | radius | emoji picker popover | width: min(400px, calc(100vw - 16px)); max-height: calc(100dvh - 16px) | container/surface |  |
| 81 | src/styles/emoji-picker.css:61 | `[data-blok-emoji-picker] [data-emoji-picker-clear]` | border-radius | `var(--blok-radius-md)` | 6 | radius | emoji search clear button | width: 24px; height: 24px | control |  |
| 82 | src/styles/emoji-picker.css:75 | `[data-blok-emoji-picker] :is([data-emoji-picker-skin-toggle], [data-emoji-picker-random], [data-emoji-picker-remove])` | border-radius | `var(--blok-space-2-25)` | 9 | space | emoji header buttons (skin/random/remove) | width: 32px; height: 28px | control |  |
| 83 | src/styles/emoji-picker.css:140 | `[data-blok-emoji-picker] [data-emoji-picker-skin-tone]` | border-radius | `var(--blok-radius-lg)` | 12 | radius | skin-tone panel | width: min(236px, calc(100% - 24px)) | container/surface |  |
| 84 | src/styles/emoji-picker.css:154 | `[data-blok-emoji-picker] [data-emoji-picker-skin-tone] button` | border-radius | `var(--blok-radius-md-plus)` | 8 | radius | skin-tone button | width: 100%; min-width: 0; height: 36px | control |  |
| 85 | src/styles/emoji-picker.css:172 | `[data-blok-emoji-picker] [data-emoji-skin-indicator]` | border-radius | `var(--blok-radius-md-plus)` | 8 | radius | skin-tone active indicator | width: calc((100% - 10px) / 6); height: 36px | indicator/handle | selection slab behind button |
| 86 | src/styles/emoji-picker.css:275 | `[data-blok-emoji-picker] [data-emoji-native]` | border-radius | `var(--blok-radius-md-plus)` | 8 | radius | emoji grid cell | min-width: 0 | control |  |
| 87 | src/styles/emoji-picker.css:311 | `[data-blok-emoji-picker] [data-emoji-nav]` | border-radius | `var(--blok-space-2-25)` | 9 | space | category nav button | height: 36px | control |  |
| 88 | src/styles/emoji-picker.css:339 | `[data-blok-emoji-picker] [data-emoji-nav-indicator]` | border-radius | `var(--blok-space-2-25)` | 9 | space | category nav indicator | height: 36px | indicator/handle | selection slab |
| 89 | src/styles/emoji-picker.css:394 | `[data-blok-emoji-picker] [data-emoji-picker-empty-art] > span` | border-radius | `15px` | 15 | px | empty-state art card | width: 48px; height: 52px | container/surface | decorative illustration; raw px |
| 90 | src/styles/emoji-picker.css:409 | `[data-blok-emoji-picker] [data-emoji-picker-empty-art] > span:nth-child(2)` | border-radius | `18px` | 18 | px | empty-state art card (middle) | width: 60px; height: 64px | container/surface | decorative illustration; raw px |
| 91 | src/styles/emoji-picker.css:450 | `[data-blok-emoji-picker] [data-emoji-picker-empty] button` | border-radius | `var(--blok-radius-md-plus)` | 8 | radius | empty-state button | min-height: 32px | control |  |
| 92 | src/styles/emoji-picker.css:548 | `[data-emoji-picker-body]::-webkit-scrollbar-thumb` | border-radius | `var(--blok-radius-sm)` | 3 | radius | emoji body scrollbar thumb |  | indicator/handle |  |
| 93 | src/styles/field.css:15 | `[data-blok-field]` | border-radius | `var(--blok-space-2)` | 8 | space | shared text field ([data-blok-field]) | min-height: 28px; max-width: 650px) | control | input |
| 94 | src/styles/file.css:39 | `[data-blok-tool="file"] .blok-file-card` | border-radius | `var(--blok-radius-xl)` | 16 | radius | file card | width: 100% | container/surface |  |
| 95 | src/styles/file.css:65 | `[data-blok-tool="file"] .blok-file-icon` | border-radius | `var(--blok-radius-md)` | 6 | radius | file type icon tile | width: 40px; height: 40px | control | icon tile |
| 96 | src/styles/file.css:156 | `[data-blok-tool="file"] .blok-file-download` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file download button | width: 32px; height: 32px | pill/circle | circular button |
| 97 | src/styles/file.css:221 | `[data-blok-tool="file"] .blok-file-uploading` | border-radius | `var(--blok-radius-xl)` | 16 | radius | file uploading card |  | container/surface |  |
| 98 | src/styles/file.css:237 | `[data-blok-tool="file"] .blok-file-bar` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file progress bar track | height: 6px | pill/circle |  |
| 99 | src/styles/file.css:244 | `[data-blok-tool="file"] .blok-file-bar-fill` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file progress bar fill | height: 100% | pill/circle |  |
| 100 | src/styles/file.css:276 | `[data-blok-tool="file"] .blok-file-cancel` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file cancel button |  | pill/circle |  |
| 101 | src/styles/file.css:312 | `[data-blok-tool="file"] .blok-file-error-state` | border-radius | `var(--blok-radius-xl)` | 16 | radius | file error-state card |  | container/surface |  |
| 102 | src/styles/file.css:325 | `[data-blok-tool="file"] .blok-file-retry` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file retry button |  | pill/circle |  |
| 103 | src/styles/file.css:391 | `.blok-file-preview` | border-radius | `var(--blok-radius-xl)` | 16 | radius | file preview modal dialog | width: min(960px, 100%); height: min(90vh, 100%) | container/surface | top-layer via openModalDialog |
| 104 | src/styles/file.css:483 | `.blok-file-preview-open, .blok-file-preview-close` | border-radius | `var(--blok-radius-pill)` | 999 | radius | file preview open/close buttons | width: 32px; height: 32px | pill/circle |  |
| 105 | src/styles/file.css:624 | `.blok-file-preview-pre::-webkit-scrollbar-thumb, .blok-file-preview-md::-webkit-scrollbar-thumb, .blok-file-preview-office::-webkit-scrol...` | border-radius | `var(--blok-space-1)` | 4 | space | file preview scrollbar thumbs |  | indicator/handle |  |
| 106 | src/styles/file.css:819 | `.blok-file-preview-md code` | border-radius | `var(--blok-radius-sm)` | 3 | radius | markdown preview inline code |  | control | inline chip |
| 107 | src/styles/file.css:826 | `.blok-file-preview-md pre` | border-radius | `var(--blok-radius-md)` | 6 | radius | markdown preview code block |  | container/surface |  |
| 108 | src/styles/file.css:841 | `.blok-file-preview-md img` | border-radius | `var(--blok-radius-md)` | 6 | radius | markdown preview image | max-width: 100%; height: auto | media |  |
| 109 | src/styles/file.css:874 | `.blok-file-preview-toggle` | border-radius | `var(--blok-radius-pill)` | 999 | radius | preview render/raw toggle group |  | pill/circle | segmented control |
| 110 | src/styles/file.css:885 | `.blok-file-preview-toggle-indicator` | border-radius | `var(--blok-radius-pill)` | 999 | radius | preview toggle sliding indicator | width: 0 | pill/circle |  |
| 111 | src/styles/file.css:900 | `.blok-file-preview-toggle button` | border-radius | `var(--blok-radius-pill)` | 999 | radius | preview toggle buttons |  | pill/circle |  |
| 112 | src/styles/file.css:945 | `.blok-md-alert` | border-radius | `var(--blok-radius-sm)` | 3 | radius | markdown alert (GFM callout) |  | container/surface |  |
| 113 | src/styles/file.css:1043 | `.blok-file-preview-docx .blok-docx` | border-radius | `var(--blok-radius-lg)` | 12 | radius | docx preview page |  | container/surface |  |
| 114 | src/styles/file.css:1065 | `.blok-file-preview-xlsx-table` | border-radius | `var(--blok-radius-md)` | 6 | radius | xlsx preview table |  | container/surface |  |
| 115 | src/styles/file.css:1122 | `.blok-file-preview-pptx > *` | border-radius | `var(--blok-radius-lg)` | 12 | radius | pptx preview slide |  | container/surface |  |
| 116 | src/styles/find.css:95 | `[data-blok-find-bar]` | border-radius | `var(--blok-radius-lg)` | 12 | radius | find bar | width: min(432px, calc(100vw - 2 * var(--blok-space-4))) | container/surface |  |
| 117 | src/styles/find.css:252 | `[data-blok-find-icon-button]` | border-radius | `var(--blok-radius-md)` | 6 | radius | find icon button | width: 28px; height: 28px | control |  |
| 118 | src/styles/find.css:313 | `[data-blok-find-toggle='find-whole-word'] > span::after` | border-radius | `0 0 var(--blok-space-0-25) var(--blok-space-0-25)` | 0 / 0 / 1 / 1 | space,zero | whole-word toggle glyph underline bracket (::after) | height: 3px | micro | per-corner 0 0 1px 1px |
| 119 | src/styles/find.css:368 | `[data-blok-find-tick]` | border-radius | `var(--blok-radius-pill)` | 999 | radius | find scrollbar tick mark | width: 2px; height: 10px | indicator/handle |  |
| 120 | src/styles/find.css:434 | `[data-blok-find-text-button]` | border-radius | `var(--blok-radius-md)` | 6 | radius | find text button | height: 28px | control |  |
| 121 | src/styles/find.css:478 | `[data-blok-find-lens-box]` | border-radius | `var(--blok-radius-hairline)` | 1.5 | radius | find lens highlight box |  | micro | match highlight ring |
| 122 | src/styles/image.css:36 | `[data-blok-tool="image"] .blok-image-inner img` | border-radius | `var(--blok-radius-lg)` | 12 | radius | image <img> | width: 100%; height: auto | media |  |
| 123 | src/styles/image.css:39 | `[data-blok-tool="image"][data-rounded="off"] .blok-image-inner img` | border-radius | `0` | 0 | zero | image <img> with rounded=off |  | reset/inherit | 0 when user turns rounding off |
| 124 | src/styles/image.css:55 | `[data-blok-element-content].bg-selection:has([data-blok-tool="image"]) .blok-image-inner` | border-radius | `var(--blok-space-1)` | 4 | space | selected image selection wash |  | indicator/handle | block selection bg |
| 125 | src/styles/image.css:152 | `[data-blok-tool="image"] .blok-image-alt-pill` | border-radius | `var(--blok-radius-pill)` | 999 | radius | image alt-text pill | max-width: min(calc(100% - 20px), 240px) | pill/circle |  |
| 126 | src/styles/image.css:188 | `[data-blok-tool="image"] .blok-image-alt-pill__mark` | border-radius | `50%` | 50% | pct | alt pill status dot | width: 6px; height: 6px | pill/circle |  |
| 127 | src/styles/image.css:220 | `[data-blok-tool="image"] .blok-image-alt-pill__help` | border-radius | `50%` | 50% | pct | alt pill help '?' circle | width: 14px; height: 14px | pill/circle |  |
| 128 | src/styles/image.css:233 | `[data-blok-tool="image"] .blok-image-toolbar__island` | border-radius | `var(--blok-space-2-25)` | 9 | space | image toolbar island |  | container/surface | floating mini-toolbar |
| 129 | src/styles/image.css:245 | `[data-blok-tool="image"] .blok-image-toolbar::before` | border-radius | `var(--blok-space-2-25)` | 9 | space | image toolbar merged backdrop (::before) | inset: 0 | container/surface |  |
| 130 | src/styles/image.css:289 | `@keyframes blok-image-islands-split >> from` | border-radius | `var(--blok-radius-sm)` | 3 | radius | toolbar island split animation 'from' frame |  | container/surface | keyframe |
| 131 | src/styles/image.css:315 | `[data-blok-tool="image"] .blok-image-toolbar button` | border-radius | `var(--blok-space-1)` | 4 | space | image toolbar buttons | width: 28px; height: 28px | control |  |
| 132 | src/styles/image.css:330 | `[data-blok-tool="image"] .blok-image-toolbar__pill` | border-radius | `var(--blok-space-1)` | 4 | space | image toolbar segmented pill group |  | control | named pill but 4px |
| 133 | src/styles/image.css:331 | `[data-blok-tool="image"] .blok-image-toolbar__pill button` | border-radius | `0` | 0 | zero | buttons inside toolbar pill group |  | reset/inherit | 0 (parent clips) |
| 134 | src/styles/image.css:351 | `[data-blok-tool="image"] [data-role="image-selection-ring"]` | border-radius | `var(--blok-radius-lg)` | 12 | radius | image selection ring | height: var(--blok-image-media-height, 100%) | media | matches media radius |
| 135 | src/styles/image.css:391 | `[data-blok-tool="image"] .blok-image-popover` | border-radius | `var(--blok-space-2)` | 8 | space | image settings popover | min-width: 220px | container/surface |  |
| 136 | src/styles/image.css:421 | `[data-blok-tool="image"] .blok-image-popover__item` | border-radius | `var(--blok-space-1)` | 4 | space | image popover item | width: 100% | control | menu item |
| 137 | src/styles/image.css:443 | `[data-blok-tool="image"] .blok-image-popover__size` | border-radius | `var(--blok-space-1)` | 4 | space | image popover size option |  | control |  |
| 138 | src/styles/image.css:462 | `[data-blok-tool="image"] [data-role="resize-handle"]` | border-radius | `50%` | 50% | pct | image resize corner handle | width: 9px; height: 9px | pill/circle | 9px dot handle |
| 139 | src/styles/image.css:504 | `[data-blok-tool="image"] [data-role="image-resize-readout"]` | border-radius | `var(--blok-radius-md)` | 6 | radius | image resize readout badge |  | control | chip |
| 140 | src/styles/image.css:611 | `.blok-image-uploading__card` | border-radius | `var(--blok-radius-lg)` | 12 | radius | image uploading card |  | container/surface |  |
| 141 | src/styles/image.css:646 | `.blok-image-uploading__cancel` | border-radius | `var(--blok-space-1-5)` | 6 | space | image upload cancel button | width: 24px; height: 24px | control |  |
| 142 | src/styles/image.css:664 | `.blok-image-uploading__cancel:focus-visible` | border-radius | `var(--blok-space-1-5)` | 6 | space | image upload cancel :focus-visible |  | control | state repeat |
| 143 | src/styles/image.css:681 | `.blok-image-uploading__tile` | border-radius | `9px` | 9 | px | image uploading file tile | width: 38px; height: 38px | control | icon tile; raw px |
| 144 | src/styles/image.css:710 | `.blok-image-uploading__bar` | border-radius | `999px` | 999 | px | image upload progress bar | height: 3px | pill/circle | raw 999px |
| 145 | src/styles/image.css:719 | `.blok-image-uploading__bar-fill` | border-radius | `inherit` | inherit | kw | image upload progress fill | height: 100% | reset/inherit | inherit (999px) |
| 146 | src/styles/image.css:762 | `.blok-image-error` | border-radius | `var(--blok-radius-lg)` | 12 | radius | image error card |  | container/surface |  |
| 147 | src/styles/image.css:774 | `.blok-image-error__icon` | border-radius | `var(--blok-radius-md-plus, calc(var(--blok-radius-md) + 2px))` | 8 | radius | image error icon tile | width: 40px; height: 40px | control | icon tile; fallback calc(md+2)=8px agrees |
| 148 | src/styles/image.css:789 | `.blok-image-error__btn` | border-radius | `var(--blok-radius-md)` | 6 | radius | image error buttons |  | control |  |
| 149 | src/styles/image.css:823 | `[data-blok-tool="image"][data-retrying="true"] .blok-image-error__btn[data-action="retry"]::after` | border-radius | `50%` | 50% | pct | retry spinner (::after) | inset: 0; width: 14px; height: 14px | pill/circle |  |
| 150 | src/styles/image.css:833 | `[data-blok-tool="image"] .blok-image-inner[data-loading="true"]` | border-radius | `var(--blok-radius-md)` | 6 | radius | image loading placeholder | min-height: 220px | media |  |
| 151 | src/styles/image.css:879 | `[data-blok-tool="image"] .blok-image-inner[data-loading="true"]::after` | border-radius | `50%` | 50% | pct | image loading spinner (::after) | inset: 0; width: 34px; height: 34px | pill/circle |  |
| 152 | src/styles/isolation.css:153 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius | `0.25rem` | 4 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 153 | src/styles/isolation.css:154 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-xs | `0.125rem` | 2 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 154 | src/styles/isolation.css:155 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-sm | `0.25rem` | 4 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 155 | src/styles/isolation.css:156 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-md | `0.375rem` | 6 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 156 | src/styles/isolation.css:157 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-lg | `0.5rem` | 8 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 157 | src/styles/isolation.css:158 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-xl | `0.75rem` | 12 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 158 | src/styles/isolation.css:159 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-2xl | `1rem` | 16 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 159 | src/styles/isolation.css:160 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-3xl | `1.5rem` | 24 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 160 | src/styles/isolation.css:161 | `[data-blok-interface=blok], [data-blok-interface=tooltip], [data-blok-popover]` | --radius-4xl | `2rem` | 32 | rem | Tailwind --radius-* reset (restores TW defaults) |  | token definition |  |
| 161 | src/styles/main.css:156 | `@utility blok-inline-tool-button` | @apply rounded | `var(--radius)=0.25rem` | 4 | tw | inline-toolbar tool button | w-7=28px, h-full | control |  |
| 162 | src/styles/main.css:163 | `@utility blok-input` | @apply rounded-[3px] | `3px` | 3 | px | legacy input utility |  | control | raw px |
| 163 | src/styles/main.css:167 | `@utility blok-loader` | @apply before:rounded-full | `calc(infinity*1px)` | pill | full | loader spinner (::before) | 18x18px | pill/circle |  |
| 164 | src/styles/main.css:171 | `@utility blok-button` | @apply rounded-[3px] | `3px` | 3 | px | legacy button utility |  | control | raw px |
| 165 | src/styles/main.css:179 | `@utility blok-settings-button` | @apply rounded-[3px] | `3px` | 3 | px | settings/toolbox button (desktop) | min 26x26 (toolbox-btn) | control | raw px |
| 166 | src/styles/main.css:179 | `@utility blok-settings-button (mobile:)` | @apply mobile:rounded-lg | `var(--radius-lg)=0.5rem` | 8 | tw | settings/toolbox button (mobile) | 36x36 (toolbox-btn-mobile) | control | Tailwind lg=8 vs Blok lg=12 |
| 167 | src/styles/main.css:198 | `[data-blok-navigation-focused="true"]` | @apply rounded-md | `var(--radius-md)=0.375rem` | 6 | tw | keyboard-navigation focused block |  | indicator/handle |  |
| 168 | src/styles/main.css:228 | `[data-drop-indicator]::before` | @apply rounded-xs | `var(--radius-xs)=0.125rem` | 2 | tw | drag drop-indicator bar | bar thickness --blok-dnd-drop-indicator-thickness=6px | indicator/handle | Tailwind xs=2 vs Blok xs=4 |
| 169 | src/styles/main.css:269 | `[data-drop-indicator-lead]::after` | @apply rounded-xs | `var(--radius-xs)=0.125rem` | 2 | tw | drag drop-indicator lead bar | height 6px | indicator/handle |  |
| 170 | src/styles/main.css:317 | `[data-blok-spring-loaded] [data-blok-element-content]` | border-radius | `var(--blok-space-1)` | 4 | space | spring-loaded block flash |  | indicator/handle | block highlight |
| 171 | src/styles/main.css:326 | `.blok-block--target` | border-radius | `var(--blok-space-1)` | 4 | space | #anchor arrival pulse block |  | indicator/handle | block highlight |
| 172 | src/styles/main.css:556 | `[data-blok-selected="true"] [data-list-style] [role="listitem"]` | @apply rounded-[4px] | `4px` | 4 | px | selected list item wash |  | indicator/handle | raw px |
| 173 | src/styles/main.css:575 | `[data-blok-selected="true"] [data-role="embed-figure"]::before` | @apply rounded-md | `var(--radius-md)` | 6 | tw | selected embed wash | -inset-2 | indicator/handle |  |
| 174 | src/styles/main.css:701 | `[data-blok-tool="image"] .blok-image-toolbar__align-popover` | border-radius | `var(--blok-space-2)` | 8 | space | image align popover |  | container/surface |  |
| 175 | src/styles/main.css:769 | `.blok-image-lightbox__bar` | border-radius | `var(--blok-space-3)` | 12 | space | lightbox toolbar bar |  | container/surface |  |
| 176 | src/styles/main.css:786 | `.blok-image-lightbox__btn` | border-radius | `var(--blok-space-2)` | 8 | space | lightbox toolbar button | width: 32px; height: 32px | control |  |
| 177 | src/styles/main.css:809 | `.blok-image-lightbox__nav` | border-radius | `var(--blok-space-3)` | 12 | space | lightbox prev/next nav |  | container/surface |  |
| 178 | src/styles/media-empty.css:19 | `.blok-media-empty__card` | border-radius | `var(--blok-radius-lg)` | 12 | radius | media empty-state card |  | container/surface |  |
| 179 | src/styles/media-empty.css:58 | `.blok-media-empty__tab` | border-radius | `var(--blok-radius-md)` | 6 | radius | empty-state tab |  | control |  |
| 180 | src/styles/media-empty.css:81 | `.blok-media-empty__panel` | border-radius | `var(--blok-radius-lg)` | 12 | radius | empty-state panel |  | container/surface |  |
| 181 | src/styles/media-empty.css:118 | `.blok-media-empty__tile` | border-radius | `var(--blok-radius-md)` | 6 | radius | empty-state icon tile | width: 36px; height: 36px | control | icon tile |
| 182 | src/styles/media-empty.css:130 | `.blok-media-empty__glyph` | border-radius | `var(--blok-radius-md)` | 6 | radius | empty-state glyph tile | width: 36px; height: 36px | control | icon tile |
| 183 | src/styles/media-empty.css:410 | `.blok-media-empty__choose` | border-radius | `var(--blok-radius-md)` | 6 | radius | 'choose file' button |  | control |  |
| 184 | src/styles/media-empty.css:468 | `.blok-media-empty__embed-icon[data-site] .blok-media-empty__embed-site` | border-radius | `var(--blok-space-1-5)` | 6 | space | embed site favicon tile | width: 20px; height: 20px | media | 20px logo |
| 185 | src/styles/media-empty.css:490 | `.blok-media-empty__embed-icon[data-logo] .blok-media-empty__embed-logo` | border-radius | `var(--blok-space-1-5)` | 6 | space | embed logo tile | width: 20px; height: 20px | media | 20px logo |
| 186 | src/styles/media-empty.css:571 | `.blok-media-empty__embed-submit` | border-radius | `var(--blok-radius-md)` | 6 | radius | embed submit button | height: 20px | control |  |
| 187 | src/styles/media-empty.css:653 | `.blok-media-empty__embed-kbd` | border-radius | `var(--blok-space-1)` | 4 | space | embed kbd hint | height: 16px; max-width: 40px | control | kbd chip |
| 188 | src/styles/media-empty.css:734 | `.blok-media-empty__embed-type` | border-radius | `var(--blok-radius-sm)` | 3 | radius | embed type badge |  | control | chip |
| 189 | src/styles/media-empty.css:756 | `.blok-media-empty__input` | border-radius | `var(--blok-space-1-75)` | 7 | space | empty-state URL input | min-width: 0 | control | input |
| 190 | src/styles/media-empty.css:765 | `.blok-media-empty__input:focus, .blok-media-empty__input:focus-visible` | border-radius | `var(--blok-space-1-75)` | 7 | space | URL input :focus |  | control | state repeat |
| 191 | src/styles/media-empty.css:779 | `.blok-media-empty__search` | border-radius | `var(--blok-space-1-75)` | 7 | space | empty-state search box | min-width: 0 | control | input |
| 192 | src/styles/media-empty.css:789 | `.blok-media-empty__input--bare` | border-radius | `0` | 0 | zero | bare input (inside search box) | min-width: 0 | reset/inherit | 0 |
| 193 | src/styles/media-empty.css:804 | `.blok-media-empty__submit` | border-radius | `var(--blok-radius-md)` | 6 | radius | empty-state submit button |  | control |  |
| 194 | src/styles/media-empty.css:821 | `.blok-media-empty__badge` | border-radius | `var(--blok-radius-sm)` | 3 | radius | empty-state badge |  | control | chip |
| 195 | src/styles/media-empty.css:842 | `.blok-media-empty__drop-inner` | border-radius | `var(--blok-radius-md)` | 6 | radius | drop-zone inner |  | container/surface |  |
| 196 | src/styles/notifier-card.css:18 | `[data-blok-interface='notifier'] [data-blok-toast='card']` | --blok-toast-card-radius | `16px` | 16 | px | toast card radius token | min-width: 340px; max-width: min(620px, calc(100vw - 32px)) | token definition | per-component token, raw 16px |
| 197 | src/styles/notifier-card.css:20 | `[data-blok-interface='notifier'] [data-blok-toast='card']` | --blok-toast-tile-radius | `10px` | 10 | px | toast tile radius token | min-width: 340px; max-width: min(620px, calc(100vw - 32px)) | token definition | per-component token, raw 10px |
| 198 | src/styles/notifier-card.css:41 | `[data-blok-interface='notifier'] [data-blok-toast='card']` | --blok-toast-pill-radius | `999px` | 999 | px | toast pill radius token | min-width: 340px; max-width: min(620px, calc(100vw - 32px)) | token definition | per-component token, raw 999px |
| 199 | src/styles/notifier-card.css:42 | `[data-blok-interface='notifier'] [data-blok-toast='card']` | --blok-toast-count-radius | `9px` | 9 | px | toast count radius token | min-width: 340px; max-width: min(620px, calc(100vw - 32px)) | token definition | per-component token, raw 9px |
| 200 | src/styles/notifier-card.css:54 | `[data-blok-interface='notifier'] [data-blok-toast='card']` | border-radius | `var(--blok-toast-card-radius)` | 16 | comp | toast card | min-width: 340px; max-width: min(620px, calc(100vw - 32px)) | container/surface |  |
| 201 | src/styles/notifier-card.css:125 | `[data-blok-toast='card'] [data-blok-toast-part='thumb']` | border-radius | `var(--blok-toast-tile-radius)` | 10 | comp | toast thumbnail | inset: 0 | media |  |
| 202 | src/styles/notifier-card.css:173 | `[data-blok-toast='card'] [data-blok-toast-part='count']` | border-radius | `var(--blok-toast-count-radius)` | 9 | comp | toast count badge | min-width: 18px; height: 18px | pill/circle | 9px on 18px height = pill |
| 203 | src/styles/notifier-card.css:216 | `[data-blok-toast='card'] [data-blok-toast-part='action']` | border-radius | `var(--blok-toast-pill-radius)` | 999 | comp | toast action button | height: 30px | pill/circle |  |
| 204 | src/styles/notifier-card.css:264 | `[data-blok-toast='card'] [data-blok-toast-part='spinner']` | border-radius | `50%` | 50% | pct | toast spinner | inset: 0; width: 14px; height: 14px | pill/circle |  |
| 205 | src/styles/notifier-card.css:285 | `[data-blok-toast='card'] [data-blok-toast-part='check']` | border-radius | `var(--blok-toast-tile-radius)` | 10 | comp | toast success check tile | width: 40px; height: 40px | control | icon tile |
| 206 | src/styles/notifier-card.css:300 | `[data-blok-toast='card'] [data-blok-toast-part='check']::after` | border-radius | `inherit` | inherit | kw | toast check tile overlay (::after) | inset: 0 | reset/inherit | inherit (10px) |
| 207 | src/styles/popover-animation.css:15 | `[data-blok-popover-container]` | border-radius | `var(--radius-xl)` | 12 | tw | popover card (all popovers) |  | container/surface | uses Tailwind --radius-xl, not a Blok token; conflicts with rounded-[14px] on inline popover (popover.const.ts:64), winner unverified |
| 208 | src/styles/popover-animation.css:119 | `:is([data-blok-testid='block-tunes-popover'] > [data-blok-popover-container], [data-blok-popover-container]:has(> [data-blok-popover-item...` | border-radius | `var(--blok-space-1-5)` | 6 | space | popover item in block-tunes / convert popovers | min-height: 32px; max-height: none | control | menu item |
| 209 | src/styles/preflight.css:136 | `@layer base >> :where([data-blok-interface], [data-blok-popover]) code:not(pre code), :where([data-blok-interface]) span[data-latex][data...` | border-radius | `0.25em` | 0.25em (em-relative; ~4px at 16px font, font-size not set in rule) | em | inline code / equation-editing span |  | control | inline chip; em-relative |
| 210 | src/styles/preflight.css:332 | `@layer base >> [data-blok-interface] :focus-visible, [data-blok-popover] :focus-visible` | border-radius | `revert` | revert | kw | any :focus-visible |  | reset/inherit | revert |
| 211 | src/styles/presence.css:10 | `[data-blok-interface]` | --blok-presence-caret-radius | `1px` | 1 | px | presence caret radius token |  | token definition | per-component token, raw 1px |
| 212 | src/styles/presence.css:31 | `[data-blok-presence-caret]` | border-radius | `var(--blok-presence-caret-radius)` | 1 | comp | remote peer caret bar | width: 2px | micro | 2px wide caret |
| 213 | src/styles/presence.css:58 | `[data-blok-presence-caret-label]` | border-radius | `var(--blok-space-1)` | 4 | space | remote caret name label |  | control | chip |
| 214 | src/styles/presence.css:146 | `[data-blok-presence-face], [data-blok-presence-face-overflow]` | border-radius | `50%` | 50% | pct | presence avatar face | width: 32px; height: 32px | pill/circle |  |
| 215 | src/styles/slash-search.css:29 | `[data-blok-slash-search][contenteditable]::before` | @apply rounded-[6px] | `6px` | 6 | px | slash-search query highlight (::before) | height 1lh+4px | control | raw px |
| 216 | src/styles/slash-search.css:41 | `span[data-blok-slash-search]` | @apply rounded-[6px] | `6px` | 6 | px | slash-search query span | py 2px | control | raw px |
| 217 | src/styles/slash-search.css:91 | `[data-blok-popover-scrollbar]` | border-radius | `var(--blok-space-1)` | 4 | space | popover custom scrollbar thumb | width: 4px | indicator/handle | 4px wide => pill |
| 218 | src/styles/tables.css:143 | `[data-blok-table-cell] [data-blok-selected="true"] + [data-blok-selected="true"] [data-blok-element-content]` | border-top-left-radius | `0` | 0 | zero | adjacent selected lines in cell (top corners) |  | reset/inherit | longhand 0 |
| 219 | src/styles/tables.css:144 | `[data-blok-table-cell] [data-blok-selected="true"] + [data-blok-selected="true"] [data-blok-element-content]` | border-top-right-radius | `0` | 0 | zero | adjacent selected lines in cell (top corners) |  | reset/inherit | longhand 0 |
| 220 | src/styles/tables.css:148 | `[data-blok-table-cell] [data-blok-selected="true"]:has(+ [data-blok-selected="true"]) [data-blok-element-content]` | border-bottom-left-radius | `0` | 0 | zero | adjacent selected lines in cell (bottom corners) |  | reset/inherit | longhand 0 |
| 221 | src/styles/tables.css:149 | `[data-blok-table-cell] [data-blok-selected="true"]:has(+ [data-blok-selected="true"]) [data-blok-element-content]` | border-bottom-right-radius | `0` | 0 | zero | adjacent selected lines in cell (bottom corners) |  | reset/inherit | longhand 0 |
| 222 | src/styles/video.css:31 | `[data-blok-tool="video"] .blok-video-media` | border-radius | `var(--blok-radius-lg)` | 12 | radius | video media frame |  | media |  |
| 223 | src/styles/video.css:59 | `[data-blok-element-content].bg-selection:has([data-blok-tool="video"]) .blok-video-inner` | border-radius | `var(--blok-space-1)` | 4 | space | selected video selection wash |  | indicator/handle | block selection bg |
| 224 | src/styles/video.css:116 | `[data-blok-tool="video"] .blok-video-inner[data-fullscreen="true"] .blok-video-media` | border-radius | `0` | 0 | zero | fullscreen video frame | width: 100%; height: 100% | reset/inherit | 0 |
| 225 | src/styles/video.css:163 | `[data-blok-tool="video"] [data-role="resize-handle"]` | border-radius | `var(--blok-radius-pill)` | 999 | radius | video resize handle | width: 6px; height: clamp(24px, 25%, 50px) | indicator/handle | pill-shaped handle |
| 226 | src/styles/video.css:202 | `[data-blok-tool="video"] .blok-video-error-state` | border-radius | `var(--blok-radius-lg)` | 12 | radius | video error-state card |  | container/surface |  |
| 227 | src/styles/video.css:213 | `[data-blok-tool="video"] .blok-video-retry` | border-radius | `var(--blok-radius-md)` | 6 | radius | video retry button |  | control |  |
| 228 | src/styles/video.css:284 | `[data-blok-tool="video"] .blok-video-controls__burst` | border-radius | `var(--blok-radius-pill)` | 999 | radius | play/pause burst | width: 78px; height: 78px | pill/circle |  |
| 229 | src/styles/video.css:299 | `[data-blok-tool="video"] .blok-video-controls__burst::after` | border-radius | `var(--blok-radius-pill)` | 999 | radius | burst ring (::after) | inset: -1px | pill/circle |  |
| 230 | src/styles/video.css:330 | `[data-blok-tool="video"] .blok-video-controls__speed` | border-radius | `var(--blok-radius-pill)` | 999 | radius | speed badge |  | pill/circle |  |
| 231 | src/styles/video.css:393 | `[data-blok-tool="video"] .blok-video-controls__seek-flash` | border-radius | `var(--blok-radius-pill)` | 999 | radius | seek flash (+/-10s) |  | pill/circle |  |
| 232 | src/styles/video.css:457 | `[data-blok-tool="video"] .blok-video-controls__btn` | border-radius | `var(--blok-radius-pill)` | 999 | radius | video control buttons | width: 32px; height: 32px | pill/circle |  |
| 233 | src/styles/video.css:492 | `[data-blok-tool="video"] .blok-video-controls__seek-wrap::before` | border-radius | `var(--blok-radius-pill)` | 999 | radius | seek track (::before) | height: 4px | pill/circle |  |
| 234 | src/styles/video.css:504 | `[data-blok-tool="video"] .blok-video-controls__buffered` | border-radius | `var(--blok-radius-pill)` | 999 | radius | buffered bar | width: var(--blok-buffered-pct, 0%); height: 4px | pill/circle |  |
| 235 | src/styles/video.css:523 | `[data-blok-tool="video"] .blok-video-controls__seek` | border-radius | `var(--blok-radius-pill)` | 999 | radius | seek range input | min-width: 0; height: 4px | pill/circle |  |
| 236 | src/styles/video.css:543 | `[data-blok-tool="video"] .blok-video-controls__seek-tooltip` | border-radius | `var(--blok-radius-sm)` | 3 | radius | seek time tooltip |  | control | chip |
| 237 | src/styles/video.css:561 | `[data-blok-tool="video"] .blok-video-controls__seek-thumb` | border-radius | `var(--blok-radius-xs)` | 4 | radius | seek frame-preview thumbnail | width: 160px; height: auto | media | only use of --blok-radius-xs |
| 238 | src/styles/video.css:577 | `[data-blok-tool="video"] .blok-video-controls__seek::-webkit-slider-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | seek thumb (webkit) | width: 13px; height: 13px | pill/circle | vendor pair |
| 239 | src/styles/video.css:586 | `[data-blok-tool="video"] .blok-video-controls__seek::-moz-range-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | seek thumb (moz) | width: 13px; height: 13px | pill/circle | vendor pair dup |
| 240 | src/styles/video.css:613 | `[data-blok-tool="video"] .blok-video-controls__volume` | border-radius | `var(--blok-radius-pill)` | 999 | radius | volume slider | width: 0; height: 4px | pill/circle |  |
| 241 | src/styles/video.css:627 | `[data-blok-tool="video"] .blok-video-controls__volume::-webkit-slider-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | volume thumb (webkit) | width: 11px; height: 11px | pill/circle | vendor pair |
| 242 | src/styles/video.css:634 | `[data-blok-tool="video"] .blok-video-controls__volume::-moz-range-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | volume thumb (moz) | width: 11px; height: 11px | pill/circle | vendor pair dup |
| 243 | src/styles/video.css:665 | `[data-blok-tool="video"] .blok-video-controls__menu` | border-radius | `var(--blok-radius-lg)` | 12 | radius | video settings menu | width: 224px | container/surface |  |
| 244 | src/styles/video.css:680 | `[data-blok-tool="video"] .blok-video-controls__menu::before` | border-radius | `inherit` | inherit | kw | menu backdrop (::before) | inset: 0 | reset/inherit | inherit (12px) |
| 245 | src/styles/video.css:744 | `[data-blok-tool="video"] .blok-video-controls__menu-row` | border-radius | `var(--blok-radius-md)` | 6 | radius | video menu row | width: 100%; min-height: 34px | control | menu item |
| 246 | src/styles/video.css:840 | `[data-blok-tool="video"] .blok-video-controls__speed-step` | border-radius | `var(--blok-radius-md)` | 6 | radius | video speed step button | width: 26px; height: 26px | control |  |
| 247 | src/styles/video.css:872 | `[data-blok-tool="video"] .blok-video-controls__speed-slider` | border-radius | `var(--blok-radius-pill)` | 999 | radius | video speed slider track | min-width: 0; height: 3px | pill/circle |  |
| 248 | src/styles/video.css:880 | `[data-blok-tool="video"] .blok-video-controls__speed-slider::-webkit-slider-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | video speed slider thumb (webkit) | width: 12px; height: 12px | pill/circle | vendor pair |
| 249 | src/styles/video.css:889 | `[data-blok-tool="video"] .blok-video-controls__speed-slider::-moz-range-thumb` | border-radius | `var(--blok-radius-pill)` | 999 | radius | video speed slider thumb (moz) | width: 12px; height: 12px | pill/circle | vendor pair dup |
| 250 | src/styles/video.css:918 | `[data-blok-tool="video"] .blok-video-controls__speed-chip` | border-radius | `var(--blok-radius-md)` | 6 | radius | video speed preset chip | min-width: 0; min-height: 30px | control | chip (audio twin uses sm=3px) |
| 251 | src/styles/video.css:1066 | `[data-blok-tool="video"] .blok-video-inner[data-theater="true"] .blok-video-media video` | border-radius | `var(--blok-radius-lg)` | 12 | radius | <video> in theater mode |  | media |  |
| 252 | src/styles/video.css:1087 | `[data-blok-tool="video"] .blok-video-controls__center` | border-radius | `var(--blok-radius-pill)` | 999 | radius | center play button | width: 64px; height: 64px | pill/circle |  |
| 253 | src/styles/video.css:1105 | `[data-blok-tool="video"] .blok-video-controls__spinner` | border-radius | `50%` | 50% | pct | loading spinner | inset: 0; width: 38px; height: 38px | pill/circle |  |
| 254 | src/styles/video.css:1145 | `[data-blok-tool="video"] .blok-video-controls__ctx` | border-radius | `var(--blok-radius-md)` | 6 | radius | right-click context menu | min-width: 210px; max-width: 90% | container/surface |  |
| 255 | src/styles/video.css:1160 | `[data-blok-tool="video"] .blok-video-controls__ctx-item` | border-radius | `var(--blok-radius-sm)` | 3 | radius | context menu item | width: 100% | control | menu item |
| 256 | src/styles/video.css:1175 | `[data-blok-tool="video"] .blok-video-controls__stats` | border-radius | `var(--blok-radius-sm)` | 3 | radius | stats-for-nerds panel |  | container/surface |  |
| 257 | src/styles/video.css:1228 | `[data-blok-tool="video"] .blok-video-converting` | border-radius | `var(--blok-radius-md)` | 6 | radius | converting (GIF->WebM) notice |  | container/surface |  |
| 258 | src/tools/image/alt-popover.css:11 | `.blok-image-alt-popover, .blok-image-alt-popover[data-blok-top-layer][popover]` | border-radius | `var(--blok-space-2-5)` | 10 | space | image alt-text popover (top-layer) | width: 320px; max-width: min(90vw, 360px) | container/surface |  |
| 259 | src/tools/image/crop-editor.css:186 | `.blok-image-crop-editor__rect[data-shape="circle"], .blok-image-crop-editor__rect[data-shape="ellipse"]` | border-radius | `50%` | 50% | pct | crop rect, circle/ellipse shape |  | media | shape mask |
| 260 | src/tools/image/crop-editor.css:196 | `.blok-image-crop-editor__shape-mask[data-shape="circle"], .blok-image-crop-editor__shape-mask[data-shape="ellipse"]` | border-radius | `50%` | 50% | pct | crop shape mask, circle/ellipse |  | media | shape mask |
| 261 | src/tools/image/crop-editor.css:248 | `.blok-image-crop-editor__size-pill` | border-radius | `var(--blok-radius-pill)` | 999 | radius | crop size readout pill |  | pill/circle |  |
| 262 | src/tools/image/crop-editor.css:300 | `.blok-image-crop-editor__handle--nw .blok-image-crop-editor__handle-stroke--a` | border-radius | `var(--blok-radius-none, 0) var(--blok-radius-hairline) var(--blok-radius-hairline) var(--blok-radius-none, 0)` | 0 / 1.5 / 1.5 / 0 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 263 | src/tools/image/crop-editor.css:301 | `.blok-image-crop-editor__handle--nw .blok-image-crop-editor__handle-stroke--b` | border-radius | `var(--blok-radius-none, 0) var(--blok-radius-none, 0) var(--blok-radius-hairline) var(--blok-radius-hairline)` | 0 / 0 / 1.5 / 1.5 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 264 | src/tools/image/crop-editor.css:303 | `.blok-image-crop-editor__handle--ne .blok-image-crop-editor__handle-stroke--a` | border-radius | `var(--blok-radius-hairline) var(--blok-radius-none, 0) var(--blok-radius-none, 0) var(--blok-radius-hairline)` | 1.5 / 0 / 0 / 1.5 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 265 | src/tools/image/crop-editor.css:304 | `.blok-image-crop-editor__handle--ne .blok-image-crop-editor__handle-stroke--b` | border-radius | `var(--blok-radius-none, 0) var(--blok-radius-none, 0) var(--blok-radius-hairline) var(--blok-radius-hairline)` | 0 / 0 / 1.5 / 1.5 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 266 | src/tools/image/crop-editor.css:306 | `.blok-image-crop-editor__handle--se .blok-image-crop-editor__handle-stroke--a` | border-radius | `var(--blok-radius-hairline) var(--blok-radius-none, 0) var(--blok-radius-none, 0) var(--blok-radius-hairline)` | 1.5 / 0 / 0 / 1.5 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 267 | src/tools/image/crop-editor.css:307 | `.blok-image-crop-editor__handle--se .blok-image-crop-editor__handle-stroke--b` | border-radius | `var(--blok-radius-hairline) var(--blok-radius-hairline) var(--blok-radius-none, 0) var(--blok-radius-none, 0)` | 1.5 / 1.5 / 0 / 0 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 268 | src/tools/image/crop-editor.css:309 | `.blok-image-crop-editor__handle--sw .blok-image-crop-editor__handle-stroke--a` | border-radius | `var(--blok-radius-none, 0) var(--blok-radius-hairline) var(--blok-radius-hairline) var(--blok-radius-none, 0)` | 0 / 1.5 / 1.5 / 0 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 269 | src/tools/image/crop-editor.css:310 | `.blok-image-crop-editor__handle--sw .blok-image-crop-editor__handle-stroke--b` | border-radius | `var(--blok-radius-hairline) var(--blok-radius-hairline) var(--blok-radius-none, 0) var(--blok-radius-none, 0)` | 1.5 / 1.5 / 0 / 0 | radius | crop corner-bracket stroke (3px thick bar) |  | micro | half-round end cap on one end; per-corner 0 / 1.5px |
| 270 | src/tools/image/crop-editor.css:317 | `.blok-image-crop-editor__handle--edge` | border-radius | `var(--blok-radius-pill)` | 999 | radius | crop edge handle |  | indicator/handle | pill-shaped handle |
| 271 | src/tools/image/crop-editor.css:381 | `.blok-image-crop-editor__ratio-group` | border-radius | `var(--blok-space-2-5)` | 10 | space | crop aspect-ratio chip group |  | control | segmented group |
| 272 | src/tools/image/crop-editor.css:392 | `.blok-image-crop-editor__ratio-chip` | border-radius | `var(--blok-space-1-75)` | 7 | space | crop aspect-ratio chip |  | control | chip |
| 273 | src/tools/image/crop-editor.css:443 | `.blok-image-crop-editor__kbd-hint kbd` | border-radius | `var(--blok-space-1)` | 4 | space | crop kbd hint | min-width: 14px | control | kbd chip |
| 274 | src/tools/image/crop-editor.css:466 | `.blok-image-crop-editor__btn` | border-radius | `var(--blok-space-2)` | 8 | space | crop editor buttons |  | control |  |
| 275 | src/tools/image/crop-modal.css:73 | `.blok-image-crop-modal-dialog` | border-radius | `var(--blok-space-3-5)` | 14 | space | crop modal dialog | max-width: min(92vw, 1100px); max-height: 92vh | container/surface | top-layer via openModalDialog |

Source kinds: radius = --blok-radius-*, space = --blok-space-* used as radius, tw = Tailwind --radius-*, comp = per-component radius token, borderwidth = border-width token used as radius, px/rem/em = literal, pct = 50%, full = rounded-full, kw = inherit/revert, zero = 0.

## Inventory (TS inline styles / CSS-in-string)

| # | file:line | property | raw value | resolved px | UI element | size | role | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | src/tools/database/database-board-view.ts:177 | header.style.borderRadius | `'4px'` | 4 | board column header |  | control | raw px |
| 2 | src/tools/database/database-board-view.ts:277 | cardEl.style.borderRadius | `'10px'` | 10 | board card (inline, overrides database.css:70 = 8px) |  | container/surface | raw px; disagrees with CSS |
| 3 | src/tools/database/database-view.ts:152 | header.style.borderRadius | `'4px'` | 4 | column header |  | control | raw px |
| 4 | src/tools/database/database-view.ts:225 | cardEl.style.borderRadius | `'8px'` | 8 | card |  | container/surface | raw px |
| 5 | src/tools/database/database-card-drag.ts:160 | ghost style.borderRadius | `'8px'` | 8 | card drag ghost |  | container/surface | raw px |
| 6 | src/tools/database/database-column-drag.ts:152 | ghost style.borderRadius | `'10px'` | 10 | column drag ghost |  | container/surface | raw px |
| 7 | src/tools/database/database-list-row-drag.ts:150 | ghost style.borderRadius | `'8px'` | 8 | list-row drag ghost (row itself is 4px) |  | container/surface | raw px; disagrees with database.css:857 |
| 8 | src/tools/file/ui.ts:54 | borderRadius | `'inherit'` | inherit | file card overlay button | inset 0 | reset/inherit |  |
| 9 | src/tools/image/ui.ts:120 | wrapper.style.borderRadius | `'50%'` | 50% | circle/ellipse crop wrapper |  | media |  |
| 10 | src/tools/image/ui.ts:386 | wrapper.style.borderRadius | `'50%'` | 50% | lightbox circle/ellipse crop wrapper |  | media |  |
| 11 | src/tools/table/table-cell-selection.ts:1237 | overlay.style.borderRadius | `'2px'` | 2 | table cell-range selection overlay |  | indicator/handle | raw px |
| 12 | src/tools/table/table-row-col-drag.ts:350 | dropIndicator.style.borderRadius | `'1.5px'` | 1.5 | table row/col drop indicator |  | micro | raw px |
| 13 | src/tools/table/table-row-col-drag.ts:470 | ghost style.borderRadius | `'4px'` | 4 | table row/col drag ghost |  | container/surface | raw px |
| 14 | src/tools/spacer/alignment-guide.ts:158 | line.style.borderRadius | `'1px'` | 1 | spacer alignment guide line | height 2px | micro | raw px |
| 15 | src/components/shared/block-color.ts:64 | cssText string | `border-radius:4px` | 4 | color swatch in menu | 18x18px | control | raw px |
| 16 | src/components/utils/logger.ts:84 | console %c style | `border-radius: 30px` | 30 | console log label (NOT UI) |  | n/a | raw px; console only |
| 17 | src/stories/helpers.ts:111 | container.style.borderRadius | `'8px'` | 8 | storybook container (dev-only) |  | n/a | dev-only |
| 18 | src/stories/Tooltip.stories.ts:37 | button.style.borderRadius | `'6px'` | 6 | storybook button (dev-only) |  | n/a | dev-only |
| 19 | src/stories/Tooltip.stories.ts:67 | button.style.borderRadius | `'6px'` | 6 | storybook button (dev-only) |  | n/a | dev-only |
| 20 | src/stories/Table.stories.ts:158 | overlay.style.borderRadius | `'1px'` | 1 | storybook overlay (dev-only) |  | n/a | dev-only |
| 21 | src/stories/Table.stories.ts:201 | indicator.style.borderRadius | `'1.5px'` | 1.5 | storybook indicator (dev-only) |  | n/a | dev-only |
| 22 | src/stories/Table.stories.ts:915 | pill.style.borderRadius | `'2px'` | 2 | storybook pill (dev-only) |  | n/a | dev-only |

## Histogram: resolved px (CSS usage rows; excludes token definitions and resets/inherit)

Rows counted: 239 (of which 7 are vendor-pair/state duplicates; counted, flagged in notes).

| px | count |
|---|---|
| 0.25em (~4) | 1 |
| 1 | 2 |
| 1 (per-corner, other corners 0) | 1 |
| 1.5 | 1 |
| 1.5 (per-corner, other corners 0) | 8 |
| 2 | 2 |
| 3 | 16 |
| 4 | 27 |
| 5 | 1 |
| 6 | 46 |
| 7 | 6 |
| 8 | 19 |
| 9 | 7 |
| 10 | 9 |
| 12 | 23 |
| 14 | 1 |
| 15 | 1 |
| 16 | 6 |
| 18 | 1 |
| 20 | 1 |
| pill(50%) | 13 |
| pill(9999px) | 1 |
| pill(999px) | 45 |
| pill(rounded-full) | 1 |

## Histogram: role x px (CSS usage rows)

| role | 0.25em (~4) | 1 | 1 (per-corner, other corners 0) | 1.5 | 1.5 (per-corner, other corners 0) | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 15 | 16 | 18 | 20 | pill(50%) | pill(9999px) | pill(999px) | pill(rounded-full) | total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| container/surface |  |  |  |  |  |  | 3 |  |  | 7 |  | 6 | 2 | 5 | 18 | 1 | 1 | 6 | 1 |  |  |  |  |  | 50 |
| control | 1 |  |  |  |  |  | 12 | 17 | 1 | 31 | 6 | 12 | 3 | 3 | 1 |  |  |  |  | 1 |  |  |  |  | 88 |
| media |  |  |  |  |  |  |  | 1 |  | 6 |  |  |  | 1 | 4 |  |  |  |  |  | 2 |  |  |  | 14 |
| indicator/handle |  |  |  |  |  | 2 | 1 | 9 |  | 2 |  | 1 | 1 |  |  |  |  |  |  |  |  |  | 4 |  | 20 |
| pill/circle |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 11 | 1 | 41 | 1 | 55 |
| micro |  | 2 | 1 | 1 | 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 12 |

## Histogram: TS inline styles (shipping code only; excludes stories, logger, inherit)

| px | count |
|---|---|
| 1 | 1 |
| 1.5 | 1 |
| 2 | 1 |
| 4 | 4 |
| 8 | 3 |
| 10 | 2 |
| pill(50%) | 2 |

## Anomalies

### (a) Spacing tokens used as radii — 68 rows

- src/styles/checklist.css:12 `var(--blok-space-1-25)` = 5px — checklist checkbox
- src/styles/database.css:38 `var(--blok-space-1)` = 4px — board horizontal scrollbar thumb
- src/styles/database.css:52 `var(--blok-space-2-5)` = 10px — board column surface
- src/styles/database.css:70 `var(--blok-space-2)` = 8px — board card
- src/styles/database.css:137 `var(--blok-space-2)` = 8px — card hover actions group
- src/styles/database.css:199 `var(--blok-space-2)` = 8px — add card / add column buttons
- src/styles/database.css:233 `var(--blok-space-2)` = 8px — add column button
- src/styles/database.css:271 `var(--blok-space-5)` = 20px — column header pill (badge)
- src/styles/database.css:379 `var(--blok-space-1)` = 4px — drawer close button
- src/styles/database.css:419 `var(--blok-space-1)` = 4px — drawer content scrollbar thumb
- src/styles/database.css:491 `var(--blok-space-1)` = 4px — drawer status pill (named pill, 4px radius)
- src/styles/database.css:531 `var(--blok-space-3)` = 12px — add card button (board variant, later rule)
- src/styles/database.css:623 `var(--blok-space-2-5)` = 10px — view tab
- src/styles/database.css:660 `var(--blok-space-2)` = 8px — add view button
- src/styles/database.css:702 `var(--blok-space-2-5)` = 10px — tab overflow dropdown
- src/styles/database.css:738 `var(--blok-space-1-75)` = 7px — view option icon tile
- src/styles/database.css:812 `var(--blok-space-1)` = 4px — tab rename input
- src/styles/database.css:857 `var(--blok-space-1)` = 4px — list row
- src/styles/database.css:911 `var(--blok-space-1)` = 4px — list row property chip
- src/styles/database.css:930 `var(--blok-space-1)` = 4px — list row open button
- src/styles/database.css:1000 `var(--blok-space-2)` = 8px — list add row button
- src/styles/database.css:1033 `var(--blok-space-1)` = 4px — list group header
- src/styles/database.css:1144 `var(--blok-space-2-5)` = 10px — property type popover
- src/styles/embed.css:90 `var(--blok-space-2)` = 8px — embed floating toolbar
- src/styles/embed.css:117 `var(--blok-space-1)` = 4px — embed toolbar buttons
- src/styles/embed.css:161 `var(--blok-space-2)` = 8px — embed align popover
- src/styles/embed.css:215 `var(--blok-space-1-75)` = 7px — embed empty submit button
- src/styles/embed.css:254 `var(--blok-space-1)` = 4px — embed empty kbd hint
- src/styles/embed.css:326 `var(--blok-space-2-5)` = 10px — embed link card
- src/styles/embed.css:399 `var(--blok-space-1-5)` = 6px — embed link card action button
- src/styles/emoji-picker.css:75 `var(--blok-space-2-25)` = 9px — emoji header buttons (skin/random/remove)
- src/styles/emoji-picker.css:311 `var(--blok-space-2-25)` = 9px — category nav button
- src/styles/emoji-picker.css:339 `var(--blok-space-2-25)` = 9px — category nav indicator
- src/styles/field.css:15 `var(--blok-space-2)` = 8px — shared text field ([data-blok-field])
- src/styles/file.css:624 `var(--blok-space-1)` = 4px — file preview scrollbar thumbs
- src/styles/find.css:313 `0 0 var(--blok-space-0-25) var(--blok-space-0-25)` = 0 / 0 / 1 / 1px — whole-word toggle glyph underline bracket (::after)
- src/styles/image.css:55 `var(--blok-space-1)` = 4px — selected image selection wash
- src/styles/image.css:233 `var(--blok-space-2-25)` = 9px — image toolbar island
- src/styles/image.css:245 `var(--blok-space-2-25)` = 9px — image toolbar merged backdrop (::before)
- src/styles/image.css:315 `var(--blok-space-1)` = 4px — image toolbar buttons
- src/styles/image.css:330 `var(--blok-space-1)` = 4px — image toolbar segmented pill group
- src/styles/image.css:391 `var(--blok-space-2)` = 8px — image settings popover
- src/styles/image.css:421 `var(--blok-space-1)` = 4px — image popover item
- src/styles/image.css:443 `var(--blok-space-1)` = 4px — image popover size option
- src/styles/image.css:646 `var(--blok-space-1-5)` = 6px — image upload cancel button
- src/styles/image.css:664 `var(--blok-space-1-5)` = 6px — image upload cancel :focus-visible
- src/styles/main.css:317 `var(--blok-space-1)` = 4px — spring-loaded block flash
- src/styles/main.css:326 `var(--blok-space-1)` = 4px — #anchor arrival pulse block
- src/styles/main.css:701 `var(--blok-space-2)` = 8px — image align popover
- src/styles/main.css:769 `var(--blok-space-3)` = 12px — lightbox toolbar bar
- src/styles/main.css:786 `var(--blok-space-2)` = 8px — lightbox toolbar button
- src/styles/main.css:809 `var(--blok-space-3)` = 12px — lightbox prev/next nav
- src/styles/media-empty.css:468 `var(--blok-space-1-5)` = 6px — embed site favicon tile
- src/styles/media-empty.css:490 `var(--blok-space-1-5)` = 6px — embed logo tile
- src/styles/media-empty.css:653 `var(--blok-space-1)` = 4px — embed kbd hint
- src/styles/media-empty.css:756 `var(--blok-space-1-75)` = 7px — empty-state URL input
- src/styles/media-empty.css:765 `var(--blok-space-1-75)` = 7px — URL input :focus
- src/styles/media-empty.css:779 `var(--blok-space-1-75)` = 7px — empty-state search box
- src/styles/popover-animation.css:119 `var(--blok-space-1-5)` = 6px — popover item in block-tunes / convert popovers
- src/styles/presence.css:58 `var(--blok-space-1)` = 4px — remote caret name label
- src/styles/slash-search.css:91 `var(--blok-space-1)` = 4px — popover custom scrollbar thumb
- src/styles/video.css:59 `var(--blok-space-1)` = 4px — selected video selection wash
- src/tools/image/alt-popover.css:11 `var(--blok-space-2-5)` = 10px — image alt-text popover (top-layer)
- src/tools/image/crop-editor.css:381 `var(--blok-space-2-5)` = 10px — crop aspect-ratio chip group
- src/tools/image/crop-editor.css:392 `var(--blok-space-1-75)` = 7px — crop aspect-ratio chip
- src/tools/image/crop-editor.css:443 `var(--blok-space-1)` = 4px — crop kbd hint
- src/tools/image/crop-editor.css:466 `var(--blok-space-2)` = 8px — crop editor buttons
- src/tools/image/crop-modal.css:73 `var(--blok-space-3-5)` = 14px — crop modal dialog

Also a border-width token used as a radius:
- src/styles/database.css:944 `var(--blok-border-width-hairline)` = 1px — list row open chevron (::after)

Tailwind `--radius-*` scale used instead of Blok tokens (CSS) — 7 rows:
- src/styles/main.css:156 `var(--radius)=0.25rem` = 4px — inline-toolbar tool button
- src/styles/main.css:179 `var(--radius-lg)=0.5rem` = 8px — settings/toolbox button (mobile)
- src/styles/main.css:198 `var(--radius-md)=0.375rem` = 6px — keyboard-navigation focused block
- src/styles/main.css:228 `var(--radius-xs)=0.125rem` = 2px — drag drop-indicator bar
- src/styles/main.css:269 `var(--radius-xs)=0.125rem` = 2px — drag drop-indicator lead bar
- src/styles/main.css:575 `var(--radius-md)` = 6px — selected embed wash
- src/styles/popover-animation.css:15 `var(--radius-xl)` = 12px — popover card (all popovers)

### (b) Raw literals (px/rem/em) in CSS — 12 rows (excluding token definitions)

- src/styles/columns.css:74 `9999px` — column resizer bar (::before)
- src/styles/emoji-picker.css:394 `15px` — empty-state art card
- src/styles/emoji-picker.css:409 `18px` — empty-state art card (middle)
- src/styles/image.css:681 `9px` — image uploading file tile
- src/styles/image.css:710 `999px` — image upload progress bar
- src/styles/main.css:163 `3px` — legacy input utility
- src/styles/main.css:171 `3px` — legacy button utility
- src/styles/main.css:179 `3px` — settings/toolbox button (desktop)
- src/styles/main.css:556 `4px` — selected list item wash
- src/styles/preflight.css:136 `0.25em` — inline code / equation-editing span
- src/styles/slash-search.css:29 `6px` — slash-search query highlight (::before)
- src/styles/slash-search.css:41 `6px` — slash-search query span

TS inline raw px (shipping code): src/tools/database/database-board-view.ts:177 (4), src/tools/database/database-board-view.ts:277 (10), src/tools/database/database-view.ts:152 (4), src/tools/database/database-view.ts:225 (8), src/tools/database/database-card-drag.ts:160 (8), src/tools/database/database-column-drag.ts:152 (10), src/tools/database/database-list-row-drag.ts:150 (8), src/tools/table/table-cell-selection.ts:1237 (2), src/tools/table/table-row-col-drag.ts:350 (1.5), src/tools/table/table-row-col-drag.ts:470 (4), src/tools/spacer/alignment-guide.ts:158 (1), src/components/shared/block-color.ts:64 (4)

Dev/console-only raw px: src/components/utils/logger.ts:84 (30), src/stories/helpers.ts:111 (8), src/stories/Tooltip.stories.ts:37 (6), src/stories/Tooltip.stories.ts:67 (6), src/stories/Table.stories.ts:158 (1), src/stories/Table.stories.ts:201 (1.5), src/stories/Table.stories.ts:915 (2)

### (c) Fallbacks

- src/styles/embed.css:20 `var(--blok-radius-md, 8px)` — fallback 8px DISAGREES with md=6px.
- src/styles/image.css:774 `var(--blok-radius-md-plus, calc(var(--blok-radius-md) + 2px))` — fallback = 8px, agrees with md-plus=8px.
- src/tools/image/crop-editor.css:300-310 `var(--blok-radius-none, 0)` — agrees with none=0.

### (d) Per-component radius tokens

- src/styles/audio.css:21 `--blok-audio-radius: var(--blok-radius-md)` = 6px — DEAD: no consumer anywhere in src/ (grep).
- src/styles/notifier-card.css:18 `--blok-toast-card-radius: 16px` (raw; equals --blok-radius-xl) — used at :54 (toast card).
- src/styles/notifier-card.css:20 `--blok-toast-tile-radius: 10px` (raw; off the Blok radius scale) — used at :125 (thumbnail), :285 (check tile).
- src/styles/notifier-card.css:41 `--blok-toast-pill-radius: 999px` (raw; equals --blok-radius-pill) — used at :216 (action button).
- src/styles/notifier-card.css:42 `--blok-toast-count-radius: 9px` (raw; off-scale; = half of the 18px badge height) — used at :173.
- src/styles/presence.css:10 `--blok-presence-caret-radius: 1px` (raw) — used at :31 (peer caret, 2px wide).
- src/styles/colors.css:469 `--blok-radius-md-plus: 8px` — global name but comment says "Image error-state radius"; used by image.css:774 and emoji-picker.css:154,172,275,450.
- src/styles/colors.css:367-368 `--blok-radius-hairline: 1.5px`, `--blok-radius-none: 0` — comment says "for the crop-editor handle notches"; also used by find.css:478.

### (e) 50% / 9999px / 999px / rounded-full / inherit / revert / 0-resets

- 50% (13): src/styles/database.css:295, src/styles/database.css:503, src/styles/database.css:1065, src/styles/image.css:188, src/styles/image.css:220, src/styles/image.css:462, src/styles/image.css:823, src/styles/image.css:879, src/styles/notifier-card.css:264, src/styles/presence.css:146, src/styles/video.css:1105, src/tools/image/crop-editor.css:186, src/tools/image/crop-editor.css:196
- 9999px literal (1): src/styles/columns.css:74
- 999px literal (not via token) (3): src/styles/colors.css:336, src/styles/image.css:710, src/styles/notifier-card.css:41
- rounded-full (1): src/styles/main.css:167
- inherit (3): src/styles/image.css:719, src/styles/notifier-card.css:300, src/styles/video.css:680
- revert (1): src/styles/preflight.css:332
- 0 resets (8): src/styles/image.css:39, src/styles/image.css:331, src/styles/media-empty.css:789, src/styles/tables.css:143, src/styles/tables.css:144, src/styles/tables.css:148, src/styles/tables.css:149, src/styles/video.css:116
- `--blok-radius-pill` (999px) via token: 43 rows.
- TS: 50% at src/tools/image/ui.ts:120,386; inherit at src/tools/file/ui.ts:54.

### (f) Scale collisions and conflicts (relevant to a new scale)

- Blok scale is out of order: `--blok-radius-xs` = 4px but `--blok-radius-sm` = 3px (colors.css:331-332). xs is used exactly once (video.css:561).
- Tailwind `--radius-*` names collide with Blok names at different values: xs 2 vs 4, sm 4 vs 3, md 6 vs 6, lg 8 vs 12, xl 12 vs 16 (isolation.css:153-161 vs colors.css:331-335).
- The main popover card radius comes from Tailwind `--radius-xl` (12px) at popover-animation.css:15, not a Blok token. The inline-toolbar popover container also gets `rounded-[14px]` (popover.const.ts:64, in `cssInline`) and the base popover `rounded-xl` (popover.const.ts:8). popover-animation.css is imported unlayered (main.css:3) while utilities are `layer(utilities)` (main.css:37) in dev; heading.css:17-22 documents that production flattens the layer. Which radius wins on the inline popover is UNVERIFIED and may differ dev vs prod.
- Database card: CSS says 8px (database.css:70, space-2) but board-view sets inline 10px (database-board-view.ts:277); inline wins. database-view.ts:225 sets 8px.
- Database list row is 4px (database.css:857) but its drag ghost is 8px (database-list-row-drag.ts:150). Board column is 10px and its ghost is 10px (agree). Card ghost 8px vs board card 10px.
- Twins that disagree: audio speed chip 3px (audio.css:681) vs video speed chip 6px (video.css:918); audio speed step 3px (audio.css:617) vs video speed step 6px (video.css:840); audio retry 6px vs file retry pill.
- Named "pill" but not pill-shaped: database drawer status pill 4px (database.css:491), image toolbar pill 4px (image.css:330).
- Effectively pills without the pill token: database column pill 20px on ~2px-padded chip (database.css:271, height not set, unverified), toast count 9px on 18px (notifier-card.css:173), slash-search popover scrollbar 4px on 4px width (slash-search.css:91), spacer guide 1px on 2px height (alignment-guide.ts:158).
- Same UI role, many values: floating mini-toolbars = 8 (embed.css:90, main.css:701 align popover), 9 (image.css:233 island), 12 (lightbox bar main.css:769); small popovers/menus = 6 (audio speed menu, video ctx), 8 (embed align, image popover), 10 (database dropdowns, alt-popover), 12 (video menu, find bar, skin panel, audio cover picker), 14 (crop modal), 16 (emoji picker, file preview); scrollbar thumbs = 3 (emoji) and 4 (database, file, popover).
- Same selector declared twice in database.css: `[data-blok-database-add-card]` is 8px at :199 and 12px at :531 (both top-level, same specificity, later wins => effective 12px; the add-card half of :199 is overridden). `[data-blok-database-add-column]` is declared at :199 and :233 (both 8px). Histograms count declarations, not effective values.
- `@utility` rows main.css:156,163,167,171,179 are live: their class names are published via `api.styles` (src/components/modules/api/styles.ts:33-69), so tools/consumers can use them.
- pill/circle is a SHAPE bucket: 11 of its 55 CSS rows are real buttons/segmented toggles (audio/video/file/toast buttons, preview toggle); pill-shaped resize/crop handles are counted under indicator/handle instead.
- Core editor chrome (popover items, toolbar plus/settings togglers, tooltip, inline toolbar, link hover card, callout/code, notifier toast shell) sets its radius via Tailwind classes in .ts and so appears only in the appendix below; the CSS histograms are dominated by block tools (audio, video, file, database, image). Appendix classes resolve on the TAILWIND scale (e.g. `rounded-lg` = 8px, not Blok lg = 12px).

## Appendix: Tailwind `rounded*` class strings in .ts (NOT classified, NOT in histograms)

Extracted from quoted strings, comment lines dropped. Bare `rounded` hits may include prose inside strings; verify before use. Resolve with the Tailwind values above.

| file:line | class |
|---|---|
| src/tools/code/constants.ts:67 | `rounded` |
| src/tools/code/constants.ts:76 | `rounded` |
| src/tools/code/constants.ts:77 | `rounded-lg` |
| src/tools/code/constants.ts:103 | `rounded-lg` |
| src/tools/code/constants.ts:104 | `rounded` |
| src/tools/code/constants.ts:105 | `rounded` |
| src/tools/spacer/index.ts:422 | `after:rounded-full` |
| src/tools/callout/emoji-picker/index.ts:484 | `rounded-xl` |
| src/tools/callout/emoji-picker/index.ts:539 | `rounded-lg` |
| src/tools/callout/emoji-picker/index.ts:559 | `rounded-lg` |
| src/tools/callout/emoji-picker/index.ts:574 | `rounded-lg` |
| src/tools/callout/emoji-picker/index.ts:776 | `rounded-xl` |
| src/tools/callout/emoji-picker/index.ts:818 | `rounded-lg` |
| src/tools/callout/emoji-picker/index.ts:1198 | `rounded-lg` |
| src/tools/callout/emoji-picker/index.ts:1602 | `rounded-lg` |
| src/tools/toggle/constants.ts:95 | `rounded` |
| src/tools/stub/index.ts:101 | `rounded-[10px]` |
| src/tools/table/table-cell-placement-picker.ts:96 | `rounded-[10px]` |
| src/tools/table/table-cell-placement-picker.ts:113 | `rounded-full` |
| src/tools/table/table-cell-placement-picker.ts:123 | `rounded-[10px]` |
| src/tools/table/table-cell-placement-picker.ts:137 | `rounded-[7px]` |
| src/tools/table/table-cell-placement-picker.ts:149 | `rounded-[7px]` |
| src/tools/table/table-cell-placement-picker.ts:176 | `rounded-[3px]` |
| src/tools/table/table-cell-placement-picker.ts:185 | `rounded-full` |
| src/tools/table/table-cell-selection.ts:51 | `rounded-sm` |
| src/tools/table/table-heading-toggle.ts:16 | `rounded-md` |
| src/tools/table/table-heading-toggle.ts:56 | `rounded-full` |
| src/tools/table/table-heading-toggle.ts:69 | `rounded-full` |
| src/tools/table/table-row-col-controls.ts:65 | `rounded-sm` |
| src/tools/table/table-add-controls.ts:32 | `rounded-sm` |
| src/shared/tool-classes/spacer.ts:17 | `rounded-md` |
| src/components/utils/notifier/draw.ts:27 | `rounded-[14px]` |
| src/components/utils/notifier/draw.ts:33 | `rounded-[7px]` |
| src/components/utils/notifier/draw.ts:38 | `rounded-[7px]` |
| src/components/utils/notifier/draw.ts:43 | `rounded-full` |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:14 | `rounded-lg` |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:41 | `rounded-md` |
| src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts:53 | `rounded` |
| src/shared/tool-classes/code.ts:31 | `rounded-xl` |
| src/shared/tool-classes/callout.ts:26 | `rounded-xl` |
| src/components/utils/tooltip.ts:90 | `rounded-lg` |
| src/components/utils/link-hover-card.ts:69 | `rounded-md` |
| src/components/utils/link-hover-card.ts:439 | `rounded-lg` |
| src/components/utils/tw.ts:89 | `rounded-sm` |
| src/components/shared/color-picker.ts:208 | `rounded-lg` |
| src/components/modules/toolbar/styles.ts:32 | `rounded-[7px]` |
| src/components/modules/toolbar/styles.ts:41 | `mobile:rounded-[6px]` |
| src/components/modules/toolbar/styles.ts:52 | `rounded-[7px]` |
| src/components/modules/toolbar/styles.ts:66 | `mobile:rounded-[6px]` |
| src/components/utils/popover/popover.const.ts:8 | `rounded-xl` |
| src/components/utils/popover/popover.const.ts:12 | `rounded-[10px]` |
| src/components/utils/popover/popover.const.ts:64 | `rounded-[14px]` |
| src/components/inline-tools/inline-tool-equation.ts:274 | `rounded-[10px]` |
| src/components/inline-tools/inline-tool-equation.ts:288 | `rounded-md` |
| src/components/inline-tools/inline-tool-link.ts:22 | `rounded-[10px]` |
| src/components/inline-tools/inline-tool-link.ts:65 | `rounded-lg` |
| src/components/inline-tools/inline-tool-link.ts:77 | `rounded-xl` |
| src/components/inline-tools/inline-tool-link.ts:78 | `rounded-[10px]` |
| src/components/inline-tools/inline-tool-link.ts:435 | `rounded-[10px]` |
| src/components/modules/toolbar/plus-button.ts:123 | `rounded-[5px]` |
| src/components/modules/toolbar/plus-button.ts:134 | `mobile:rounded-[6px]` |
| src/components/modules/drag/preview/DragPreview.ts:64 | `rounded` |
| src/components/modules/toolbar/settings-toggler.ts:127 | `rounded-[5px]` |
| src/components/modules/toolbar/settings-toggler.ts:140 | `mobile:rounded-[6px]` |
| src/components/block/style-manager.ts:22 | `rounded-[4px]` |
