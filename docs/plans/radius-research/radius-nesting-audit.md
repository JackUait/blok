# Nested radius (concentric) audit — Blok

Date: 2026-09-30. Static source reading only (no browser measurements); every value cites file:line. Read-only audit, no repo files edited.

## Basis

- Rule: ideal inner = max(0, outer − gap). Gap = outer border + outer padding + padding of non-rounded wrappers between + inner margin/offset. When h/v gaps differ both are shown and the verdict uses the smaller (other axis noted). Verdict OK = |delta| ≤ 1px. N/A = gap ≥ outer (inner keeps standalone value), outer square, not at a corner, clipped, or "arc-clear" (one axis gap ≥ outer radius).
- 16px root assumed for rem values.
- Tailwind 4.3.3 (node_modules/tailwindcss): rounded-xs 2, bare `rounded` 4 (theme key `--radius` 0.25rem, theme.css:508), rounded-sm 4, md 6, lg 8, xl 12, 2xl 16, full = pill; spacing unit 4px (`--spacing` theme.css:325). No project @theme override of radius (colors.css @theme inline has colors only; isolation.css:153-161 pins --radius-* to TW defaults).
- `--radius-xl` IS emitted (0.75rem) in dist/blok.iife.js, so popover-animation.css:15 = 12px.
- Blok tokens: colors.css:331-336 (xs 4, sm 3, md 6, lg 12, xl 16, pill 999), :469 md-plus 8, :367 hairline 1.5; --blok-space-* colors.css:345-364.
- Cascade caveat: dist/blok.iife.js contains no `@layer` (checked: 0 matches), so built CSS resolves by specificity + source order. `.rounded-[14px]:where(...)` is emitted after `[data-blok-popover-container]{border-radius:var(--radius-xl)}` (byte ~21952504), so the inline-toolbar card is 14px built vs 12px in dev (utilities layered in main.css:37). Rows A10–A19 use 14; add +2 to their deltas for dev.

## Summary

- Pairs examined: 124 (A popover family 37, B media 55, C block containers 32; 7 cross-part duplicates removed: C13=A34, C14=A35, C16=A36, C17=A36, C34=B31, C35=B19, C36=B20).
- Violations: 58; OK: 29; N/A: 37.

## Violations sorted by |delta|

| # | Area | Outer (file:line) | Outer r px | Inner (file:line) | Inner r px | Gap px (derivation) | Ideal | Actual | Delta (actual-ideal) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| B13 | file: uploading Cancel pill | .blok-file-uploading src/styles/file.css:221 | 16 | .blok-file-cancel file.css:276 | pill, ~14 effective (6+6 pad + 13px text at normal line height, unverified ~28 tall) | 13 v (1 + 12 :219); 15 h (1 + 14) | 3 | 14 | +11 | too round |
| B14 | file: error Retry pill | .blok-file-error-state file.css:312 | 16 | .blok-file-retry file.css:325 | pill, ~14 effective (same metrics as B13) | 13 v (1 + 12 :310); 15 h | 3 | 14 | +11 | too round |
| C23 | Database board: add-card in column | column database.css:52-53 | 10 | add-card `border-radius: var(--blok-space-3)` database.css:531 (later rule overrides :199 8px, same specificity) | 12 | h 8, bottom 8 (column padding; `margin-top` :529 is on the top side) | 2 | 12 | +10 | too round (inner > outer) |
| B1 | media-empty: panel in card | .blok-media-empty__card src/styles/media-empty.css:19 | 12 | .blok-media-empty__panel media-empty.css:81 | 12 | 9 (card border 1 :18 + panel margin 0 8 8 :80); bottom corners | 3 | 12 | +9 | too round |
| B2 | audio cover picker: media-empty card in picker | .blok-audio-cover-picker src/styles/audio.css:213 | 12 | .blok-media-empty__card media-empty.css:19 (appended by src/tools/audio/cover-picker.ts:76) | 12 | 9 (picker border 1 :212 + padding 8 :210; .blok-media-empty root has no padding :7-11) | 3 | 12 | +9 | too round |
| B3 | image: alt pill on picture | img src/styles/image.css:36 | 12 | .blok-image-alt-pill image.css:152 | pill, ~11 effective (h = 5+5 pad :150 + 12px mark :193 = 22) | 10 (left 10 :146; bottom 10 via top calc :144) | 2 | 11 | +9 | too round |
| C24 | Database board: column pill | column database.css:52-53 | 10 | pill `border-radius: var(--blok-space-5)` database.css:271 | min(20, h/2) ~11 (h unverified) | 8 (column padding; header top padding 0, board-view.ts:176) | 2 | ~11 | ~+9 | too round (pill; height unverified) |
| B4 | image: block-selection tint behind picture | .blok-image-inner bg-selection image.css:55 | 4 | img image.css:36 | 12 | 0 (img fills .blok-image-inner) | 4 | 12 | +8 | too round (tint shows in the 4 corners outside the img curve; outer smaller than inner) |
| B5 | video: block-selection tint behind media | .blok-video-inner bg-selection src/styles/video.css:59 | 4 | .blok-video-media video.css:31 | 12 | 0 | 4 | 12 | +8 | too round (same as B4) |
| C9 | Selection fill around a code card | selected content `rounded-[4px]` style-manager.ts:22 | 4 | code wrapper code.ts:31 | 12 | h 0 (content has no padding, block-scaffolding.ts:39-46); v 0-8 (`my-2`, margin-collapse unverified) | 4 | 12 | +8 | too round (inverted nesting: selection fill peeks out at the card's corners; fix is on the outer) |
| C10 | Selection fill around a callout | style-manager.ts:22 | 4 | callout panel callout.ts:26 (`my-1` callout.ts:40) | 12 | h 0 | 4 | 12 | +8 | too round (inverted) |
| C22 | Database board: card in column | column `border-radius: var(--blok-space-2-5)` src/styles/database.css:52, `padding: var(--blok-space-2)` :53 | 10 | card inline `style.borderRadius='10px'` src/tools/database/database-board-view.ts:277 (overrides database.css:70 8px) | 10 | h 8 (column padding) | 2 | 10 | +8 | too round (corner-adjacent only in read-only, where no add-card sits below: board-view.ts:234) |
| B6 | crop modal: ratio segmented group in dialog | .blok-image-crop-modal-dialog src/tools/image/crop-modal.css:73 (overflow hidden :82) | 14 | .blok-image-crop-editor__ratio-group src/tools/image/crop-editor.css:381 | 10 | 11 (dialog border 1 :74 + footer toolbar padding 10 :362; body/editor add 0, crop-modal.css:110); h 15 (1 + 14) | 3 | 10 | +7 | too round |
| C25 | Database card: action group | card inline 10px board-view.ts:277, `border: 1px` database.css:69 | 10 | actions `border-radius: var(--blok-space-2)` database.css:137, `top: 8px; right: 8px` :129-130 | 8 | 9 = 8 offset from padding box + 1 border | 1 | 8 | +7 | too round |
| A16 | Link "Recent" cards | popover.const.ts:64 | 14 | inline-tool-link.ts:77 `rounded-xl` | 12 | h 12; bottom 8 when last | 6 (on v) | 12 | +6 (h +10) | too round |
| A17 | Link recent tile inside recent card | inline-tool-link.ts:77 | 12 | inline-tool-link.ts:78 `rounded-[10px]` | 10 | 8 = card `p-2` (:77) | 4 | 10 | +6 | too round |
| A25 | Emoji picker remove button (top-right corner) | emoji-picker.css:26 | 16 | emoji-picker.css:75 (`--blok-space-2-25`) | 9 | 13 (as #24) | 3 | 9 | +6 | too round |
| B7 | image: selection ring around picture | ring [data-role=image-selection-ring] image.css:351, offset -6 :368-371 | 12 | img image.css:36 | 12 | 6 (ring box 6px outside the img on top/left/right) | 6 (or ring should be 18) | 12 | +6 | too round (ring and img share r12 at 6px offset) |
| C11 | Selection fill around a stub card | style-manager.ts:22 | 4 | stub `rounded-[10px] border` src/tools/stub/index.ts:101 | 10 | h 0 (`my-2.5` vertical only) | 4 | 10 | +6 | too round (inverted) |
| A24 | Emoji picker search field | emoji-picker.css:26 (`--blok-radius-xl`, beats `rounded-xl` at emoji-picker/index.ts:484) | 16 | field.css:15 (`data-blok-field` emoji-picker/index.ts:502) | 8 | border 1 (:25) + header padding 12 (:50, beats `px-3 pt-3 pb-2`) = 13 | 3 | 8 | +5 | too round |
| B8 | crop modal: primary Done button in dialog | crop-modal.css:73 | 14 | .blok-image-crop-editor__btn crop-editor.css:466 (rightmost, crop-editor.ts:180) | 8 | 11 (1 + 10); h 15 | 3 | 8 | +5 | too round |
| B9 | media-empty: large Link field submit | [data-blok-field] src/styles/field.css:16 (large variant media-empty.css:690-697) | 8 | .blok-media-empty__embed-submit media-empty.css:571, h 34 :702 | 6 | 7 (field border 1 field.css:15 + padding 6 media-empty.css:696) | 1 | 6 | +5 | too round |
| B10 | toast card: thumbnail/check tile | [data-blok-toast=card] src/styles/notifier-card.css:18,54 | 16 | tile/thumb notifier-card.css:125 / check :285 (--blok-toast-tile-radius :20) | 10 | 11 v (card border 1 from 'border' in draw.ts:29 + pad-top 10 :15); 13 h (1 + 12). Single tile only; a fanned stack adds margin 0 8px :146, so h 21 is arc-clear | 5 | 10 | +5 | too round |
| B11 | toast card without a tile: dismiss X | notifier-card.css:54 | 16 | dismiss draw.ts:43 rounded-full w-6 (24px), margin reset to 0 notifier-card.css:274 | 12 | 9 h (1 + pad-right 8 :15); v 14 (1 + 10 + (30 action row - 24)/2). With a tile the row is 40 tall, v = 19, so arc-clear | 7 | 12 | +5 | too round (only when the card has no tile/check) |
| A3 | Mobile popover items (toolbox/menus <=650px) | popover.const.ts:12 `rounded-[10px]` | 10 | popover-item-default.const.ts:14 | 8 | h 6 (px-1.5, popover.const.ts:17 applied via popover-mobile.ts:208-213); v 6 (popover.const.ts:30) | 4 | 8 | +4 | too round |
| A5 | Block settings search field | popover.const.ts:8 | 12 | field.css:15 | 8 | h 8 (popover-animation.css:101); top 8 = `margin-top` :108 | 4 | 8 | +4 | too round |
| A8 | Convert menu search field | popover.const.ts:8 | 12 | field.css:15 | 8 | h 8 (:101); top 8 = `margin: 8px 0 0` :167 | 4 | 8 | +4 | too round |
| A15 | Link suggestion row | popover.const.ts:64 | 14 | inline-tool-link.ts:22 `rounded-[10px]` | 10 | h 12; bottom 8 when last | 6 (on v) | 10 | +4 (h +8) | too round |
| A18 | Link "Remove link" button (edit mode, last row) | popover.const.ts:64 | 14 | inline-tool-link.ts:435 `rounded-[10px]` | 10 | h 12; bottom 8 | 6 (on v) | 10 | +4 (h +8) | too round |
| A19 | Equation field in direct menu | popover.const.ts:64 | 14 | inline-tool-equation.ts:274 `rounded-[10px]` | 10 | 8 (popover.const.ts:72) | 6 | 10 | +4 | too round |
| B23 | video: seek hover bubble to frame thumbnail | .blok-video-controls__seek-tooltip video.css:543 | 3 | .blok-video-controls__seek-thumb video.css:561 (--blok-radius-xs = 0.25rem = 4) | 4 | 4 (padding 4 :542) | 0 | 4 | +4 | too round (inner rounder than outer) |
| A21 | Link hover card copy/edit buttons | link-hover-card.ts:439 `rounded-lg` | 8 | link-hover-card.ts:69 `rounded-md` (hover fill) | 6 | border 1 (:458) + padding 4 top/bottom/right (:461-464) = 5 | 3 | 6 | +3 | too round |
| B15 | file: type tile in card | .blok-file-card file.css:39 | 16 | .blok-file-icon file.css:65 (40px) | 6 | 13 v (1 + 12 :36); 15 h (1 + 14) | 3 | 6 | +3 | too round |
| B16 | media-empty: header tab in card (rightmost, top-right) | card media-empty.css:19 | 12 | .blok-media-empty__tab media-empty.css:58 | 6 | 9 v (1 + header pad 8 :37); 13 h (1 + 12) | 3 | 6 | +3 | too round |
| B17 | image uploading: Cancel button in card | .blok-image-uploading__card image.css:611 | 12 | .blok-image-uploading__cancel image.css:646 (24px) | 6 | 9 v (1 + header pad 8 :617); 13 h | 3 | 6 | +3 | too round |
| B18 | embed empty: submit in URL field | [data-blok-field] field.css:16 (min-h 28 :11, border 1 :15, pad-inline 8 :14) on .blok-embed-empty__bar (src/tools/link/embed/index.ts:639) | 8 | .blok-embed-empty__submit src/styles/embed.css:215 (h 20 :210) | 7 | 4 v (1 + (26-20)/2); 9 h (1 + 8) | 4 | 7 | +3 | too round |
| C2 | Code: copy button (previewable lang, "matched") | code wrapper code.ts:31-32 | 12 | copy btn `rounded-lg`, `h-8.5` constants.ts:77 (chosen at src/tools/code/dom-builder.ts:176) | 8 | v 7 (1 + 6), h 13 (1 + 12); header is 34px tall (view-mode group = 1+2+4+20+4+2+1) so no centring offset | 5 | 8 | +3 | too round |
| C7 | Callout: selected child block fill | callout panel `rounded-xl` src/shared/tool-classes/callout.ts:26 | 12 | child content `bg-selection rounded-[4px]` src/components/block/style-manager.ts:22 | 4 | top 5 = `pt-[var(--blok-callout-padding-block,5px)]` callout.ts:38; right 16 = `pr-4` callout.ts:28; block content has no padding (src/shared/block-scaffolding.ts:39-46). Judge on 5 | 7 | 4 | -3 | too square |
| A1 | Default popover items (toolbox, code-language menu, nested desktop submenus) | popover.const.ts:8 `rounded-xl` (+ popover-animation.css:15) | 12 | popover-item-default.const.ts:14 `rounded-lg` (hover/focus fill) | 8 | h 6 = `px-1.5` popover.const.ts:17; v 6 = items `pt-1.5`/`pb-1.5` popover.const.ts:30 (+1 `mb-px` at bottom); `border-none` | 6 | 8 | +2 | too round |
| A2 | Default popover search field (code-language etc.) | popover.const.ts:8 | 12 | field.css:15 (`--blok-space-2`) | 8 | h 6 = px-1.5 (popover.const.ts:17); top 6 = `mt-1.5` popover-desktop.ts:1969 | 6 | 8 | +2 | too round |
| A6 | Block settings on mobile | popover.const.ts:12 | 10 | popover-animation.css:119 | 6 | h 8 (:101); v bottom 6 (:112) | 4 (on v) | 6 | +2 (h-axis: ideal 2, +4) | too round |
| A12 | Nested inline popover items (submenus opened from the inline toolbar) | popover.const.ts:8 (kept by popover-inline.ts:325-328) | 12 | popover-item-default.const.ts:53 `rounded` (twMerge last-wins over rounded-lg) | 4 | h 6 = `px-1.5` popover-inline.ts:327; v 6 = items pt-1.5/pb-1.5 popover.const.ts:30 | 6 | 4 | −2 | too square |
| A13 | Link menu URL field (direct menu) | popover.const.ts:64 | 14 | field.css:15 (`data-blok-field` inline-tool-link.ts:342) | 8 | h 12 = card 8 (popover.const.ts:72; `p-1.5` at toolbar/inline/index.ts:907 loses) + wrapper `px-1` inline-tool-link.ts:286; top 8 | 6 (on v) | 8 | +2 (h: ideal 2, +6) | too round |
| A14 | Link option rows (headings/kinds) | popover.const.ts:64 | 14 | inline-tool-link.ts:65 `rounded-lg` | 8 | h 12 (8 + px-1); bottom 8 | 6 (on v) | 8 | +2 (h +6) | too round |
| A26 | Emoji skin-tone tray buttons | emoji-picker.css:140 (`--blok-radius-lg`) | 12 | emoji-picker.css:154 (`--blok-radius-md-plus`) | 8 | border 1 (:139) + padding 5 (:137) = 6 | 6 | 8 | +2 | too round |
| A27 | Emoji skin-tone sliding indicator | emoji-picker.css:140 | 12 | emoji-picker.css:172 | 8 | top/left 5 (:166-167, from padding edge) + border 1 = 6 | 6 | 8 | +2 | too round |
| B12 | image: toolbar island buttons | .blok-image-toolbar__island image.css:233 | 9 | .blok-image-toolbar button image.css:315 | 4 | 3 (padding 3 :232; the ring is an inset box-shadow, not a border) | 6 | 4 | -2 | too square |
| B19 | lightbox: bottom bar buttons | .blok-image-lightbox__bar src/styles/main.css:769 | 12 | .blok-image-lightbox__btn main.css:786 | 8 | 6 (padding 6 :766; the ring is box-shadow) | 6 | 8 | +2 | too round |
| B20 | lightbox: side nav buttons | .blok-image-lightbox__nav main.css:809 (buttons appended at ui.ts:962) | 12 | .blok-image-lightbox__btn main.css:786 | 8 | 6 (padding 6) | 6 | 8 | +2 | too round |
| B21 | video: converting badge on media | .blok-video-media video.css:31 | 12 | .blok-video-converting video.css:1228 (appended to media, src/tools/video/index.ts:556) | 6 | 8 (top 8, left 8 :1225-1226) | 4 | 6 | +2 | too round |
| B22 | media-empty: Link field submit (small) | [data-blok-field] field.css:16 | 8 | .blok-media-empty__embed-submit media-empty.css:571 (h 20 :565) | 6 | 4 v (1 + (26-20)/2); 9 h | 4 | 6 | +2 | too round |
| C12 | Selection fill around a spacer | style-manager.ts:22 | 4 | spacer wrapper `rounded-md` src/shared/tool-classes/spacer.ts:17 | 6 | 0 | 4 | 6 | +2 | too round (weak: spacer paints only a hover dashed outline, src/tools/spacer/index.ts:36) |
| C27 | Database tab: rename input | tab `var(--blok-space-2-5)` database.css:623, padding 8/16 :622 | 10 | rename input `var(--blok-space-1)` + 1px border database.css:811-812 | 4 | v 8 (tab padding; input replaces the name span, src/tools/database/database-tab-bar.ts:368-374) | 2 | 4 | +2 | too round |
| C28 | Database tab overflow dropdown: item | dropdown `var(--blok-space-2-5)` database.css:702, `padding: var(--blok-space-1-5)` :704 | 10 | overflow item `var(--blok-radius-md)` database.css:775 | 6 | 6 | 4 | 6 | +2 | too round |
| C29 | Database tab overflow dropdown: "new" row | dropdown database.css:702-704 | 10 | overflow-new database.css:795 | 6 | 6 | 4 | 6 | +2 | too round |
| C30 | Database property-type popover: option | popover `var(--blok-space-2-5)` database.css:1144, padding 6 :1146 | 10 | option `var(--blok-radius-md)` database.css:1172 | 6 | 6 | 4 | 6 | +2 | too round |
| A28 | Emoji category nav buttons (bottom corners) | emoji-picker.css:26 | 16 | emoji-picker.css:311 (`--blok-space-2-25`) | 9 | h 1 + nav padding 8 (:303) = 9; v bottom ≈ 1 + 0.5 (44px nav centred in 45px footer content, :294/:297) + 4 (:303) = 5.5 | 10.5 (on v) | 9 | −1.5 (h: ideal 7, +2) | mixed (too square on v, too round on h) |
| A29 | Emoji nav indicator | emoji-picker.css:26 | 16 | emoji-picker.css:339 | 9 | same as #28 | 10.5 / 7 | 9 | −1.5 / +2 | mixed |

## Common container → child gaps

- Default Blok popover (toolbox, code-language, nested submenus): 12px card, 6px gap (`px-1.5` popover.const.ts:17, items `pt-1.5/pb-1.5` :30), no border → ideal child 6, items use 8.
- Mobile popover: 10px card (popover.const.ts:12), 6px gap → ideal 4.
- Block settings / convert menu: 8px sides (popover-animation.css:101), 6px bottom (:112), search margin-top 8 (:108/:167).
- Inline toolbar card and direct menus (link, equation): 8px all sides (`px-2 pt-2 pb-2` popover.const.ts:72); card 14 built / 12 dev.
- Overlay toolbars (image align popover, embed toolbar/align): 8px radius, 4px padding → 4px buttons, all OK.
- Lightbox bar/nav, find bar, video menu: 6px padding (+1px border on video menu) on 12px containers.
- Segmented controls: 2–3px (code view-mode 1+2, table placement picker 3, file preview toggle 1+2, crop ratio group 1+3).
- Media-empty card / audio cover picker / image uploading header: 9px (1px border + 8px padding/margin).
- Toasts, file cards, emoji picker, crop footer, image error: 11–13px (1px border + 10–12px padding).
- Database: surfaces 10px radius with 6px padding; board columns 10px with 8px padding.
- Field (field.css:15-16): 8px radius, 1px border, 8px inline padding; small submit buttons sit ~4px from its edge vertically.

## Full table

| # | Area | Outer (file:line) | Outer r px | Inner (file:line) | Inner r px | Gap px (derivation) | Ideal | Actual | Delta (actual-ideal) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Default popover items (toolbox, code-language menu, nested desktop submenus) | popover.const.ts:8 `rounded-xl` (+ popover-animation.css:15) | 12 | popover-item-default.const.ts:14 `rounded-lg` (hover/focus fill) | 8 | h 6 = `px-1.5` popover.const.ts:17; v 6 = items `pt-1.5`/`pb-1.5` popover.const.ts:30 (+1 `mb-px` at bottom); `border-none` | 6 | 8 | +2 | too round |
| A2 | Default popover search field (code-language etc.) | popover.const.ts:8 | 12 | field.css:15 (`--blok-space-2`) | 8 | h 6 = px-1.5 (popover.const.ts:17); top 6 = `mt-1.5` popover-desktop.ts:1969 | 6 | 8 | +2 | too round |
| A3 | Mobile popover items (toolbox/menus <=650px) | popover.const.ts:12 `rounded-[10px]` | 10 | popover-item-default.const.ts:14 | 8 | h 6 (px-1.5, popover.const.ts:17 applied via popover-mobile.ts:208-213); v 6 (popover.const.ts:30) | 4 | 8 | +4 | too round |
| A4 | Block settings menu items | popover.const.ts:8 | 12 | popover-animation.css:119 (`--blok-space-1-5`) | 6 | h 8 = `padding-inline` popover-animation.css:101; v bottom 6 = `padding-block-end` :112 (container pb-0); top edge is the search field | 6 (on v) | 6 | 0 (h-axis: ideal 4, +2) | OK (h +2) |
| A5 | Block settings search field | popover.const.ts:8 | 12 | field.css:15 | 8 | h 8 (popover-animation.css:101); top 8 = `margin-top` :108 | 4 | 8 | +4 | too round |
| A6 | Block settings on mobile | popover.const.ts:12 | 10 | popover-animation.css:119 | 6 | h 8 (:101); v bottom 6 (:112) | 4 (on v) | 6 | +2 (h-axis: ideal 2, +4) | too round |
| A7 | Convert menu items ("Turn into", nested or direct) | popover.const.ts:8 | 12 | popover-animation.css:119 (same `:is()` rule, :100) | 6 | h 8 (:101); v bottom 6 (:112) | 6 (on v) | 6 | 0 (h: +2) | OK (h +2) |
| A8 | Convert menu search field | popover.const.ts:8 | 12 | field.css:15 | 8 | h 8 (:101); top 8 = `margin: 8px 0 0` :167 | 4 | 8 | +4 | too round |
| A9 | Block settings heading-level tiles | popover.const.ts:8 | 12 | popover-animation.css:119 | 6 | h 8; tiles sit between search and list rows, never at a card corner | — | 6 | — | N/A (not at a corner) |
| A10 | Inline toolbar card + tool buttons | popover.const.ts:64 `rounded-[14px]` (built winner) | 14 | popover-item-default.const.ts:41 `rounded-md` | 6 | 8 all sides = `px-2 pt-2 pb-2` popover.const.ts:72; items `pt-0 pb-0` :68 | 6 | 6 | 0 | OK (dev CSS: outer 12, +2) |
| A11 | Inline toolbar convert row | popover.const.ts:64 | 14 | popover-inline.ts:175 (keeps `rounded-md`) | 6 | 8 (popover.const.ts:72) | 6 | 6 | 0 | OK |
| A12 | Nested inline popover items (submenus opened from the inline toolbar) | popover.const.ts:8 (kept by popover-inline.ts:325-328) | 12 | popover-item-default.const.ts:53 `rounded` (twMerge last-wins over rounded-lg) | 4 | h 6 = `px-1.5` popover-inline.ts:327; v 6 = items pt-1.5/pb-1.5 popover.const.ts:30 | 6 | 4 | −2 | too square |
| A13 | Link menu URL field (direct menu) | popover.const.ts:64 | 14 | field.css:15 (`data-blok-field` inline-tool-link.ts:342) | 8 | h 12 = card 8 (popover.const.ts:72; `p-1.5` at toolbar/inline/index.ts:907 loses) + wrapper `px-1` inline-tool-link.ts:286; top 8 | 6 (on v) | 8 | +2 (h: ideal 2, +6) | too round |
| A14 | Link option rows (headings/kinds) | popover.const.ts:64 | 14 | inline-tool-link.ts:65 `rounded-lg` | 8 | h 12 (8 + px-1); bottom 8 | 6 (on v) | 8 | +2 (h +6) | too round |
| A15 | Link suggestion row | popover.const.ts:64 | 14 | inline-tool-link.ts:22 `rounded-[10px]` | 10 | h 12; bottom 8 when last | 6 (on v) | 10 | +4 (h +8) | too round |
| A16 | Link "Recent" cards | popover.const.ts:64 | 14 | inline-tool-link.ts:77 `rounded-xl` | 12 | h 12; bottom 8 when last | 6 (on v) | 12 | +6 (h +10) | too round |
| A17 | Link recent tile inside recent card | inline-tool-link.ts:77 | 12 | inline-tool-link.ts:78 `rounded-[10px]` | 10 | 8 = card `p-2` (:77) | 4 | 10 | +6 | too round |
| A18 | Link "Remove link" button (edit mode, last row) | popover.const.ts:64 | 14 | inline-tool-link.ts:435 `rounded-[10px]` | 10 | h 12; bottom 8 | 6 (on v) | 10 | +4 (h +8) | too round |
| A19 | Equation field in direct menu | popover.const.ts:64 | 14 | inline-tool-equation.ts:274 `rounded-[10px]` | 10 | 8 (popover.const.ts:72) | 6 | 10 | +4 | too round |
| A20 | Equation Done button in field | inline-tool-equation.ts:274 | 10 | inline-tool-equation.ts:288 `rounded-md` | 6 | h: `border` 1 + `pr-[3px]` = 4; v: (h-9 36 − 2 border − h-7 28)/2 + 1 = 4 | 6 | 6 | 0 | OK |
| A21 | Link hover card copy/edit buttons | link-hover-card.ts:439 `rounded-lg` | 8 | link-hover-card.ts:69 `rounded-md` (hover fill) | 6 | border 1 (:458) + padding 4 top/bottom/right (:461-464) = 5 | 3 | 6 | +3 | too round |
| A22 | Color picker swatches (marker / callout / table / block) in nested popover | popover.const.ts:8 | 12 | color-picker.ts:208 `rounded-lg` | 8 | 6 (container px-1.5 / items pt-1.5) + 8 picker `p-2` (color-picker.ts:200) = 14 | 0 | 8 | — | N/A (gap ≥ outer; standalone) |
| A23 | Block-color "A" chip in settings row | popover-animation.css:119 | 6 | block-color.ts:64 inline `border-radius:4px` | 4 | item `pl-2` 8 + (24 icon box − 18 chip)/2 = 11 | 0 | 4 | — | N/A (gap ≥ outer) |
| A24 | Emoji picker search field | emoji-picker.css:26 (`--blok-radius-xl`, beats `rounded-xl` at emoji-picker/index.ts:484) | 16 | field.css:15 (`data-blok-field` emoji-picker/index.ts:502) | 8 | border 1 (:25) + header padding 12 (:50, beats `px-3 pt-3 pb-2`) = 13 | 3 | 8 | +5 | too round |
| A25 | Emoji picker remove button (top-right corner) | emoji-picker.css:26 | 16 | emoji-picker.css:75 (`--blok-space-2-25`) | 9 | 13 (as #24) | 3 | 9 | +6 | too round |
| A26 | Emoji skin-tone tray buttons | emoji-picker.css:140 (`--blok-radius-lg`) | 12 | emoji-picker.css:154 (`--blok-radius-md-plus`) | 8 | border 1 (:139) + padding 5 (:137) = 6 | 6 | 8 | +2 | too round |
| A27 | Emoji skin-tone sliding indicator | emoji-picker.css:140 | 12 | emoji-picker.css:172 | 8 | top/left 5 (:166-167, from padding edge) + border 1 = 6 | 6 | 8 | +2 | too round |
| A28 | Emoji category nav buttons (bottom corners) | emoji-picker.css:26 | 16 | emoji-picker.css:311 (`--blok-space-2-25`) | 9 | h 1 + nav padding 8 (:303) = 9; v bottom ≈ 1 + 0.5 (44px nav centred in 45px footer content, :294/:297) + 4 (:303) = 5.5 | 10.5 (on v) | 9 | −1.5 (h: ideal 7, +2) | mixed (too square on v, too round on h) |
| A29 | Emoji nav indicator | emoji-picker.css:26 | 16 | emoji-picker.css:339 | 9 | same as #28 | 10.5 / 7 | 9 | −1.5 / +2 | mixed |
| A30 | Emoji grid cells | emoji-picker.css:26 | 16 | emoji-picker.css:275 | 8 | h 1 + body 6 (:228) + scrollbar gutter both-edges (6px webkit, :231/:539) = 13; header above, footer below | — | 8 | — | N/A (only meets a corner transiently in the navless search state, while scrolled) |
| A31 | Find bar replace toggle (top-left) | find.css:95 (`--blok-radius-lg`) | 12 | find.css:252 (`--blok-radius-md`) | 6 | padding 6 (:94), no border | 6 | 6 | 0 | OK |
| A32 | Find bar close button (top-right) | find.css:95 | 12 | find.css:252 | 6 | 6 | 6 | 6 | 0 | OK |
| A33 | Find / replace fields | find.css:95 | 12 | field.css:15 | 8 | grid column 2; always has toggle to the left and controls to the right | — | 8 | — | N/A (not at a corner) |
| A34 | Table placement picker: segmented group → sliding thumb | table-cell-placement-picker.ts:123 `rounded-[10px]` | 10 | table-cell-placement-picker.ts:137 `rounded-[7px]` | 7 | `p-[3px]` (:122); the 1px ring is an inset shadow, adds nothing | 7 | 7 | 0 | OK |
| A35 | Table placement picker: group → option buttons | table-cell-placement-picker.ts:123 | 10 | table-cell-placement-picker.ts:149 | 7 | 3 | 7 | 7 | 0 | OK |
| A36 | Placement picker preview/group inside its nested popover | popover.const.ts:8 | 12 | table-cell-placement-picker.ts:96 / :123 | 10 | 6 (px-1.5 / items pt-1.5) + wrapper `p-1.5` 6 (:200) = 12 | 0 | 10 | — | N/A (gap ≥ outer) |
| A37 | Popover custom scrollbar thumb | popover.const.ts:8 | 12 | slash-search.css:91 (`--blok-space-1`, width 4 → pill) | pill | 1 (right `--blok-space-0-25`, :89) | — | pill | — | N/A (pill thumb) |
| B1 | media-empty: panel in card | .blok-media-empty__card src/styles/media-empty.css:19 | 12 | .blok-media-empty__panel media-empty.css:81 | 12 | 9 (card border 1 :18 + panel margin 0 8 8 :80); bottom corners | 3 | 12 | +9 | too round |
| B2 | audio cover picker: media-empty card in picker | .blok-audio-cover-picker src/styles/audio.css:213 | 12 | .blok-media-empty__card media-empty.css:19 (appended by src/tools/audio/cover-picker.ts:76) | 12 | 9 (picker border 1 :212 + padding 8 :210; .blok-media-empty root has no padding :7-11) | 3 | 12 | +9 | too round |
| B3 | image: alt pill on picture | img src/styles/image.css:36 | 12 | .blok-image-alt-pill image.css:152 | pill, ~11 effective (h = 5+5 pad :150 + 12px mark :193 = 22) | 10 (left 10 :146; bottom 10 via top calc :144) | 2 | 11 | +9 | too round |
| B4 | image: block-selection tint behind picture | .blok-image-inner bg-selection image.css:55 | 4 | img image.css:36 | 12 | 0 (img fills .blok-image-inner) | 4 | 12 | +8 | too round (tint shows in the 4 corners outside the img curve; outer smaller than inner) |
| B5 | video: block-selection tint behind media | .blok-video-inner bg-selection src/styles/video.css:59 | 4 | .blok-video-media video.css:31 | 12 | 0 | 4 | 12 | +8 | too round (same as B4) |
| B6 | crop modal: ratio segmented group in dialog | .blok-image-crop-modal-dialog src/tools/image/crop-modal.css:73 (overflow hidden :82) | 14 | .blok-image-crop-editor__ratio-group src/tools/image/crop-editor.css:381 | 10 | 11 (dialog border 1 :74 + footer toolbar padding 10 :362; body/editor add 0, crop-modal.css:110); h 15 (1 + 14) | 3 | 10 | +7 | too round |
| B7 | image: selection ring around picture | ring [data-role=image-selection-ring] image.css:351, offset -6 :368-371 | 12 | img image.css:36 | 12 | 6 (ring box 6px outside the img on top/left/right) | 6 (or ring should be 18) | 12 | +6 | too round (ring and img share r12 at 6px offset) |
| B8 | crop modal: primary Done button in dialog | crop-modal.css:73 | 14 | .blok-image-crop-editor__btn crop-editor.css:466 (rightmost, crop-editor.ts:180) | 8 | 11 (1 + 10); h 15 | 3 | 8 | +5 | too round |
| B9 | media-empty: large Link field submit | [data-blok-field] src/styles/field.css:16 (large variant media-empty.css:690-697) | 8 | .blok-media-empty__embed-submit media-empty.css:571, h 34 :702 | 6 | 7 (field border 1 field.css:15 + padding 6 media-empty.css:696) | 1 | 6 | +5 | too round |
| B10 | toast card: thumbnail/check tile | [data-blok-toast=card] src/styles/notifier-card.css:18,54 | 16 | tile/thumb notifier-card.css:125 / check :285 (--blok-toast-tile-radius :20) | 10 | 11 v (card border 1 from 'border' in draw.ts:29 + pad-top 10 :15); 13 h (1 + 12). Single tile only; a fanned stack adds margin 0 8px :146, so h 21 is arc-clear | 5 | 10 | +5 | too round |
| B11 | toast card without a tile: dismiss X | notifier-card.css:54 | 16 | dismiss draw.ts:43 rounded-full w-6 (24px), margin reset to 0 notifier-card.css:274 | 12 | 9 h (1 + pad-right 8 :15); v 14 (1 + 10 + (30 action row - 24)/2). With a tile the row is 40 tall, v = 19, so arc-clear | 7 | 12 | +5 | too round (only when the card has no tile/check) |
| B12 | image: toolbar island buttons | .blok-image-toolbar__island image.css:233 | 9 | .blok-image-toolbar button image.css:315 | 4 | 3 (padding 3 :232; the ring is an inset box-shadow, not a border) | 6 | 4 | -2 | too square |
| B13 | file: uploading Cancel pill | .blok-file-uploading src/styles/file.css:221 | 16 | .blok-file-cancel file.css:276 | pill, ~14 effective (6+6 pad + 13px text at normal line height, unverified ~28 tall) | 13 v (1 + 12 :219); 15 h (1 + 14) | 3 | 14 | +11 | too round |
| B14 | file: error Retry pill | .blok-file-error-state file.css:312 | 16 | .blok-file-retry file.css:325 | pill, ~14 effective (same metrics as B13) | 13 v (1 + 12 :310); 15 h | 3 | 14 | +11 | too round |
| B15 | file: type tile in card | .blok-file-card file.css:39 | 16 | .blok-file-icon file.css:65 (40px) | 6 | 13 v (1 + 12 :36); 15 h (1 + 14) | 3 | 6 | +3 | too round |
| B16 | media-empty: header tab in card (rightmost, top-right) | card media-empty.css:19 | 12 | .blok-media-empty__tab media-empty.css:58 | 6 | 9 v (1 + header pad 8 :37); 13 h (1 + 12) | 3 | 6 | +3 | too round |
| B17 | image uploading: Cancel button in card | .blok-image-uploading__card image.css:611 | 12 | .blok-image-uploading__cancel image.css:646 (24px) | 6 | 9 v (1 + header pad 8 :617); 13 h | 3 | 6 | +3 | too round |
| B18 | embed empty: submit in URL field | [data-blok-field] field.css:16 (min-h 28 :11, border 1 :15, pad-inline 8 :14) on .blok-embed-empty__bar (src/tools/link/embed/index.ts:639) | 8 | .blok-embed-empty__submit src/styles/embed.css:215 (h 20 :210) | 7 | 4 v (1 + (26-20)/2); 9 h (1 + 8) | 4 | 7 | +3 | too round |
| B19 | lightbox: bottom bar buttons | .blok-image-lightbox__bar src/styles/main.css:769 | 12 | .blok-image-lightbox__btn main.css:786 | 8 | 6 (padding 6 :766; the ring is box-shadow) | 6 | 8 | +2 | too round |
| B20 | lightbox: side nav buttons | .blok-image-lightbox__nav main.css:809 (buttons appended at ui.ts:962) | 12 | .blok-image-lightbox__btn main.css:786 | 8 | 6 (padding 6) | 6 | 8 | +2 | too round |
| B21 | video: converting badge on media | .blok-video-media video.css:31 | 12 | .blok-video-converting video.css:1228 (appended to media, src/tools/video/index.ts:556) | 6 | 8 (top 8, left 8 :1225-1226) | 4 | 6 | +2 | too round |
| B22 | media-empty: Link field submit (small) | [data-blok-field] field.css:16 | 8 | .blok-media-empty__embed-submit media-empty.css:571 (h 20 :565) | 6 | 4 v (1 + (26-20)/2); 9 h | 4 | 6 | +2 | too round |
| B23 | video: seek hover bubble to frame thumbnail | .blok-video-controls__seek-tooltip video.css:543 | 3 | .blok-video-controls__seek-thumb video.css:561 (--blok-radius-xs = 0.25rem = 4) | 4 | 4 (padding 4 :542) | 0 | 4 | +4 | too round (inner rounder than outer) |
| B24 | video: settings menu rows | .blok-video-controls__menu video.css:665 | 12 | .blok-video-controls__menu-row video.css:744 | 6 | 7 (border 1 :664 + padding 6 :663; track/pane add 0 :706-727) | 5 | 6 | +1 | OK |
| B25 | video: speed chips / steps in menu | video.css:665 | 12 | speed-chip video.css:918 / speed-step :840 | 6 | 7 | 5 | 6 | +1 | OK |
| B26 | crop editor: ratio chip in segmented group | ratio-group crop-editor.css:381 | 10 | ratio-chip crop-editor.css:392 | 7 | 4 (border 1 :380 + padding 3 :378) | 6 | 7 | +1 | OK |
| B27 | embed: link card action button | .blok-embed-linkcard embed.css:326 | 10 | .blok-embed-linkcard__action embed.css:399 (28px) | 6 | 5 h (border 1 :325 + actions pad-right 4 :382); 5 v (1 + (36 anchor [8+20+8 :337] - 28)/2) | 5 | 6 | +1 | OK |
| B28 | image: overflow popover items | .blok-image-popover image.css:391 | 8 | .blok-image-popover__item image.css:421 | 4 | 5 (border 1 :390 + padding 4 :392) | 3 | 4 | +1 | OK. The CSS is unused: no TS in src sets this class |
| B29 | embed empty: kbd hint in submit | .blok-embed-empty__submit embed.css:215 | 7 | .blok-embed-empty__kbd embed.css:254 (h 16) | 4 | 2 v (border 1 :214 + (18-16)/2) | 5 | 4 | -1 | OK |
| B30 | media-empty: kbd hint in submit | embed-submit media-empty.css:571 (h 20, ring is box-shadow) | 6 | .blok-media-empty__embed-kbd media-empty.css:653 (h 16) | 4 | 2 v ((20-16)/2) | 4 | 4 | 0 | OK |
| B31 | image: align popover buttons | .blok-image-toolbar__align-popover main.css:702 | 8 | .blok-image-toolbar button image.css:315 | 4 | 4 (padding 4 :700) | 4 | 4 | 0 | OK |
| B32 | embed: overlay toolbar buttons | .blok-embed-toolbar embed.css:90 | 8 | toolbar button/a embed.css:117 | 4 | 4 (padding 4 :91) | 4 | 4 | 0 | OK |
| B33 | embed: align popover buttons | .blok-embed-toolbar__align-popover embed.css:161 | 8 | toolbar button embed.css:117 | 4 | 4 (padding 4 :159) | 4 | 4 | 0 | OK |
| B34 | image: islands on the merged bar | .blok-image-toolbar::before image.css:245 (inset 0) | 9 | island image.css:233 | 9 | 0 (islands sit at the bar edges) | 9 | 9 | 0 | OK |
| B35 | file preview: segmented toggle indicator/buttons | .blok-file-preview-toggle file.css:874 | pill | indicator :885 / button :900 | pill | 3 (border 1 + padding 2), uniform | pill | pill | 0 | OK (pill in pill) |
| B36 | image: picture inside the loading clip | .blok-image-inner[data-loading] image.css:774→789 | 6 | img image.css:36 | 12 | 0, overflow hidden :788 | — | — | — | N/A (clipped; the visible corner is 6) |
| B37 | bookmark: cover image in card | .blok-bookmark src/styles/bookmark.css:27 (overflow hidden :25) | 12 | .blok-bookmark__image img bookmark.css:95 (no radius) | 0 | 1 (border 1 :26) | 11 | clipped to 11 | 0 | N/A (clip is padding-box = 11, so concentric automatically) |
| B38 | video: play / fullscreen buttons in bar | .blok-video-media video.css:31 (controls root appended to media, video/index.ts:758) | 12 | .blok-video-controls__btn video.css:457 (32px) | pill 16 | 10 v (bar pad-bottom 10 :440); 12 h (bar pad 12) | 2 | 16 | +14 | N/A (arc-clear: h 12 = R) |
| B39 | video: stats overlay | video.css:31 | 12 | .blok-video-controls__stats video.css:1175 | 3 | 12 (top 12, left 12 :1172-1173) | 0 | 3 | — | N/A (gap >= outer) |
| B40 | video: context menu items | .blok-video-controls__ctx video.css:1145 | 6 | ctx-item video.css:1160 | 3 | 6 (padding 6 :1144) | 0 | 3 | — | N/A (gap >= outer) |
| B41 | video: error Retry | .blok-video-error-state video.css:202 | 12 | .blok-video-retry video.css:213 | 6 | 13 (1 + 12) | — | 6 | — | N/A |
| B42 | audio: cover in card | .blok-audio-inner audio.css:102 | 12 | .blok-audio-cover audio.css:145 | 6 | 15 (border 1 :101 + pad 14 :20,99) | — | 6 | — | N/A |
| B43 | audio: speed menu chips/steps | .blok-audio-controls__speed-menu audio.css:586 | 6 | speed-chip :681 / step :617 | 3 | 9 (1 + 8 :583) | — | 3 | — | N/A |
| B44 | image error: icon tile / buttons | .blok-image-error image.css:762 | 12 | icon image.css:774 (8) / btn :789 (6) | 8 / 6 | 13 (1 + 12 :758) | — | — | — | N/A |
| B45 | alt-text popover: field | .blok-image-alt-popover src/tools/image/alt-popover.css:11 | 10 | [data-blok-field] field.css:16 | 8 | 13 (border 1 :10 + pad 12 :6) | — | 8 | — | N/A |
| B46 | media-empty: Link panel field in card | card media-empty.css:19 | 12 | embed bar [data-blok-field] field.css:16 | 8 | 18 (1 + margin 8 + transparent panel border 1 + panel pad 8 :442) | — | 8 | — | N/A |
| B47 | media-empty: site letter/logo chip in field | field.css:16 | 8 | embed-site :468 / embed-logo :490 | 6 | 9 (1 + pad-inline 8) small; 17 large | — | 6 | — | N/A |
| B48 | media-empty: type chip in large field | field.css:16 | 8 | .blok-media-empty__embed-type :734 | 3 | 17 (1 + pad-left 16 :696) | — | 3 | — | N/A |
| B49 | embed: toolbar on the iframe box | [data-role=embed-aspect] embed.css:20 | 6 | .blok-embed-toolbar embed.css:90 | 8 | 10 (top 10, right 10 :85-86) | — | 8 | — | N/A (gap >= outer) |
| B50 | image: toolbar on the picture | img image.css:36 | 12 | toolbar main.css:681 (top 10, centered :683-684) | 9 | top 10, horizontally centred | — | — | — | N/A (not at a corner) |
| B51 | file: download button next to card | .blok-file-card file.css:39 (the wrapper shares its edge) | 16 | .blok-file-download file.css:156 (32px) | pill 16 | 12 h (inset-inline-end 12 :147); v (66-32)/2 = 17 (card 40 tile + 24 pad + 2 border) | — | 16 | — | N/A (arc-clear: v 17 >= 16) |
| B52 | file preview: close/open buttons in modal | .blok-file-preview file.css:391 (overflow hidden, no border) | 16 | .blok-file-preview-close file.css:483 (32px) | pill 16 | 8 v (header pad 8 :430); 16 h | 8 | 16 | +8 | N/A (arc-clear: h 16 = R) |
| B53 | leave banner / legacy toast: buttons | banner draw.ts:27 rounded-[14px] + border (leave-banner.ts:44) | 14 | CSS.btn draw.ts:33 rounded-[7px] | 7 | 9 v (1 + py-2 8); 25 h (1 + px-6 24) | 5 | 7 | +2 | N/A (arc-clear: h 25 >= 14) |
| B54 | legacy toast: dismiss X | draw.ts:27 | 14 | dismissBtn draw.ts:43 rounded-full w-6 (margin-right -8) | 12 | h 1 + 24 - 8 = 17 | — | 12 | — | N/A (arc-clear) |
| B55 | toast card: action pills | notifier-card.css:54 | 16 | action notifier-card.css:216 (h 30) | pill 15 | h >= 45 (close column 24 + column gap 12 + 9) | — | 15 | — | N/A (arc-clear) |
| C1 | Code: copy button (non-previewable lang) | code wrapper `rounded-xl` + `border` src/shared/tool-classes/code.ts:31-32 | 12 | copy btn `rounded`, `h-7` src/tools/code/constants.ts:76 | 4 | v 7 = 1 border + header `py-1.5` 6 (constants.ts:66); h 13 = 1 + `px-3` 12. Button is 28px = header content height, so no extra centring offset | 5 | 4 | -1 | OK |
| C2 | Code: copy button (previewable lang, "matched") | code wrapper code.ts:31-32 | 12 | copy btn `rounded-lg`, `h-8.5` constants.ts:77 (chosen at src/tools/code/dom-builder.ts:176) | 8 | v 7 (1 + 6), h 13 (1 + 12); header is 34px tall (view-mode group = 1+2+4+20+4+2+1) so no centring offset | 5 | 8 | +3 | too round |
| C3 | Code: language button, non-previewable | code wrapper code.ts:31-32 | 12 | lang btn `rounded` constants.ts:67 | 4 | v 9 = 1 + 6 + (28 - 24)/2 (btn = 20px chevron icons/index.ts:136 + `py-0.5` 4; header height set by 28px copy btn); h 13 = 1 + 12 | 3 | 4 | +1 | OK |
| C4 | Code: language button, previewable | code wrapper code.ts:31-32 | 12 | lang btn constants.ts:67 | 4 | v 12 = 1 + 6 + (34 - 24)/2; h 13 | 0 | 4 | n/a | N/A (gap >= outer) |
| C5 | Code: view-mode segmented control | view-mode group `rounded-lg border p-0.5` constants.ts:103 | 8 | mode btn `rounded` constants.ts:104-105 (active fill `bg-item-hover-bg`) | 4 | 3 = 1 border + `p-0.5` 2 | 5 | 4 | -1 | OK |
| C6 | Code: view-mode group inside card | code wrapper code.ts:31-32 | 12 | view-mode group constants.ts:103 | 8 | top 7, but group sits left of the copy button (dom-builder.ts:219-222), not at a corner | — | 8 | n/a | N/A (not corner-adjacent) |
| C7 | Callout: selected child block fill | callout panel `rounded-xl` src/shared/tool-classes/callout.ts:26 | 12 | child content `bg-selection rounded-[4px]` src/components/block/style-manager.ts:22 | 4 | top 5 = `pt-[var(--blok-callout-padding-block,5px)]` callout.ts:38; right 16 = `pr-4` callout.ts:28; block content has no padding (src/shared/block-scaffolding.ts:39-46). Judge on 5 | 7 | 4 | -3 | too square |
| C8 | Callout: child code card | callout panel callout.ts:26 | 12 | code wrapper code.ts:31 | 12 | v 5 + `my-2` 8 = 13; h right 16 | 0 | 12 | n/a | N/A (gap >= outer) |
| C9 | Selection fill around a code card | selected content `rounded-[4px]` style-manager.ts:22 | 4 | code wrapper code.ts:31 | 12 | h 0 (content has no padding, block-scaffolding.ts:39-46); v 0-8 (`my-2`, margin-collapse unverified) | 4 | 12 | +8 | too round (inverted nesting: selection fill peeks out at the card's corners; fix is on the outer) |
| C10 | Selection fill around a callout | style-manager.ts:22 | 4 | callout panel callout.ts:26 (`my-1` callout.ts:40) | 12 | h 0 | 4 | 12 | +8 | too round (inverted) |
| C11 | Selection fill around a stub card | style-manager.ts:22 | 4 | stub `rounded-[10px] border` src/tools/stub/index.ts:101 | 10 | h 0 (`my-2.5` vertical only) | 4 | 10 | +6 | too round (inverted) |
| C12 | Selection fill around a spacer | style-manager.ts:22 | 4 | spacer wrapper `rounded-md` src/shared/tool-classes/spacer.ts:17 | 6 | 0 | 4 | 6 | +2 | too round (weak: spacer paints only a hover dashed outline, src/tools/spacer/index.ts:36) |
| C15 | Table placement picker: glyph | option `h-8` :148 | 7 | glyph `rounded-[3px] border` :172-177 (`w-5 h-4`) | 3 | v 8 = (32-16)/2; h >= 6 | 0 | 3 | n/a | N/A (gap >= outer) |
| C18 | Table heading toggle row in popover | popover popover.const.ts:8 | 12 | row `rounded-md` src/tools/table/table-heading-toggle.ts:16 (hover/focus fill :21-24) | 6 | h 6 = `px-1.5` (popover.const.ts:17); v 6 if first item (`pt-1.5` :27) | 6 | 6 | 0 | OK |
| C19 | Table heading toggle switch | track `rounded-full h-[18px]` table-heading-toggle.ts:54-56 | 9 (pill) | thumb `rounded-full h-[14px] top-[2px]` :66-69 | 7 (pill) | 2 uniform | 7 | 7 | 0 | OK (pill-in-pill) |
| C20 | Table selection overlay | table grid (no radius found in tables.css / table *.ts) | 0 | overlay `style.borderRadius = '2px'` src/tools/table/table-cell-selection.ts:1237 | 2 | -1 (overlay placed 1px outside the cell, :1225-1226) | 1 | 2 | +1 | OK |
| C21 | Table cell selected line-block | table cell (square) | 0 | content `rounded-[4px]` style-manager.ts:22; joins squared in src/styles/tables.css:142-150 | 4 | >= 0 | 0 | 4 | n/a | N/A (outer square) |
| C22 | Database board: card in column | column `border-radius: var(--blok-space-2-5)` src/styles/database.css:52, `padding: var(--blok-space-2)` :53 | 10 | card inline `style.borderRadius='10px'` src/tools/database/database-board-view.ts:277 (overrides database.css:70 8px) | 10 | h 8 (column padding) | 2 | 10 | +8 | too round (corner-adjacent only in read-only, where no add-card sits below: board-view.ts:234) |
| C23 | Database board: add-card in column | column database.css:52-53 | 10 | add-card `border-radius: var(--blok-space-3)` database.css:531 (later rule overrides :199 8px, same specificity) | 12 | h 8, bottom 8 (column padding; `margin-top` :529 is on the top side) | 2 | 12 | +10 | too round (inner > outer) |
| C24 | Database board: column pill | column database.css:52-53 | 10 | pill `border-radius: var(--blok-space-5)` database.css:271 | min(20, h/2) ~11 (h unverified) | 8 (column padding; header top padding 0, board-view.ts:176) | 2 | ~11 | ~+9 | too round (pill; height unverified) |
| C25 | Database card: action group | card inline 10px board-view.ts:277, `border: 1px` database.css:69 | 10 | actions `border-radius: var(--blok-space-2)` database.css:137, `top: 8px; right: 8px` :129-130 | 8 | 9 = 8 offset from padding box + 1 border | 1 | 8 | +7 | too round |
| C26 | Database card actions: buttons | actions database.css:137, `padding: var(--blok-space-0-5)` :138 | 8 | edit/menu btn `var(--blok-radius-md)` database.css:156 | 6 | 2 | 6 | 6 | 0 | OK |
| C27 | Database tab: rename input | tab `var(--blok-space-2-5)` database.css:623, padding 8/16 :622 | 10 | rename input `var(--blok-space-1)` + 1px border database.css:811-812 | 4 | v 8 (tab padding; input replaces the name span, src/tools/database/database-tab-bar.ts:368-374) | 2 | 4 | +2 | too round |
| C28 | Database tab overflow dropdown: item | dropdown `var(--blok-space-2-5)` database.css:702, `padding: var(--blok-space-1-5)` :704 | 10 | overflow item `var(--blok-radius-md)` database.css:775 | 6 | 6 | 4 | 6 | +2 | too round |
| C29 | Database tab overflow dropdown: "new" row | dropdown database.css:702-704 | 10 | overflow-new database.css:795 | 6 | 6 | 4 | 6 | +2 | too round |
| C30 | Database property-type popover: option | popover `var(--blok-space-2-5)` database.css:1144, padding 6 :1146 | 10 | option `var(--blok-radius-md)` database.css:1172 | 6 | 6 | 4 | 6 | +2 | too round |
| C31 | Database view popover: view option | Blok PopoverDesktop (database-view-popover.ts:~69) → popover.const.ts:8 | 12 | view option `var(--blok-radius-md)` database.css:723 | 6 | h 6 (`px-1.5` popover.const.ts:17) | 6 | 6 | 0 | OK |
| C32 | Database view option: icon tile | view option database.css:723, padding 7/8 :722 | 6 | icon `var(--blok-space-1-75)` database.css:738 | 7 | 7 | 0 | 7 | n/a | N/A (gap >= outer) |
| C33 | Database list row: chips / open button | row `var(--blok-space-1)` database.css:857, padding 5/8 :856 | 4 | chip database.css:911; open btn :930 | 4 | >= 5 | 0 | 4 | n/a | N/A (gap >= outer) |
| C37 | Drag preview badge | preview `fixed ...` no radius src/components/modules/drag/utils/drag.constants.ts:40 | 0 | badge `rounded bottom-1 right-1` src/components/modules/drag/preview/DragPreview.ts:64 | 4 | 4 | 0 | 4 | n/a | N/A (outer square) |
| C38 | Toggle arrow | toggle row (no bg/radius) | — | arrow `rounded` src/tools/toggle/constants.ts:95 | 4 | — | — | 4 | n/a | N/A (no rounded outer) |
| C39 | Column resizer handle | resizer gutter (no bg/radius) src/styles/columns.css:57-65 | — | `::before` pill columns.css:74 | pill | — | — | pill | n/a | N/A (no rounded outer) |

## Notes / unverified

### A (popover family)
- Tooltip (tooltip.ts:90 `rounded-lg`) has no rounded child (content is text in `px-2.5 py-1.5`, :94). Not a pair.
- Plus button and settings toggler (plus-button.ts:123, settings-toggler.ts:127, styles.ts:32/52) sit in the toolbar actions strip, which has no radius (styles.ts:20). Not a pair. On mobile each is its own card (`mobile:rounded-[6px]`) holding only an icon.
- Built vs dev: rows 10–19 use the built 14px inline card. In dev the unlayered 12px rule (popover-animation.css:15) wins, which shifts those deltas by +2. This is bundle byte-order evidence, not a browser measurement.
- The direct-menu padding of 8 in rows 13–19 comes from bundle byte order: `.px-2`, `.pt-2` and `.pb-2` come after `.p-1.5`. Not measured in a browser.
- Row 28: the footer height math assumes border-box sizing (preflight.css:29) and a 46px footer. Not measured.
- Row 12: I did not enumerate which inline-toolbar submenus render `isNestedInline` items. Convert overrides this row's radius through popover-animation.css:119, which gives row 7.
- The inline emoji picker (`[data-emoji-picker-inline]`, emoji-picker.css:190-219) is not audited.
- Rule 5's "judge on the smaller gap" makes the rows with unequal gaps (4, 6, 7, 13–16, 18) look milder than they are. On the horizontal axis they read +2 to +10 too round.

### B (media)
- Everything is from static CSS reading. No browser measurements were taken.
- Heights that depend on font line-height are estimates: B13 and B14 (pill about 28px tall) and B11. They are marked in the rows. A different measured height changes the pill's effective radius and the vertical gap.
- The cascade was checked for the toast. `[data-blok-toast=card]` (un-layered, notifier-card.css:53-54,64) beats the layered `rounded-[14px] py-2 px-6 overflow-hidden` from draw.ts:18-29. The `border` utility is not overridden, so the card keeps a 1px border.
- The toast dismiss button's `-mr-2` is reset by `margin: 0` at notifier-card.css:274, but only for card toasts.
- Dead CSS, listed for completeness: `.blok-image-popover*` (image.css:385-446) and `.blok-image-toolbar__pill` (image.css:330). Neither class is set by any TS under src/.
- B4 and B5 are inverted pairs: the outer tint (r4) is smaller than the inner media (r12), so the tint shows in the corners. That may be intended as a "selected" frame.
- B7: the ring is outer and the picture inner. To be concentric at the 6px offset, the ring would need r18 (or the pair would need a smaller offset).
- The arc-clear rows (B38, B51, B52, B53) sit at or past the corner arc on one axis. By the strict smaller-gap rule they would read as too round by +14, +12, +8 and +2.
- `--blok-radius-md` resolves to 6 wherever the embed.css:20 fallback `8px` appears. colors.css defines the token, so the fallback never applies.
- Audio `.blok-audio-error-state` (audio.css:754) is appended to the tool root (audio/index.ts:596), not nested inside the card. It is not a nested pair.

### C (block containers)
- No browser measurement. Rows 7 and 9–12 assume the child/tool element's vertical margin behaviour (margin collapse through `[data-blok-element-content]`, which has no padding or border). The horizontal gap of 0 (rows 9–12) and the 5px callout top padding (row 7) come straight from the classes. If a child paragraph's `mt-px` lands inside the fill, row 7 becomes gap 6, ideal 6, delta -2. It is still too square.
- Rows 9–12 are inverted nesting. The rounded card is the inner element and the 4px selection fill is the outer. The fill shows at the card's corners. The natural fix is on the outer (match the fill's radius to the card), not the inner.
- Row 24: the pill height is not measured. Padding is 2px top and bottom (database.css:270), but font-size and line-height were not resolved.
- Rows 22–23: the card and add-card sit on the column's side padding. Their bottom corners meet the column's bottom corners only when they are last. add-card is last in edit mode, and the last card is last in read-only mode.
- Rows 34–36 live in main.css but belong to the image tool. The media fork may report them too, so dedupe.
- Presence caret label (presence.css:58), checklist checkbox (checklist.css:12), spring-loaded/target pulse fills (main.css:317, :326), database drawer controls, and table add pills and grips (table-add-controls.ts:32, table-row-col-controls.ts:65, table-cell-selection.ts:51) have no rounded container around them with a gap. They are standalone and not tabulated.
- heading.css and resize-cue.css declare no border-radius (grep).
