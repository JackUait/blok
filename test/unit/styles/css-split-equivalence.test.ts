/**
 * Golden-snapshot equivalence test for the main.css split refactor.
 *
 * Produces a normalized, cascade-order-preserving dump of every rule reachable
 * from src/styles/main.css via local @import. Each split step must keep this
 * snapshot byte-identical — otherwise the visual cascade has shifted even if
 * the files compile.
 *
 * Covers:
 *   1. Rule set equivalence (selectors + declarations + at-rule wrappers).
 *   2. Source-order preservation (declarations remain in emission order;
 *      rules are listed in resolved-@import order).
 *   3. @keyframes name uniqueness (silent shadow = silent breakage).
 *   4. Total authored CSS byte budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Declaration } from 'postcss';
import postcss from 'postcss';

const STYLES_ROOT = resolve(__dirname, '../../../src/styles');
const ENTRY = resolve(STYLES_ROOT, 'main.css');

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

/**
 * Recursively inline local @import statements (./ or ../) starting from the
 * entry file. Package imports (e.g. 'tailwindcss/utilities.css') are skipped
 * because their output is part of the framework, not the blok surface under
 * refactor.
 */
function inlineLocalImports(filePath: string, seen = new Set<string>()): string {
  if (seen.has(filePath)) return '';
  seen.add(filePath);
  const source = readFileSync(filePath, 'utf-8');
  const baseDir = dirname(filePath);

  return source.replace(
    /@import\s+['"]([^'"]+)['"]\s*;?/g,
    (match, spec: string) => {
      if (!spec.startsWith('.')) return match;
      const resolved = resolve(baseDir, spec);

      return `\n/* <<< inlined ${spec} */\n${inlineLocalImports(resolved, seen)}\n/* >>> end ${spec} */\n`;
    }
  );
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

type RuleRecord = {
  path: string;
  selector: string;
  declarations: Array<{ prop: string; value: string; important: boolean }>;
};

/**
 * Walk every Rule node, capturing the chain of enclosing at-rules (media,
 * supports, layer) so the snapshot distinguishes `.x{color:red}` inside and
 * outside `@media (prefers-color-scheme: dark)`.
 */
function buildRuleIndex(css: string): RuleRecord[] {
  const root = postcss.parse(css);
  const records: RuleRecord[] = [];

  function visit(node: postcss.Container, pathParts: string[]): void {
    node.each((child) => {
      if (child.type === 'rule') {
        const rule = child;
        const declarations: RuleRecord['declarations'] = [];

        rule.walkDecls((decl: Declaration) => {
          declarations.push({
            prop: decl.prop,
            value: normalizeValue(decl.value),
            important: decl.important,
          });
        });
        records.push({
          path: pathParts.join(' > '),
          selector: normalizeValue(rule.selector),
          declarations,
        });
      } else if (child.type === 'atrule') {
        const atrule = child;
        // @keyframes live in the global animation-name namespace and do not
        // participate in the cascade. They are snapshotted separately so
        // extraction can regroup them into a dedicated file.
        if (atrule.name === 'keyframes' || atrule.name === '-webkit-keyframes') return;
        const header = `@${atrule.name} ${normalizeValue(atrule.params)}`.trim();

        if (atrule.nodes) {
          visit(atrule, [...pathParts, header]);
        } else {
          // Leaf at-rule (e.g. @import unresolved, @charset) — record as pseudo-rule.
          records.push({
            path: pathParts.join(' > '),
            selector: header,
            declarations: [],
          });
        }
      }
    });
  }
  visit(root, []);

  return records;
}

type KeyframeRecord = {
  name: string;
  body: string;
};

function buildKeyframeIndex(css: string): KeyframeRecord[] {
  const root = postcss.parse(css);
  const records: KeyframeRecord[] = [];

  root.walkAtRules((atrule) => {
    if (atrule.name !== 'keyframes' && atrule.name !== '-webkit-keyframes') return;
    const steps: string[] = [];

    atrule.walkRules((stepRule) => {
      const decls: string[] = [];

      stepRule.walkDecls((decl) => {
        decls.push(`${decl.prop}: ${normalizeValue(decl.value)}${decl.important ? ' !important' : ''}`);
      });
      steps.push(`${normalizeValue(stepRule.selector)} { ${decls.join('; ')} }`);
    });
    records.push({
      name: normalizeValue(atrule.params),
      body: steps.join('\n  '),
    });
  });
  records.sort((a, b) => a.name.localeCompare(b.name));

  return records;
}

function collectKeyframeNames(css: string): string[] {
  const root = postcss.parse(css);
  const names: string[] = [];

  root.walkAtRules((atrule) => {
    if (atrule.name === 'keyframes' || atrule.name === '-webkit-keyframes') {
      names.push(normalizeValue(atrule.params));
    }
  });

  return names;
}

function serializeSnapshot(records: RuleRecord[]): string {
  return records
    .map((rec) => {
      const header = rec.path ? `[${rec.path}] ${rec.selector}` : rec.selector;
      const body = rec.declarations
        .map((d) => `  ${d.prop}: ${d.value}${d.important ? ' !important' : ''};`)
        .join('\n');

      return `${header} {\n${body}\n}`;
    })
    .join('\n\n');
}

function localImportedByteBudget(filePath: string, seen = new Set<string>()): number {
  if (seen.has(filePath)) return 0;
  seen.add(filePath);
  const source = readFileSync(filePath, 'utf-8');
  const baseDir = dirname(filePath);
  let total = statSync(filePath).size;

  for (const match of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];

    if (!spec.startsWith('.')) continue;
    total += localImportedByteBudget(resolve(baseDir, spec), seen);
  }

  return total;
}

describe('main.css split — cascade-preserving equivalence', () => {
  const inlined = inlineLocalImports(ENTRY);

  it('rule set + source order matches the golden snapshot', async () => {
    const records = buildRuleIndex(inlined);
    const serialized = serializeSnapshot(records);

    await expect(serialized).toMatchFileSnapshot(
      resolve(__dirname, '__snapshots__/main-css-rules.snap.txt')
    );
  });

  it('every @keyframes name is defined exactly once', () => {
    const names = collectKeyframeNames(inlined);
    const duplicates = names.filter((n, idx) => names.indexOf(n) !== idx);

    expect(duplicates).toEqual([]);
  });

  it('@keyframes bodies match the golden snapshot (name-sorted, order-independent)', async () => {
    const records = buildKeyframeIndex(inlined);
    const serialized = records
      .map((r) => `@keyframes ${r.name} {\n  ${r.body}\n}`)
      .join('\n\n');

    await expect(serialized).toMatchFileSnapshot(
      resolve(__dirname, '__snapshots__/main-css-keyframes.snap.txt')
    );
  });

  it('total local CSS byte size stays within the measured budget', () => {
    // Pre-split baseline captured 2026-04-22 immediately before the split refactor
    // started. Overhead budget covers per-file headers/comments added during
    // extraction plus later feature additions (crop-modal close animation,
    // image caption readOnly carve-out, [data-blok-top-layer] scope selectors,
    // image loading shimmer placeholder + keyframes (#41), columns tool:
    // columns.css + vertical drop-indicator rules + column-enter keyframes +
    // inline-popover instant-open rule, embed tool: embed.css full-width figure
    // + edge resize-handle rules + hover toolbar (alignment/caption/open-original/
    // more popover) + caption field rules, bookmark tool: bookmark.css Notion-style
    // link preview card + placeholder states, file tool: file.css Airbnb-style
    // attachment card + coral icon tile + dropzone empty state + segmented
    // upload/link tabs + uploading/error states + card hover/press animations +
    // text/code/markdown preview modal styles (loading, pre, md, raw/render
    // toggle, error+download, task-list items) + editorial markdown document
    // typography (heading scale, reading column, styled tables/code/quotes,
    // segmented Rendered/Raw control) + advanced markdown preview features
    // (GitHub alert callouts in 5 semantic palette colours + footnotes trailer
    // styling)), embed tool empty state: hero card (glyph + label + URL pill
    // with inline submit + ↵ reveal + read-only chip), media empty state:
    // tab-swap height/cross-fade animation clip rule, video tool: video.css
    // (Airbnb-style media frame + caption + alignment + resize handles + error
    // state + custom Airbnb-inspired player controls: click-to-toggle media,
    // bottom scrim, coral scrubber, time, volume cluster, fullscreen) +
    // always-on video-player palette tokens in colors.css + YouTube-parity
    // player upgrades (buffered/loaded bar + hover time tooltip + bottom mini
    // progress, gear settings popover for speed/loop/sleep/stable-volume, view
    // modes: picture-in-picture + theater cinema-width breakout + ambient glow
    // canvas, polish: idle auto-hide + centre play disc + buffering spinner +
    // elapsed/remaining time toggle + focus-visible rings + right-click context
    // menu + stats-for-nerds overlay) + --blok-video-buffered token + ambient
    // glow play/pause fade (data-active opacity transition so the bloom fades in
    // on play and out on pause instead of freezing the last frame).
    // Video settings-menu visual upgrade: frosted-glass edge + leading icon glyphs
    // per row (speed/loop) + sculpted selected-speed wash + spring check +
    // reduced-motion-gated entrance + brighter hover values.
    // Video settings-menu fixes: figure-mounted menu (escapes the media overflow clip
    // so it spills out of a short player) + --blok-video-control-bg-active token for the
    // selected gear/theater/PiP toggle fill.
    // Video speed-submenu entry cascade: blok-video-menu-rise keyframe + reduced-motion
    // -gated per-row staggered animation (--row index) so the rate list lifts into place
    // instead of snapping in as a rigid block.
    // Video "Minimal" glow level: new default ambient-glow intensity (data-glow="minimal"
    // opacity rule) — a barely-there bloom, sits below "Less".
    // Video speed-submenu morph redesign: layered depth-swap (parked pane recedes —
    // fades + scale(0.92) — while the entering pane pushes forward, so the view-switch
    // reads as depth rather than a flat sideways slide) + spring track-slide with mild
    // overshoot + longer 320ms height/slide so the motion is actually legible at real
    // speed + transform-only rise keyframe (rows lift instead of fade-stacking).
    // Video YouTube-style speed control: replaced the discrete radio list with a live
    // readout + round −/＋ steppers + a continuous 0.05-step slider (JS-driven fill via
    // --blok-speed-pct) + a row of preset chips (0.5×/1×/1.5×/2×, "Normal" caption under
    // 1×); section-staggered settle on submenu entry.
    // Video custom fullscreen surface: caption surfaced as a top title bar (YouTube-style
    // scrim + typography, fading with the control bar) + inline-width override so a
    // resized player fills the whole screen in fullscreen.
    // Audio tool: audio.css — Airbnb-neutral "now playing" card (cover art + title +
    // artist + waveform + slim control bar: play/pause, time, volume cluster, gear
    // speed menu, loop toggle; waveform seek vars; empty/loading/error state styles).
    // Audio full-width redesign: card is now a CSS grid (cover + body row, full-width
    // caption footer with hairline), always 100% wide (resizer removed), tall stretched
    // cover panel + music-note placeholder, hero 56px waveform, larger filled play puck,
    // gear-anchored speed menu, loop active = solid black. +~3KB intentional growth.
    // Audio "alive" motion pass: staggered mount entrance (blok-audio-rise), reduced-motion
    // gated. +~2.5KB intentional growth. (The cover equalizer badge and the play-puck
    // heartbeat ring that shipped with this pass were later removed — both read as noise.)
    // Audio caption add/remove animation: caption row is a collapsing grid wrapper
    // (grid-template-rows 1fr↔0fr + opacity) with an inner padding/border element,
    // a .is-collapsed state, and a reduced-motion transition:none — so toggling the
    // Caption setting glides the row in/out instead of snapping. +~0.8KB intentional growth.
    // Audio no-cover placeholder redesign: the flat grey "missing image" music-note
    // glyph is replaced by a glossy black vinyl record drawn in pure CSS — a near-black
    // overlay-dark face + fine repeating-radial-gradient grooves + a small cream label
    // + a crisp spindle hole, with a FIXED specular glint (placeholder::after) the
    // grooves shimmer under as the disc spins. The disc always owns the spin animation
    // but holds animation-play-state:paused until data-playing, so play/pause freezes
    // and resumes the angle instead of snapping. A CSS tonearm (brushed-metal arm +
    // pivot bearing + dark headshell/needle) is mounted top-right: parked off the disc
    // at rest, it swings the needle down onto the record while data-playing, and a soft
    // conic shine wedge sweeps round with the grooves so the spin reads. Reduced-motion
    // gated (arm snaps, disc holds). +~3KB intentional growth.
    // Audio vinyl realism pass: the disc gains a centre→edge vignette + glossy outer
    // bevel, finer grooves, a fixed two-band specular "bow-tie" reflection (masked off
    // the label) and a matte off-white label with a printed ring. The tonearm is rebuilt
    // from real parts (extra DOM nodes in ui.ts): a FIXED pivot base/deck mount anchors a
    // rotating brushed-aluminium tube (specular glint); the tube carries a cylindrical
    // counterweight on a rear stub behind the pivot (adjustment dial + end-cap) and an
    // angled headshell with a cartridge body and a stylus tip at the playing end. The
    // headshell itself rotates on touchdown (a delayed spring on [data-playing]) so the
    // cartridge seats down into the groove as the stylus lands, like a real arm.
    // +~6KB intentional growth.
    // Audio tonearm rebuilt as ONE cohesive SVG object (drawn in ui.ts, not stacked
    // CSS boxes): tube, gimbal pivot, counterweight, headshell, cartridge and a diamond
    // stylus, all under a single light source + shared drop shadow so it reads as a real
    // arm instead of layered sprites. This MOVED the bulk of the arm out of CSS into the
    // SVG markup, so audio.css actually SHRANK (~7KB) versus the prior CSS-parts arm —
    // only the svg's layout/swing/contact rules and the metal/cart tokens remain in CSS.
    // Shrinking below the baseline is always acceptable.
    // Audio no-cover redesign: the tonearm is removed entirely (SVG + all arm tokens/
    // rules deleted) and the disc becomes the hero — enlarged to fill the freed panel,
    // with its spin now driven by disc.ts (inertial transform: spins up on play, coasts
    // down on pause) instead of a CSS keyframe. Net SHRINK in audio.css.
    // Drag drop-indicator: list-item drop lines gained a grayish lead-in
    // (::after rule + lead-bg tokens) drawn from the editor's left edge to the
    // coloured line. ~1KB intentional growth.
    // H11 shared invalid-field convention: a global `[aria-invalid="true"]`
    // destructive-ring rule (border-color + focus box-shadow) in media-empty.css
    // so link/equation/embed inputs share one look. ~0.3KB intentional growth.
    // Scrollbar gutter + system-like auto-hide: every vertical scroll container
    // (popover items, emoji picker, database drawer, file previews) reserves
    // scrollbar space (scrollbar-gutter: stable + classic ::-webkit-scrollbar)
    // with the thumb transparent at rest and revealed on hover/scroll; standard
    // scrollbar-width/color moved into Firefox-only @supports blocks because
    // they disable webkit scrollbar styling in Chromium. ~2KB intentional growth.
    // Table-cell font scale: a `font-size: inherit !important` rule in tables.css
    // forces cell blocks (any [data-blok-tool] root) and list items to honour the
    // cell's text-sm scale instead of a tool's inline font-size (paragraph
    // styles.size, list itemSize), so no block outsizes its neighbours inside a
    // cell. Guarded by table-cell-font-scale-law.test.ts. ~0.4KB intentional growth.
    // Fluid image chrome: caption font, Alt/"..." toolbar buttons+svg, and resize
    // handles scale with the figure's width via container queries (cqw clamps) so
    // small images don't get oversized chrome. See image.css. ~0.6KB intentional growth.
    // master merge: the docs/airbnb-redesign preflight rework (all resets moved
    // into @layer base) landed alongside master's own CSS additions (inline-code
    // surface, <mark> UA-highlight reset, table-cell font scale, fluid image
    // chrome, etc.); combining both branches' growth pushes the imported bytes
    // past the 1.365 ceiling, so the headroom multiplier is nudged to 1.372.
    // ~2KB combined growth.
    // Columns stranded-separator fix: a `display: none` rule hiding the
    // leading/trailing/adjacent [data-blok-column-resizer] separators so a
    // removed column no longer leaves a phantom resize bar; this nudges the
    // imported bytes past the 1.372 ceiling, so the multiplier is bumped to
    // 1.376. ~0.8KB intentional growth.
    // Audio error-state callout: the audio tool's ERROR state (surfaced by the
    // Google Drive link feature) previously rendered unstyled — audio.css only
    // themed a `.blok-audio-inner` that renderError never creates. Added the
    // flat soft-danger callout + retry button mirroring video.css, bumping the
    // multiplier to 1.379. ~1.1KB intentional growth.
    // Replaced-element width cap: preflight gains a `max-width: 100%` rule for
    // iframe/embed/object (img/video were already capped) so a fixed
    // width="…" attribute — e.g. a Google Drive <iframe width="640"> snippet
    // stored in block data — can never overflow its column and overlap
    // siblings. Bumps the multiplier to 1.381. ~0.4KB intentional growth.
    // Host customization tokens: public --blok-* hooks (search-input
    // placeholder color, content max-width override, list start padding,
    // redactor gutters) replacing hosts' internal-selector hacks; see
    // host-customization-tokens.test.ts. Bumps the multiplier to 1.383.
    // ~0.5KB intentional growth.
    // 2026-07-18: read-only gutter auto-collapse rule (:where([data-blok-readonly]) [data-blok-redactor]) in main.css adds 353 bytes of intentional growth (407500 → 407853).
    // 2026-07-18: heading/embed host-customization tokens (heading.css) add ~1.9KB intentional growth. Bumps the multiplier to 1.388.
    // 2026-07-18: code-review fix — revived the dead --blok-heading-line-height token
    // (removed the layered `leading-[1.3]!` from header BASE_STYLES so the unlayered
    // heading.css line-height rule can actually win the cascade) and expanded the
    // heading.css doc comment explaining the cascade-layer mechanics; ~0.6KB
    // intentional growth. Bumps the multiplier to 1.39.
    // 2026-07-18: final-review round 2 — re-keyed the six per-level heading.css rules
    // from `hN[data-blok-tool="header"]` to `[data-blok-tool="header"][data-blok-heading-level="N"]`
    // (so a level remapped to a custom tag via levelOverrides[n].tag still matches its
    // level's rule) and moved the shared line-height into the single `[data-blok-tool="header"]`
    // rule; the longer attribute selectors and expanded doc comment add ~0.4KB. Bumps the
    // multiplier to 1.392.
    // 2026-07-18: final-review round 3 — wrapped all seven heading.css selectors in
    // :where(...) so the unlayered per-level rules drop to (0,0,0) specificity; without
    // this, headings nested under [data-blok-toggle-children] (callouts/toggles) lost the
    // main.css `mt-px` override and regained root-level margin-top. ~0.1KB from the
    // `:where(...)` wrapper text plus expanded doc comment. Bumps the multiplier to 1.393.
    // 2026-07-18: production-cascade fix (round 4) — live CSSOM inspection of the built
    // bundle found the heading tokens and the read-only gutter collapse were both dead in
    // production (Tailwind utilities compile unlayered/scoped at (0,1,0) in prod; `@layer
    // utilities` only exists in dev). Re-keyed heading.css to (0,1,0) (plain shared
    // selector; :where() wraps only the tool-attr on per-level selectors) so it ties prod
    // utilities and wins by source order, and replaced the gutter-collapse padding override
    // with a `:where([data-blok-readonly])` token redeclaration (custom properties are
    // immune to logical-property lowering). Expanded doc comments in both files account for
    // most of the ~1.8KB growth. Bumps the multiplier to 1.397.
    // 2026-07-18: table text density — tables.css gained the
    // [data-blok-table-text-size="comfortable"] cell rule plus its doc comment
    // (~0.6KB) for the new compact/comfortable switch in the table settings
    // menu. Bumps the multiplier to 1.399.
    // 2026-07-19: editor gutter default — main.css gained the
    // :where([data-blok-interface]) { --blok-editor-gutter-start: 56px }
    // rule plus its doc comment so Blok owns the 56px floating-controls
    // gutter instead of hosts hardcoding it. Bumps the multiplier to 1.4.
    // 2026-07-19: checklist padding token — main.css gained the
    // [data-list-style] / [data-list-style="checklist"] --_blok-list-pad
    // indirection rules plus their doc comment so hosts can indent
    // checklists independently of bulleted/ordered lists. Bumps the
    // multiplier to 1.402.
    // 2026-07-19: image control size tiers — replaced the fluid cqw clamps
    // with fixed control sizes plus a data-tier="medium" rule (hides
    // caption/replace/download on mid-width figures) and an @container
    // display-text step; the three medium-tier selectors outweigh the removed
    // clamps by ~0.3KB. Bumps the multiplier to 1.403.
    // 2026-07-20: hideToolbar gutter collapse + block placeholder token —
    // main.css gained the :where([data-blok-toolbar-hidden]) token
    // redeclaration (config.hideToolbar was dead config; hosts hacked the
    // gutter away with !important) and colors.css gained
    // --blok-placeholder-color / --color-block-placeholder so hosts recolor
    // empty-block placeholders without targeting internals. Bumps the
    // multiplier to 1.405.
    // 2026-07-20: native selection opt-out — preflight.css gained the
    // :where(:not([data-blok-native-selection])) gate on the editor
    // ::selection rule and colors.css gained the source-order-sensitive
    // :where([data-blok-native-selection]) { --blok-selection-inline:
    // Highlight } block (plus doc comments) so hosts can fall back to
    // native/UA selection colors instead of fighting Blok's repaint with
    // `revert !important`. Bumps the multiplier to 1.408.
    // 2026-07-20: block padding tokens — the blok-block utility in main.css
    // routes its padding through --blok-block-padding-top/-bottom/-inline
    // (plus a doc comment) so read-only hosts get tight inline rendering
    // without blanket-overriding [data-blok-tool]. Bumps the multiplier
    // to 1.409.
    // 2026-07-21: embed adjustable height — embed.css gained the
    // [data-edge="bottom"] resize-handle rules (rotated pill + ns-resize
    // cursor + hover/active scale) for height-resizable document embeds
    // (~0.5KB, landed in feat(embed) 0447dd89 without its ledger entry).
    // Bumps the multiplier to 1.411.
    // 2026-07-22: gutter collapse retargeted from plain read-only to
    // chromeless read-only — the [data-blok-readonly] token collapse became
    // [data-blok-controls-hidden] with an expanded doc comment explaining
    // why plain read-only keeps its gutter (in-place readOnly.set() flips
    // must not shift layout; the copy-link hover control lives there).
    // Bumps the multiplier to 1.412.
    // 2026-07-27: slash-search caret sizing — slash-search.css re-keyed the
    // pill to the input's own metrics (inline-block + explicit caret rules,
    // ~0.7KB, landed in fix(toolbox) b2748749 without its ledger entry).
    // Bumps the multiplier to 1.414.
    // 2026-07-27: callout emoji swap animation — keyframes.css gained
    // blok-callout-emoji-jump-in (spring landing with squash) and
    // blok-callout-emoji-knock-out (old emoji tips over and falls) plus their
    // doc comment (~0.9KB) for the picker swap choreography. Bumps the
    // multiplier to 1.417.
    // 2026-08-01: font-scale alignment — the callout emoji's heading offsets in
    // main.css became `calc()` derivations of the heading size/line-height tokens
    // instead of the literals 8.5px / 4.6px / 2px, which only centred the emoji at
    // the default heading sizes (~0.5KB of formula text, the private
    // --_blok-callout-heading-size / --_blok-callout-emoji-line tokens the R2
    // literal-repeat law requires, and the doc comment). Bumps the multiplier
    // to 1.419.
    // 2026-08-01: bookmark card font-scale — bookmark.css moved its padding,
    // line boxes, gaps and favicon off absolute px onto the title token and em
    // (~0.9KB of calc()/token text plus the doc comment explaining which of the
    // two bases each metric resolves against). Bumps the multiplier to 1.421.
    // 2026-08-04: embed link-card fallback — embed.css gained the
    // .blok-embed-linkcard rules (card container, anchor, glyph/host/url/open
    // segments and the hover-revealed actions cluster) for the safe link-card
    // rendered when an embed origin isn't trusted (~2.3KB, landed in
    // feat(embed) 217a3234 without its ledger entry). Bumps the multiplier
    // to 1.428.
    // 2026-08-05: link field reveal — the [data-link-suggestion] /
    // [data-blok-link-tool-error] reveal animation and its blok-link-reveal
    // keyframes (~0.4KB) landed without their ledger entry, which is why this
    // budget and both golden snapshots were already red before the entry below.
    // 2026-08-05: column shrink floor — columns.css declares
    // `min-width: var(--blok-column-min-width, 0)` on the column holders (plus
    // the comment explaining why the floor moved off the inline style and why
    // no default is declared on the row container), ~0.6KB. Together these bump
    // the multiplier to 1.430.
    // 2026-08-05: block nesting indent moved off the inline style — main.css
    // gained the `:where([data-blok-element])` margin rule (multiplier x step)
    // and the `:where([data-blok-nested-blocks])` step reset, plus the comment
    // explaining why the step has to inherit rather than be decided in JS
    // (~1.2KB). Bumps the multiplier to 1.434.
    // 2026-08-13: WCAG AA contrast pass — the grey text token darkened to
    // #646a79 (it measured 4.55:1 on white, so it failed on every TINTED
    // surface: 4.28:1 on bg-secondary, 3.95:1 under the 8% hover tint), a
    // dedicated `--blok-inline-code-text` declared across all three theme
    // blocks so inline code stops borrowing the Marker red that is persisted
    // into saved documents, `--blok-link` darkened to #1b6fc2, and embed.css
    // moved its two TEXT consumers off the decorative `--blok-text-tertiary`
    // tier (~1.3KB), and the database column pill + add affordance opt out of the
    // Marker palette onto a dedicated on-pill colour (every light
    // --blok-color-*-text fails AA on its own --blok-color-*-bg, from yellow at
    // 2.30:1 to purple at 4.09:1, and that palette is persisted into saved
    // documents so it cannot be retuned). Bumps the multiplier to 1.439.
    // 2026-08-20: cross-block text selection — main.css gained the
    // `[data-blok-cross-selection] ::selection` suppression and the
    // `::highlight(blok-cross-block-selection)` colour, plus the comment
    // recording why they are unlayered and why the native paint has to be
    // switched off at all (~0.7KB). Bumps the multiplier to 1.441.
    // 2026-08-21: block-controls side (config.toolbarPosition) — main.css
    // gained the `:where([data-blok-toolbar-position="right"])` gutter swap and
    // the LTR/not-mobile rule that docks the actions bar to the content
    // column's far edge, plus the comments recording why the swap must sit
    // between the gutter default and the two collapse rules and why the second
    // rule is physical rather than logical (~1.1KB). Bumps the multiplier
    // to 1.445.
    // 2026-08-31: multiplayer presence — presence.css holds the whole surface
    // (holder outline keyed off --blok-presence-color, the peer name label, the
    // avatar stack and its overflow chip), all of it attribute-selected so no
    // rule reaches into a tool root, plus its own token block (~2KB). Bumps the
    // multiplier to 1.452.
    // 2026-09-01: presence carets — presence.css traded the block outline and
    // its holder label for the Notion shape: an absolutely-positioned caret line
    // parked on the holder, a name flag that fades on idle, a pulse keyframe
    // that runs only while the peer is active, and a reduced-motion block that
    // stands both animations down, and the line is a painted rounded box rather
    // than the two-border trick (absolutely positioned, so it never cost layout
    // and the borders bought nothing). Net a little larger than the outline it
    // replaced (~1.6KB). The pulse then moved to the RESTING state (idle is when
    // a peer needs announcing; while they type the text itself is the signal),
    // which is a comment rather than a rule bigger. The name flag was then
    // REPLACED by the Notion gutter face: presence.css lost the flag rules and
    // gained a per-block avatar strip that hangs in the editor's own control
    // gutter, plus face/ring/gap tokens. The strip then moved onto the block's
    // CONTENT wrapper (the holder spans the whole editor, so the content edge
    // is the only thing worth measuring from) and learned to SLIDE aside by the
    // gutter token on hover rather than vanish, so the +/⠿ controls get that
    // space and the order across the margin reads face, +, ⠿, text — Notion's.
    // That is a transition, an LTR rule and its RTL mirror. The fixed line-box
    // height then became a min-height floor, because presence-avatars.ts now
    // writes the real one per block from the MEASURED first line (a heading's
    // line is 39px against a paragraph's 24px, so no constant centres both).
    // Bumps the multiplier to 1.4631.
    // 2026-09-02: presence monograms moved off text nodes — the gutter face
    // and its `+N` now carry the monogram in an attribute that presence.css
    // paints through `content: attr()` (block copy sanitizes `holder.innerHTML`
    // and kept the text), plus the rule that hides the strip inside the drag
    // ghost, which clones the wrapper the strip is mounted on, and the
    // `pointer-events: auto` opt-in on the face and avatar discs (the strip
    // and the stack are transparent, `pointer-events` inherits, and a `title`
    // tooltip needs a hover target). The hover slide then narrowed to the
    // INNERMOST hovered block (`:hover` is true for every ancestor, and the
    // +/⠿ controls attach to the innermost block, so a container's face must
    // stay put while a child is hovered) — a `:not(:has())` clause and a
    // direct-child chain on the LTR rule and its RTL mirror — while the dead
    // radius/fade tokens and the name-flag reduced-motion rule went (~1KB
    // net). Bumps the multiplier to 1.4656.
    // 2026-09-03: anonymous presence silhouettes — a peer who published no name
    // is drawn as one of twelve space shapes instead of a bare disc, and the
    // shapes are inline SVG data URIs in presence.css (a mask on the face's
    // `::after`, never a child node: the strip sits inside a block holder and
    // block copy keeps whatever the holder held). Thirteen URIs plus the shared
    // mask rule is ~5.3KB, and there is no cheaper home for them — stamping
    // them from JS would put the same bytes in the bundle instead. Bumps the
    // multiplier to 1.4805.
    const PRE_SPLIT_BYTES = 407853;
    // Keep 56 bytes of headroom after the measured 1,162-byte net CSS growth.
    // Scoped block-menu layout, group separators and mobile hit areas add
    // 2,854 bytes in popover-animation.css.
    // Picker layout, search states and reduced motion add 9,383 bytes.
    // Picker skin controls, reel labels and empty-state motion add 3,437 bytes.
    // Richer anonymous presence silhouettes add 952 bytes in presence.css.
    // Picker rules add 2,380 bytes to the prior 2,772-byte allowance; retain 150 bytes of headroom.
    const CONVERSION_TYPOGRAPHY_PICKER_BYTES = 5_152;
    // Remote selection shading adds 607 measured bytes in presence.css. Only 174
    // of them are the rule that fills the boxes drawn over text a peer has
    // selected; the rest is the source comment above it, which records the two
    // things that break silently: spans around the text would ride into saves,
    // and the wash paints over the glyphs, so its 22% is a contrast budget.
    // This budget counts AUTHORED bytes, so a comment costs against it even
    // though no bundle carries one.
    const REMOTE_SELECTION_SHADE_BYTES = 607;
    // The highlight on the equation chip being edited adds 444 bytes in preflight.css.
    const EQUATION_EDITING_CHIP_BYTES = 444;
    // Inline tool menu entrance, the toolbar hand-off fade and the chip's
    // highlight fade add 1,844 bytes across popover-animation.css,
    // keyframes.css and preflight.css.
    const INLINE_MENU_MOTION_BYTES = 1_844;
    // The inline "/query" pill in a block with text adds 273 bytes in slash-search.css.
    const SLASH_PILL_SPAN_BYTES = 273;
    // The convert menu's one-row heading ramp, sliding tab thumb, search pill
    // and tile entrance add 2,975 bytes across popover-animation.css and keyframes.css.
    const CONVERT_MENU_RAMP_BYTES = 2_975;
    // The slot indent term for blocks nested under a slotless block inside a
    // toggle/callout slot adds 325 bytes in main.css.
    const SLOT_INDENT_BYTES = 325;
    // Find in page: find.css (window-fixed top-layer bar with host-set
    // placement, row grid, match map, rolling counter, replace row, in-text
    // replace preview, lens, reduced motion) plus its palette tokens in colors.css
    // add 17,626 bytes; retain 200 bytes of headroom.
    const FIND_IN_PAGE_BYTES = 17_826;
    // assistant.css: the docked "Ask AI" prompt bar (reply, status, field, send, Keep/Discard) and its import line.
    const ASSISTANT_BAR_BYTES = 4_888;
    // assistant.css: the bar's thinking level button and its menu's checkmark-only selected row.
    const ASSISTANT_THINKING_PICKER_BYTES = 1_175;
    // assistant.css: the reply's markdown look (paragraphs, headings, lists, code, tables).
    const ASSISTANT_REPLY_MARKDOWN_BYTES = 2_105;
    // Emoji sections past the first skip rendering, sized from their row count
    // and the measured cell: 592 bytes in emoji-picker.css.
    const EMOJI_DEFERRED_SECTIONS_BYTES = 592;
    // The anonymous presence silhouettes redrawn with a see-through tonal
    // layer (evenodd clip paths and a shade copy of each form) the faceted star, the cratered moon, the
    // lit asteroid with its companion rock, the beaming satellite, the cow-lifting saucer, the
    // two-tailed comet, the crescent-armed galaxy, the launching rocket and the observatory add
    // 12,103 bytes in presence.css.
    const PRESENCE_TONAL_GLYPHS_BYTES = 12_103;
    // Trash lids drawn closed and lifted on hover: 677 bytes in main.css.
    const TRASH_LID_HOVER_BYTES = 677;
    // The random-emoji die rolls on hover: roll, pip-face and impact keyframes
    // plus their hover wiring add 2,485 bytes across keyframes.css and emoji-picker.css.
    const DICE_ROLL_HOVER_BYTES = 2_485;
    // Notion-style inline toolbar card: --blok-inline-toolbar-shadow in the
    // light palette and both dark palettes of colors.css.
    const INLINE_TOOLBAR_CARD_BYTES = 402;
    // Its entrance: blok-inline-toolbar-in keyframes, the opened-card rule and
    // its reduced-motion opt-out.
    const INLINE_TOOLBAR_ENTRANCE_BYTES = 853;
    // Media previews: the per-tool drawings in media-empty.css (hover demo,
    // spring-home exit, drag-over, upload progress, Link-tab stage, large field,
    // read-back, address-bar field and the ink-sweep Add button, reduced-motion opt-out)
    // plus the centered uploading layout in image.css and file.css, and the
    // --blok-media-preview-shadow token in the colors.css palettes.
    const MEDIA_EMPTY_PREVIEW_BYTES = 22_434;
    // Popover "Nothing found" search drawing: its part fills, dashed slot and
    // the loupe's idle hover keyframes in media-empty.css.
    const NOTHING_FOUND_SEARCH_PREVIEW_BYTES = 549;
    // The slash pill's `width: auto !important`, so the + button's search shows it.
    const PLUS_BUTTON_SEARCH_PILL_BYTES = 62;
    // Image chrome (frame and islands): island cards and their split motion,
    // selection ring, dot handles, width readout, snap guides, hover bridge,
    // table-cell insets and the on-image alt pill in
    // image.css, minus the old toolbar base in main.css and the caption-row Alt
    // chip; the quiet alt note in alt-popover.css; five --blok-image-* tokens in
    // the colors.css palettes. Measured net growth against 523c1716.
    const IMAGE_CHROME_ISLANDS_BYTES = 8_510;
    // Failed-image media card toast: notifier-card.css (grid areas with a
    // narrow-screen row, tile fan, count badge, pill actions, busy spinner,
    // resolved check with ring pulse, reduced-motion opt-out) and its @import.
    // The staged resolve (ghosts, green flood, drawn check, sweep, height
    // glide) adds 2_535, measured against 652e0f36.
    const NOTIFIER_MEDIA_CARD_BYTES = 10_796 + 2_535;
    // Toolbox hover previews: the card in block-preview.css and one drawing per
    // built-in toolbox entry (35) in block-preview/*.css, plus the @import.
    // About 11.5KB gzipped; the repeated scope prefix is most of the bytes.
    // The detailed, animated Lake Bled image scene adds 14_740, measured
    // against 944b5b9f. The playing video scene (pan, clock, meteor) adds
    // 3_616, measured against de4b6d9d; its night caravan and oasis camp add
    // 13_685, measured against b971b4f2; the detailed camp, palms, pond and
    // the one-way camera move add 7_245, measured against f951b47f; the
    // moonlit dune crest, ripples, scrub and spindrift add 1_346, measured
    // against 9cf72649; the buttes with cap rock, scree, lit faces and a hazy
    // distant range add 1_698, measured against 7cfab619.
    const TOOLBOX_HOVER_PREVIEWS_BYTES = 94_491 + 14_740 + 3_616 + 13_685 + 7_245 + 1_346 + 1_698;
    // Show's spotlight: spotlight.css (a Notion-style warm background flash on
    // the failed block's card, reduced-motion steady tint) and its @import.
    const SPOTLIGHT_BYTES = 1_245;
    // Retrying a broken image: image.css mend state (hidden figure, edge light,
    // icon halves closing into the whole picture, seam flash, title sweep),
    // develop, and the crack back to broken; reduced-motion opt-out. Measured
    // net growth against 19ecc9ca.
    const IMAGE_MEND_BYTES = 10_825;
    // Image errors told apart: the broken card as a frame in the picture's shape,
    // the failed upload as a file row (thumbnail, name, size, dismiss cross).
    // Measured net growth against cc45ec8f.
    const IMAGE_ERROR_SHAPES_BYTES = 2_440;
    // Media radius roles: containers publish --blok-radius-inner for their
    // children, crop wrappers get the frame radius in CSS instead of inline,
    // and the image selection ring grows with its gap. Net growth after
    // deleting the dead image popover and toolbar pill rules.
    const MEDIA_RADIUS_ROLES_BYTES = 2_479;
    // Radius design system: the scale and role tokens, --blok-radius-inner on
    // every rounded container, and the selection fill's frame channel.
    const RADIUS_SYSTEM_BYTES = 838;
    // Darkroom projects 2-3: mode tabs, straighten/adjust dial with a typed-value
    // field, adjust and filter panels, local resets. darkroom.css 10_212 -> 19_716.
    const DARKROOM_EDIT_PANELS_BYTES = 9_504;
    // Darkroom Markup tab: markup-panel.css (tool rail, sliding puck, swatches,
    // sizes, text styles, the shape picker grid and its hairline) and markup-editor.css (cursors,
    // selection handles, text editor), plus their two imports in main.css.
    const DARKROOM_MARKUP_BYTES = 17_400;
    // Filter strip: the strength slider column, family tabs, fixed-width chips,
    // the Original divider and the phone sizes.
    const DARKROOM_FILTER_STRIP_BYTES = 1_712;
    // Loading skeleton: loading.css, its three keyframes, the bar and sheen tokens in
    // the three theme blocks, and its import in main.css.
    const LOADING_SKELETON_BYTES = 4_837;
    // Table frame: heading ink + divider, the 2px frame radius on the
    // grid and its corner cells, the radius role and the matching toolbox
    // preview. Measured net growth against 7d2de4e2.
    const TABLE_FRAME_BYTES = 2_390;
    // Table cells: no placeholder ::before paints inside a cell, whatever path
    // left the placeholder attributes on a block.
    const CELL_PLACEHOLDER_BYTES = 497;
    // Speed ruler spacing and its preset puck.
    const VIDEO_SPEED_PRESET_BYTES = 33 + 1_972;
    // Darkroom keys, view-only zoom, and the shortcuts sheet.
    const DARKROOM_NAVIGATION_BYTES = 264 + 320 + 1_957;
    // Table corner arcs and pill room, net of the simpler heading row.
    const TABLE_CORNER_AND_PILL_BYTES = 1_025 - 427 + 470;
    // Keyboard-only focus modality rules.
    const FOCUS_MODALITY_BYTES = 1_286 + 4;
    // The find options CSS shrank by 238 authored bytes.
    const FIND_OPTIONS_SAVINGS_BYTES = -238;
    // Three themeable 2px spacing literals became token references.
    const SPACING_TOKEN_REFERENCES_BYTES = 54;
    // Live ink shape tiles in markup-panel.css: ink/width/fill glyphs, the photo
    // spotlight and lens tiles, the trace-on keyframes and their reduced motion.
    const SHAPE_PICKER_LIVE_INK_BYTES = 5_732;
    // Shape picker timing tokens (lead, step, trace) shared by every open animation.
    const SHAPE_PICKER_TIMING_TOKENS_BYTES = 268;
    // Image chrome paper and graphite: one bar, bar handles and an ALT tag replace the
    // islands' split motion; class-keyed tone rules. Net, measured against 80722a4e.
    const IMAGE_CHROME_PAPER_GRAPHITE_BYTES = -5_778;
    // Audio error card: the cracked, skipping record and the flat waveform.
    const AUDIO_ERROR_PLAYER_BYTES = 5_014;
    // Audio beat motion: the turning label print, beat ring, halo and art punch.
    const AUDIO_BEAT_MOTION_BYTES = 2_576;
    // Embed empty state: the window above the URL bar that draws the typed link's kind.
    const EMBED_LIVING_WINDOW_BYTES = 10_195;
    // Video error screen: static, the colour-bar tear, the glass card and its tokens.
    const VIDEO_NO_SIGNAL_BYTES = 8_421;
    // Image upload resend: the card's lift, progress hairline, attempt pill and the failed send's fall back.
    const IMAGE_RESEND_BYTES = 5_150;
    // Notifier card stack: the peeking edges of waiting cards, their tokens, the unfold and the dust mask.
    const NOTIFIER_CARD_STACK_BYTES = 5_687;
    // Notifier card launch: the spring curve, the launch and its light, the staggered insides, the peek entrance and their reduced motion.
    const NOTIFIER_CARD_LAUNCH_BYTES = 5_099;
    // Table of contents block: its stylesheet and import, then the toolbox preview drawing.
    const TABLE_OF_CONTENTS_BYTES = 6_071 + 35 + 2_544;
    // Tabs toolbox preview: the tab strip, the open tab's panel and its line motion.
    const TABS_TOOLBOX_PREVIEW_BYTES = 2_439;
    // Tabs block: tabs.css (strip, sliding pill, panels, empty tab, dwell motion) and its @import.
    const TABS_BLOCK_BYTES = 7_064;
    // Tabs folder look: the band, the sheet and the two concave corners on the open tab.
    const TABS_FOLDER_LOOK_BYTES = 2_897;
    // Tabs focus ring drawn inside the pill, clear of the scroller's clip.
    const TABS_FOCUS_RING_BYTES = 208;
    // Tabs empty hint takes the empty paragraph's box, so the first block never resizes the tab.
    const TABS_EMPTY_HINT_BYTES = 519;
    // Page title header: page-title.css (gutter, content column and its align rules, icon, Add icon,
    // title, size tiers), its @import, and the main.css rule that lets an in-editor header inherit the gutter.
    const PAGE_TITLE_HEADER_BYTES = 5_347 + 28 + 524;
    const AGENT_MARKER_BYTES = 633;
    // find.css: the field's grid-column pin and its comment (read-only find field gap).
    const FIND_FIELD_COLUMN_BYTES = 140;
    // database.css: the prefers-reduced-motion block and its drawer-fallback comment.
    const DATABASE_REDUCED_MOTION_BYTES = 536;
    // database.css + colors.css: cell pills, checkbox, select and date editors,
    // the drawer value button, and the option/checkbox/today tokens in all three themes.
    const DATABASE_CELL_EDITORS_BYTES = 19_619;
    // database.css + colors.css: the table view grid, gutter, footer, groups,
    // drag visuals, selection bar, and its tokens in all three themes.
    const DATABASE_TABLE_VIEW_BYTES = 21_243;
    // database.css: status pill dot, number bar and ring, ID ink, person and
    // file chips, the person/files editors, the property menu and status group
    // headings, and their tokens in all three themes.
    const DATABASE_PROPERTY_TYPES_BYTES = 8_045;
    // database.css + keyframes.css: Notion board parity (research/08): the drop
    // line, confirm dialog, group header actions, board look, menu, caret and
    // tab motion, the side peek slide, and their tokens.
    const DATABASE_BOARD_PARITY_BYTES = 8_933;
    // popover-animation.css: the animateClose closing look and its comment.
    const POPOVER_CLOSE_MOTION_BYTES = 197;
    // database.css: the view toolbar, filter bar, filter pills, the paged
    // settings panel, conditional color fills and the switch knob motion.
    const DATABASE_VIEW_SETTINGS_BYTES = 11_292;
    // database.css: the gallery and calendar views, and their tokens in all three themes.
    const DATABASE_GALLERY_CALENDAR_BYTES = 18_209;
    // database.css: the timeline view, and its tokens in all three themes.
    const DATABASE_TIMELINE_BYTES = 12_069;
    // database.css: board card previews, properties and sub-group lanes, and the calendar "No date" list.
    const DATABASE_BOARD_CARD_BYTES = 5_546;
    // database.css: relation chips and picker, and the formula editor.
    const DATABASE_COMPUTED_PROPERTIES_BYTES = 3_040;
    // database.css: Phase 4 row page: the empty body hint, center and full
    // page modes, the peek header controls, the page icon and the properties
    // panel, the selection bar property buttons, the fill handle, page icons in
    // views, board and list selection, the page cover, and their tokens.
    const DATABASE_ROW_PAGE_BYTES = 8_972;
    // database.css: the chart, drilldown and feed views, and their tokens in all three themes.
    const DATABASE_CHART_FEED_BYTES = 10_935;
    // database.css: Phase 6 structure: the button cell, the "New" split button,
    // the template banner, sub-item nesting, dependency arrows and the link
    // handle, the linked-view states, and their tokens.
    const DATABASE_STRUCTURE_BYTES = 10_030;
    // database.css: backlog fixes: the lane column body radius, the timeline table footer, the empty gallery group drop ring, the AA yellow and brown accents, the board column "Load more".
    const DATABASE_BACKLOG_BYTES = 825;
    // database.css: the row page layout (pins, sections, modules, details panel, tabs, builder bar), plus 543 for the panel beside the page,
    // plus 2_017 for the property label icon, the pin scroll arrows and the pinned "+ Add a property",
    // plus 2_658 for research/09: the measured pin arrows and edge fades, and the docked details panels.
    const DATABASE_ROW_PAGE_LAYOUT_BYTES = 5_720 + 543 + 2_017 + 2_658;
    // database.css: Tier 3 (D6) form, map and dashboard views.
    const DATABASE_TIER3_VIEWS_BYTES = 2_255;
    // database.css: the side peek narrowing past the isolation reset, its 34px property rows, the selection bar in the toolbar row, the gray fill handle ring.
    const DATABASE_PEEK_SELECTION_BYTES = 975;
    // database.css: Notion look parity (research/07, 08): tabs and "Display as", toolbar icon buttons,
    // card action pill, cell links, 37px file/button rows, peek labels, select head, dark pills, their tokens.
    const DATABASE_LOOK_PARITY_BYTES = 4_097;
    // database.css: Edit property's options list, its "all views" note and the status editor footer.
    const DATABASE_OPTIONS_EDITOR_BYTES = 1_899;
    // database.css: list view parity (research/07): 30px rows, property slots, list pills, keyboard focus rings, "Load more";
    // conditional color reaches calendar events, timeline bars and feed cards (research/05 §6.2); the flat rows list is not indented.
    const DATABASE_LIST_VIEW_BYTES = 2_254;
    // Measured database.css additions, not the total budget overage.
    const DATABASE_TITLE_ICON_MENU_BYTES = 696;
    const DATABASE_FORM_PROVIDER_BUILDER_BYTES = 749;
    // database.css: the AI Autofill setup dialog and its ••• button, plus the cell button, Thinking… and header sparkle,
    // plus 185 for the button on the keyboard-selected cell and the sparkle beside the header button,
    // plus 2_235 for the New database AI prompt box and its placeholder token (research/26 §2).
    const DATABASE_AI_AUTOFILL_BYTES = 2_772 + 1_486 + 201 + 185 + 2_235;
    // database.css: drag ghosts repeat the fitted-image and vertical-line rules of the view they leave.
    // 174 for card and table row ghosts, 152 for board and table column ghosts.
    const DATABASE_GHOST_CONTEXT_BYTES = 174 + 152;
    // database.css: the full-window layout builder (top bar, Apply split, canvas card, its tokens), less the old builder bar.
    // +1_760: the Preview switch, its menu and the New page placeholder (Phase 3).
    // +26: the Preview padding names its spacing tokens (css-vars-extraction R2) instead of 3px/6px.
    // +2_774: the Page settings column, its Structure cards, Options switches and (i) hints (Phase 4, measured database.css growth).
    // +3_990: the module cards, the Heading menu with its pin buttons and Property labels switch (Phase 5a).
    // +3_833: the Add page module "+", the side panel column, module cards with drag handles and their menus (Phase 5c).
    // +3_165: sections in the Property group menu, their rename field, row-page adds and the Empty line (Phase 6).
    // +1_034: pins with Property labels off, and the 1.2x property icon boxes (Phase 7).
    // +200: the Reset confirm's description line (Phase 8).
    // +1_655: the empty row page's template picker and the Full width row page (Phases 9 and 10).
    // +1_687: the details panel header, its Close panel button and the Page info button (Phase 11).
    // +185: Page info's sidebar glyph mirrors in RTL.
    // +2_327: the Tabbed tab bar's container, Add tab reveal, and its menus (Phase 12).
    // +247: the locked Two-way relation row and the row-page tab menu (tab extras).
    const DATABASE_LAYOUT_BUILDER_BYTES = 5_143 + 1_760 + 26 + 2_774 + 3_990 + 3_833 + 3_165 + 1_034 + 200 + 1_655 + 1_687 + 185 + 2_327 + 247;
    // database.css: the title cell Open button shows on the keyboard-selected cell (Cmd/Ctrl+Enter presses it).
    const DATABASE_CELL_BUTTON_KEYBOARD_BYTES = 92;
    // database.css: the comment count badge after a row title (research/12 §3).
    const DATABASE_COMMENT_BADGE_BYTES = 1_131;
    // database.css: the CSV import dialog, its Setup CSV columns step and type picker heading (research/27 §2).
    // +3_925: the right-hand preview and the "Use first row as headers" switch (research/27 §2, research/30 §9).
    // +780: Merge with CSV's "Import Location" field (research/30 §9f).
    const DATABASE_CSV_IMPORT_BYTES = 4_875 + 3_925 + 780;
    // block-preview/database.css: the Map view toolbox preview (map, land, Add pin, the real pin masks).
    const DATABASE_MAP_VIEW_PREVIEW_BYTES = 3_828;
    // block-preview/database.css: the Gallery, List, Feed, Calendar, Timeline and Form "/" entry previews (research/28 §3).
    // +103: the Feed fold and the List, Calendar and Form sizes that keep each drawing inside its paper.
    const DATABASE_SLASH_VIEW_PREVIEWS_BYTES = 10_765 + 103;
    // database.css: Edit cadence's "Label  value ›" rows, their submenu fields and zone rows (research/21 §3).
    const DATABASE_CADENCE_SETTINGS_BYTES = 606;
    // database.css: the property menu (i) "Add property description" button (research/26 §3c).
    const DATABASE_PROPERTY_DESCRIPTION_BUTTON_BYTES = 555;
    // database.css: a calendar event title gives way to its comment badge (research/22 §11).
    const DATABASE_CALENDAR_EVENT_BADGE_BYTES = 218;
    // database.css: the view overflow list's search, row handle and "•••", and New view (research/13 §3a).
    // +292: its keyboard highlight (moved off the current row) and the "No results" line (research/21 §2).
    // +210: its width and padding again once it opens in the top layer, above Customize layout.
    const DATABASE_VIEW_OVERFLOW_LIST_BYTES = 1_352 + 292 + 210;
    // database.css: the property menu's taken-name error line (research/14 §3).
    const DATABASE_PROPERTY_NAME_CLASH_BYTES = 233;
    // database.css: the form question's taken-name error line (research/14 §3).
    const DATABASE_FORM_QUESTION_NAME_CLASH_BYTES = 267;
    // database.css: page icon boxes in calendar events, timeline bars and feed cards (research/16 §2).
    const DATABASE_VIEW_PAGE_ICON_BYTES = 1_462;
    // database.css: no ring on the gallery while its arrows select cards (research/16 §3a).
    const DATABASE_GALLERY_KEYBOARD_BYTES = 169;
    // database.css: the url, email and phone cell hover pill (research/16 §4).
    const DATABASE_TABLE_LINK_CELL_PILL_BYTES = 1_126;
    // database.css: the board count as a calculation menu button (research/16 §1).
    const DATABASE_BOARD_CALCULATION_BYTES = 222;
    // database.css: the row page's "•••" Actions button at the end of the peek header (research/09 §1b).
    const DATABASE_ROW_PAGE_ACTIONS_BYTES = 414;
    // database.css: the row page's "N backlinks" item and its "Linked to this page" list (research/17 §2).
    const DATABASE_ROW_PAGE_BACKLINKS_BYTES = 2_375;
    // database.css: the date picker's Remind row and menu, and the alarm of a date with a reminder (research/17 §1).
    const DATABASE_DATE_REMINDERS_BYTES = 2_654;
    // database.css: the feed card's reactions, Add reaction and hover React / More actions (research/19 §2).
    const DATABASE_FEED_REACTIONS_BYTES = 3_681;
    // database.css: the form's auto-create prompt, page picker header, file limit, "Share form" button, access line and Share panel (research/19 §3).
    const DATABASE_FORM_SHARE_BYTES = 4_606;
    // database.css: the respondent's "Submitting response anonymously" pill and the thank-you screen's two buttons (research/23 §6).
    const DATABASE_FORM_RESPONSE_BYTES = 1_333;
    // database.css: the form's Preview dialog and the "Submitting response as" chip (research/36 §13).
    const DATABASE_FORM_PREVIEW_BYTES = 1_418;
    // database.css: an empty row page still shows its placeholder when the row holds only comment threads.
    const DATABASE_ROW_COMMENTS_EMPTY_BYTES = 54;
    // database.css: the built-in comments thread, composer and row page section (research/12 §3, research/19 §2d).
    const DATABASE_BUILT_IN_COMMENTS_BYTES = 3_906;
    // database.css: the feed card's comment composer and "N replies" row (research/19 §2d).
    const DATABASE_FEED_COMMENTS_BYTES = 1_164;
    // database.css: the map's Add pin button, "No place" chip and list, and the Place hover card (research/20 §1).
    const DATABASE_MAP_PLACE_BYTES = 3_031;
    // database.css: the Place editor's name chip and its × (research/20 §1d).
    const DATABASE_PLACE_CHIP_BYTES = 138;
    // database.css: Blok's map pin, its colors and shadow token, the pin hover card and the Place search rows (research/20 §1d, §1e).
    const DATABASE_MAPLIBRE_BYTES = 5_187;
    // database.css: the linked view's deleted-source banner, "Link a data source" button and "↗ <source>" title (research 20 §2).
    const DATABASE_LINKED_VIEW_BYTES = 904;
    // database.css: the gallery card shows the board's Edit and "•••" on hover (research/12 §3).
    const DATABASE_GALLERY_CARD_ACTIONS_BYTES = 163;
    // database.css: the list row's ⋮⋮ gutter and its gray fill while the row menu is up (research/12 §3).
    const DATABASE_LIST_ROW_HANDLE_BYTES = 1_050;
    // database.css: a filled autofill cell's Autofill joins the Comment/Copy pill (research/12 §2).
    const DATABASE_AUTOFILL_CELL_PILL_BYTES = 567;
    // database.css: the row page tab bar's hidden tabs and its "N more…" button (research/13 §3a).
    const DATABASE_ROW_PAGE_TAB_OVERFLOW_BYTES = 628;
    // database.css: dark peek panel, backdrop, builder surfaces and comment badge ink, as measured (research/21 §1m-§1o).
    const DATABASE_DARK_PEEK_BUILDER_BYTES = 1_688;
    // database.css: dark board, list, gallery, calendar, timeline, feed and form tokens (research/21 §1f-§1k).
    const DATABASE_DARK_VIEWS_BYTES = 2_137;
    // database.css: the row page's Favorite star in the header button lists and end-of-bar margins (research/21 §5).
    const DATABASE_ROW_PAGE_FAVORITE_BYTES = 451;
    // database.css: dark table chrome measured in research/21 §1 (tab hover, New hover and divider, button border, selection bar shadow, database menu fill and shadow).
    const DATABASE_DARK_TABLE_CHROME_BYTES = 1_021;
    // database.css: a reminder date stays inline with its alarm in cards and timeline columns (research/21 §6).
    const DATABASE_DATE_REMINDER_INLINE_BYTES = 140;
    // database.css: peek title ink, value hover, 160x34 label cell, side peek shadow, Structure tile labels (research/21 §1m-§1n, research/10 §2).
    const DATABASE_PEEK_POLISH_BYTES = 2_372;
    // database.css: feed hover ring + pill, card pill divider, timeline bar overlay + chip border, form question card (research/21 §1f-§1k).
    const DATABASE_VIEW_HOVER_CHROME_BYTES = 2_943;
    // database.css: board and gallery card pill radius control -> control-sm, 4px (research/21 §1f).
    const DATABASE_CARD_PILL_RADIUS_BYTES = 6;
    // database.css: the template banner's "Duplicate every…" button and the templates list's ↻ (research/21 §3).
    const DATABASE_TEMPLATE_REPEAT_BYTES = 902;
    // database.css: calendar cards give each shown property its own 24px line; timeline bars run title and properties past a short bar (research/21 §6, 78/80 shots).
    const DATABASE_TIMELINE_CALENDAR_LAYOUT_BYTES = 1_128;
    // research/22 §10: side peek resize handle, docked side details panel, drag transition off.
    const DATABASE_SIDE_PEEK_WIDTH_BYTES = 1973;
    // database.css: the number range's [start] – [end] row and the 99+ switch's hint (research/22 §5, §7).
    const DATABASE_GROUP_RANGE_TEXT_BYTES = 903;
    // database.css: the table cell editor box, 6px with the menu shadow, its 8px 9px inputs and token (research/22 §4).
    const DATABASE_CELL_EDITOR_LOOK_BYTES = 1_164;
    // database.css: url, email and phone underline line + its token, and the row page link value's Comment and Copy (research/22 §3).
    const DATABASE_LINK_CELL_UNDERLINE_BYTES = 1_055;
    // database.css: Edit cadence, its day chips and the banner button's chevron (research/21 §3).
    const DATABASE_TEMPLATE_CADENCE_BYTES = 2_807;
    // database.css: the row page's 34px property value row (research/22 §3).
    const DATABASE_PEEK_VALUE_ROW_BYTES = 253;
    // database.css: the date picker's Date format, Time format and Time zone rows and their menus (notion-measure12/17-date-edit).
    const DATABASE_DATE_PICKER_ROWS_BYTES = 777;
    // database.css: "+ New page" button hover and the favorited star (research/22 §12, §14).
    const DATABASE_DARK_GAPS_STAR_BYTES = 612;
    // database.css: the calendar drag box from empty grid space (research/23 §2c).
    const DATABASE_CALENDAR_BOX_BYTES = 289;
    // database.css: the time zone menu's search, headings and two-line rows (research/23 §1).
    const DATABASE_TIME_ZONE_MENU_BYTES = 1_231;
    // database.css: timeline resize handles 6px outside the bar, and the measured green map pin (research/23 §3b, §5b).
    const DATABASE_TIMELINE_HANDLE_MAP_PIN_BYTES = 218;
    // database.css: backlink paths shortened to "first / ... / parent", each part cut by width (research/23 §4).
    const DATABASE_BACKLINK_CRUMBS_BYTES = 331;
    // database.css: dark panel, date picker, "+ Filter", "Empty" and form field inks (research/21 §1c, §1k, §1l, §1m).
    const DATABASE_DARK_LEFTOVERS_BYTES = 2_429;
    // database.css: research/26 light values and dark leftovers: root title label, today circle and button, 180 submenus,
    // center peek title, side peek hovers, reminder blue, dark brown and blue board tokens, card hover channel.
    const DATABASE_LIGHT_VALUES_BYTES = 2_421;
    // database.css: the backlink title fills its row so the path sits at the right end (research/23 §4).
    const DATABASE_BACKLINK_RIGHT_PATH_BYTES = 192;
    // database.css: bordered sort buttons, selection bar dividers, the property menu icon button, the panel × (research/26 §3, §1b).
    const DATABASE_NOTION_ELEMENTS_BYTES = 3_845;
    // database.css: the property menu's inline description field under the name row (research/30 X2).
    // [data-blok-field] in its selector: field.css loads later and would win a tie.
    const DATABASE_PROPERTY_DESCRIPTION_FIELD_BYTES = 271;
    // assistant.css + colors.css: the Ask AI live preview's holder gap, overlay box, heading parity rules,
    // shimmer slots, word blur-in and violet tail, plus their light and dark tokens (2026-10-20).
    const ASSISTANT_LIVE_PREVIEW_BYTES = 3_831;
    // assistant.css: a block being rewritten by Ask AI hides its text fields; nested child blocks stay visible (2026-10-20).
    const ASSISTANT_REWRITE_PREVIEW_BYTES = 594;
    // assistant.css: the fallback reveal for an Ask AI batch that never streamed, and its reduced-motion reset (2026-10-20).
    const ASSISTANT_FALLBACK_REVEAL_BYTES = 1_140;
    // assistant.css: the bar moves into the page at the caret (one-row field with
    // status shine, summary and Undo/Keep icons, the "Show more" panel, shimmer
    // slots, wobble, reduced motion incl. the chevron and press), minus the bottom dock: the measured overage.
    const ASSISTANT_IN_PAGE_BAR_BYTES = 4_610;
    // assistant.css: the preview heading rules drop to heading.css's (0,1,0) via :where(), so a host's
    // unscoped .m-0 hits both alike, plus the comment saying why (2026-10-20).
    const ASSISTANT_PREVIEW_HEADING_SPECIFICITY_BYTES = 250;
    // colors.css: the "· Database" search suffix ink, light and both darks (research/30 B4).
    const POPOVER_SEARCH_SUFFIX_INK_BYTES = 257;
    // popover-animation.css + colors.css: the dark menu row label ink, both darks (research/30 B4),
    // and the selected heading tile reading the same ink (+37).
    const POPOVER_ITEM_LABEL_INK_BYTES = 748;
    // database.css: the delete-last-view dialog's round × and its fill tokens (research/30 B3).
    const DATABASE_CONFIRM_CLOSE_BYTES = 1_038;
    // database.css: the radio cards of "Delete the last view for this data source?" (research/26 §5a).
    const DATABASE_LAST_VIEW_CHOICE_BYTES = 1_844;
    // database.css: the bordered timeline "Manage in Calendar" button and the panel's "leaves this app" arrow (research/26 §3d, §4d).
    // +378: the same button on the calendar toolbar, and only the calendar arrows flip in RTL (research/28:129).
    const DATABASE_MANAGE_CALENDAR_BYTES = 510 + 378;
    // database.css: the timeline off-screen chip hover fill, light and dark (research/26 §4d).
    const DATABASE_TIMELINE_CHIP_HOVER_BYTES = 331;
    // database.css: the Suggested template tiles and the Customize modal (research/27 §1).
    const DATABASE_STARTER_TEMPLATES_BYTES = 6_886;
    // database.css: pressed View settings row and ×, Today/Now hover, light and dark (research/27 §6).
    const DATABASE_PRESSED_FILLS_BYTES = 1_106;
    // database.css: a template's database icon and the template menu's "Default" (research/27:42, :44).
    const DATABASE_STARTER_ICON_BYTES = 993;
    // database.css: "Learn about reminders" and "Learn about imports" (research/23 §1, research/26 §2).
    const DATABASE_HELP_LINKS_BYTES = 1_177;
    // database.css: the time zone rows' 1px gap and the menu comment (research/30 B25).
    const DATABASE_TIME_ZONE_ROWS_BYTES = 87;
    // database.css: "More templates" gallery, red/orange/yellow template tints, hidden-properties line, icon offset (research/26 §2, research/27 §1e, research/30 B8).
    const DATABASE_MORE_TEMPLATES_BYTES = 10_204;
    // assistant.css: Space hides the empty block under the Ask AI bar (bd2501b4, +179), the Stop/Continue comment (be6c08ed, +37)
    // and the prompt field's square corners (e14c7b26, +96), and the action buttons row under the field (be2e7de0, +369).
    const ASSISTANT_REPLACED_BLOCK_BYTES = 179 + 37 + 96 + 369;
    // assistant.css: the Ask AI "Halo" buttons: send halo, round Stop with its arc, pill actions with icons and rise-in.
    // +1801: Discard and Keep as labelled pills, Send and Keep halos on hover only, Stop's arc always (2026-10-22).
    const ASSISTANT_HALO_BUTTONS_BYTES = 4757 + 1801;
    // assistant.css: while working the rose dims and a coloured light runs round it, no glow, plus the raw hue tokens (2026-10-22).
    const ASSISTANT_ROSE_LIGHT_BYTES = 1689;
    // database.css: the board sub-group band toggle joins the table group toggle rules, and a folded band hides its cards (research/31 §3).
    const DATABASE_BAND_TOGGLE_BYTES = 482;
    // database.css: the purple template tile (Campaign Management, research/31 shot 51).
    const DATABASE_PURPLE_TEMPLATE_TILE_BYTES = 632;
    // database.css: the pink template tile (Product Roadmap, research/33 §3.13).
    const DATABASE_PINK_TEMPLATE_TILE_BYTES = 396;
    // Selected-state rules reach only the selected block's own tool (holder > content > tool root), so a selected toggle or callout keeps its fill: +319 across main, image, video, audio and tables.css.
    const SELECTED_OWN_BLOCK_BYTES = 319;
    // database.css: the up/down chevron in the CSV Import Location field and a form Dropdown question (research/31 §5a, research/12 §4).
    const DATABASE_SELECT_CHEVRON_BYTES = 460;
    // database.css: Notion's inks, hover fill and AA steps as database tokens, board blue/green/default, checkbox and switch blue;
    // colors.css + tokens.css: Notion's tooltip bg, inks and shadow (plans 34 colour audit); +8 for the form dropdown chevron moving to the database tertiary ink.
    const DATABASE_NOTION_COLOURS_BYTES = 7_135 + 50 + 6 + 8;
    // database.css: a status option's "Set as default" row and its "Default" mark (research/30 §10f).
    const DATABASE_STATUS_DEFAULT_BYTES = 169;
    // database.css: the Customize preview's group headings (research/30 B8).
    const DATABASE_PREVIEW_GROUPS_BYTES = 221;
    // database.css: a board's Card layout box, its two drawn tiles, and Compact card properties (research/30 §10f).
    const DATABASE_CARD_LAYOUT_BYTES = 2_580;
    // database.css: research/33 §4 colours — board orange/purple/pink/red/brown tints, rings and dark counts, status dots,
    // pressed fills, the dark calendar today digit, the row page divider, the picked Card layout tile label.
    const DATABASE_NOTION_COLOURS_PASS2_BYTES = 4_692;
    // database.css: confirm dialogs' filled red button and picked-card ring tokens (research/26 §5a, 33 §3.10).
    const DATABASE_CONFIRM_LOOK_BYTES = 1_016;
    // database.css: the 17px title on Reset and "Delete the last view…" (research/10 §5, 26 §5a).
    const DATABASE_CONFIRM_LARGE_TITLE_BYTES = 204;
    // database.css: picked calendar events and timeline bars draw a gray halo inside the card (research/35 §1.4, §1.5).
    const DATABASE_CAL_TIMELINE_HALO_BYTES = 1_218;
    // database.css: research/35 §1.1-§1.3, §1.8 — gray column count and dark cards, yellow card hover, "New" pressed, template "…" inks.
    const DATABASE_ROUND13_BOARD_TOOLBAR_BYTES = 1_910;
    // database.css: dark confirm values, the last-view dialog's hairlines, 32px trash, 10px ×, radios and card sizes (research/35 §1.7, §10).
    const DATABASE_CONFIRM_ROUND13_BYTES = 2_131;
    // database.css: the property description field stops at three lines and scrolls (research/35 §5).
    const DATABASE_DESCRIPTION_FIELD_CAP_BYTES = 100;
    // database.css: the place editor after a pick, with its map, × and Google Maps button (research/35 §9).
    const DATABASE_PLACE_VIEW_BYTES = 1_890;
    // database.css: the place hover card's map box holds MapLibre's canvas (position: relative).
    const DATABASE_PLACE_CARD_MAP_BYTES = 111;
    // database.css: research/36 §1, §7, §8: board hovers, the place map button, the Reset dialog.
    const DATABASE_ROUND14_COLOURS_BYTES = 5_170;
    // colors.css + main.css: the gray tint on the text Ask AI works on (--blok-selection-inactive).
    const ASSISTANT_SELECTION_TINT_BYTES = 418;
    // database.css: research/36 §8.1: the plain confirm box's gaps (324x193 with two lines of text).
    const DATABASE_PLAIN_CONFIRM_BYTES = 688;
    // assistant.css: the Ask AI actions row clips while it folds, and its chips dissolve.
    const ASSISTANT_ACTIONS_FOLD_BYTES = 667;
    // ask-ai-menu.css + its import: the Ask AI menu's rose light, unfold, icon acts, hue ink, shine and seam.
    const ASK_AI_MENU_MOTION_BYTES = 10_499;
    // ask-ai-icons.css + its import: the Ask AI skill icons' acts, shared by the bar's chips and the menu, less the menu acts it replaces.
    const ASK_AI_SKILL_ICONS_BYTES = 5_887;
    // bookmark.css: a cover that fails to load is drawn as a page sketch whose corner peels back on hover.
    const BOOKMARK_PEEL_COVER_BYTES = 5_955;
    // isolation.css: --blok-font-sans is Notion's longer font stack.
    const NOTION_FONT_STACK_BYTES = 111;
    // database.css: research/37 §4.1-4.2 and 35 §8: dark Reset, map button and help link inks, the confirm keyboard ring, the pin fill.
    const DATABASE_DARK_RESET_MAP_BYTES = 644;
    // database.css: research/35 §1.8: the templates menu's 28px rows.
    const DATABASE_TEMPLATE_MENU_ROWS_BYTES = 307;
    // database.css: the "New database" placeholder's warm gray ink, light and dark.
    const DATABASE_TITLE_PLACEHOLDER_BYTES = 580;
    // database.css: a disabled toolbar button (⚡ / ✦ while locked) keeps no fill.
    const DATABASE_TOOLBAR_DISABLED_BYTES = 183;
    // database.css: list and gallery parity (findings-listgallery L01-L22).
    // +86: the growth measured once the list, creation and peek lanes landed together on main.
    const DATABASE_LIST_GALLERY_BYTES = 851 + 86;
    // database.css: table grid feel (title page glyph, header line, dark header, empty-table lines and Add property, title editor weight, file chip glyph); measured growth.
    // +174: the floated sub-item toggle.
    const DATABASE_TABLE_GRID_FEEL_BYTES = 1_982 + 174;
    // database.css: feel/findings-table T11: the column header menu's 28px rows and no 400px cap.
    const DATABASE_HEADER_MENU_BYTES = 473;
    // database.css: feel/findings-table T12: the add property menu's 400-wide type grid and height cap.
    // database.css: feel/findings-table T15: the row menu's 29px rows and 12px gray footer (+ the add property menu's border-box).
    const DATABASE_ROW_MENU_BYTES = 437;
    // database.css: feel/findings-table T17: the status popover's group dividers and shrinkable search.
    const DATABASE_STATUS_POPOVER_BYTES = 480;
    // database.css: feel/findings-table T18: the multi-select popover's handles show at rest.
    const DATABASE_MULTI_HANDLES_BYTES = 219;
    // database.css: feel/findings-table T13: the selection bar's glyph gap; only the tabs hide under it.
    const DATABASE_SELECTION_BAR_BYTES = 154;
    // database.css: feel/findings-table T27: the filter list's highlighted option.
    const DATABASE_FILTER_LIST_ACTIVE_BYTES = 45;
    // database.css: feel/findings-toolbar V16–V29: the chip bar, chip and date popovers, sort panel, search box and match tint, the New ▾ head, Clear search.
    const DATABASE_FILTER_SORT_FEEL_BYTES = 5_634;
    // database.css: feel/findings-caltimeline: calendar live resize and move ghost,
    // +468: the toolbar "No date (N)" and its popover rows, less the old inline list.
    // +1_694: the timeline's month, ‹ ›, one-row header, "+ New" lane and the new bar's title field.
    // +3_583: the timeline drag range pill, edge marker and readout, and the dependency connector.
    // +1_050: calendar sizes (week row, inline/full-width cells, lane pitch, "+", arrows, event inset).
    // +3_787: the timeline frame (cut-bar chip, canvas fill, today dot, zoom rows) and the table panel parts.
    // +94: the connector's stub lets a press through to the end resize handle.
    // +115: the cut-bar chip and the connector chevron mirror in RTL.
    // +52: the growth measured once the lane landed on main's database.css.
    const DATABASE_CAL_TIMELINE_FEEL_BYTES = 700 + 468 + 1_694 + 3_583 + 1_050 + 3_787 + 94 + 115 + 52;
    // database.css: feel/findings-table T13: the uncapped board and list bar still hides the whole toolbar.
    const DATABASE_SELECTION_BAR_BOARD_BYTES = 233;
    // database.css: feel/findings-toolbar V09: view settings docks at the window's end edge with radius 10.
    const DATABASE_VIEW_SETTINGS_DOCK_BYTES = 228;
    // database.css: feel/findings-toolbar V11: 20px glyphs on the view settings rows.
    const DATABASE_VIEW_SETTINGS_GLYPH_BYTES = 328;
    // database.css: feel/findings-toolbar V10: the view settings glyph tile and "View name" field.
    const DATABASE_VIEW_SETTINGS_NAME_BYTES = 753;
    // database.css: feel/findings-toolbar V13: the Layout page's tile grid, its gray chosen tile and ✓.
    const DATABASE_VIEW_SETTINGS_LAYOUT_TILES_BYTES = 1_805;
    // database.css: feel/findings-toolbar V14: the Property visibility header, rows and eye switches.
    const DATABASE_VIEW_SETTINGS_PROPERTY_EYES_BYTES = 1_522;
    // database.css: feel/findings-toolbar V25: the docked panel's 24x22 Back.
    const DATABASE_VIEW_SETTINGS_BACK_BYTES = 375;
    // database.css: feel/findings-rowpage R09-R16, R26, R29: the row page's property handle, Add a property,
    // header hover row, comment avatar, value pill, body start and file chip.
    const DATABASE_ROW_PAGE_PROPS_BYTES = 3278;
    // database.css: the row page property menu: 14px regular titles, 8px separators, no gap under the last row.
    const DATABASE_ROW_PAGE_MENU_BYTES = 574;
    const DATABASE_ADD_PROPERTY_GRID_BYTES = 514;
    // database.css: board columns (findings-board): the status header pill, the AA count inks, "+ New page" type.
    const DATABASE_BOARD_COLUMNS_BYTES = 540;
    // database.css: a board card title edits in place at 15px with the blank page glyph.
    const DATABASE_CARD_TITLE_EDIT_BYTES = 653;
    // database.css: board card action glyphs are 16px.
    const DATABASE_CARD_GLYPH_SIZE_BYTES = 173;
    // database.css: the row menu grows to the window instead of the 400px cap.
    const DATABASE_ROW_MENU_HEIGHT_BYTES = 264;
    // database.css: a board card's select pill is 18px at 12px.
    const DATABASE_CARD_SELECT_PILL_BYTES = 229;
    // database.css: the "Add …" rows of a card whose title is being edited.
    const DATABASE_CARD_GHOST_ROWS_BYTES = 410;
    // database.css: the board card title placeholders take an AA ink.
    const DATABASE_CARD_PLACEHOLDER_AA_BYTES = 74;
    // database.css: feel/findings-rowpage: the peeks' box in the top layer (R02),
    // +1_847: Notion's 44px top bar, its rules, hover reveal, glyph sizes and inks (R03-R05, R28, R30),
    // +1_741: the full page's "database / page" path and 40px title (R17), the center peek's 708px column (R20).
    // +313: the bar stays revealed while the mode menu is open, and palette tokens skip top-layer elements inside an editor
    // (colors.css, database.css, popover-animation.css) so a peek inherits the host's tokens.
    // +297: the side peek's page starts 4px under its bar (R11), measured after the rebase onto rowpage-props.
    const DATABASE_PEEK_SHELL_BYTES = 709 + 1_847 + 1_741 + 313 + 297;
    // database.css: keys and dark views (findings-darkkeys): no ring on a selected timeline bar (K10).
    // +1_730: the property menu name field (K04), dark OPEN pill (K06), switches (K11) and date picker dividers (K12).
    const DATABASE_KEYS_VIEWS_BYTES = 233 + 1_730;
    // database.css: creation panels (findings-creation N03, N19): 44px tile rows, 30px tiles, 20px glyphs, the 10px box.
    // +1_449: the unlinked linked view's pill, folder glyph, "New table" and its dark border token (N18, N22).
    // +884: the empty feed's ringed "+ New page" tile (N20).
    // +2_393: tinted template cards, the status pill dot and the Customize preview's tab and header glyphs (N06, N07).
    const DATABASE_CREATION_FEEL_BYTES = 1_434 + 1_449 + 884 + 2_393;
    // assistant.css: the Ask AI answer lands in bloom (the rose draws in colour, the text reveals soft to sharp), head aligned to its first line.
    const ASSISTANT_BLOOM_BYTES = 2_752;
    // database.css: feel/findings-toolbar V01-V04, V26, V27, V32, V33: the one-view title row, its "…",
    // the Add view tile grid and the tab row sizes (measured as the file's growth).
    const DATABASE_VIEW_TABS_BYTES = 3_418;
    // database.css: the row page label cell, icon and handle crossfade, 4px value, status dot gap, add-property plus.
    const DATABASE_ROW_PAGE_PARITY_BYTES = 2_308;
    // database.css: editors over a row page value (notion-spec §7): the 38px text box,
    // plus 1_232 for the select and status pickers' 12px insets, handles and check marks.
    const DATABASE_VALUE_EDITOR_BYTES = 202 + 1_232;
    // database.css: the add-property menu as Notion's (290px, one column, type glyph, AI Autofill rows),
    // plus 775 for the "Type" search line.
    const DATABASE_ADD_PROPERTY_MENU_BYTES = 1_351 + 775;
    // database.css: the date picker laid out as Notion's (field look, 20px header, 28px days, row insets and dividers).
    const DATABASE_DATE_PICKER_BYTES = 773;
    // database.css: the row page's full-size type glyph, plus 172 for Notion's side peek insets,
    // plus 999 for the status picker's group rhythm.
    const DATABASE_ROW_PAGE_FINISH_BYTES = 18 + 172 + 999;
    // database.css: the Edit property panel's Show as tiles (Number, Bar, Ring).
    const DATABASE_SHOW_AS_TILES_BYTES = 1_515;
    // database.css: a Number's Bar or Ring keeps its size in a block-level table cell.
    const DATABASE_NUMBER_GAUGE_BYTES = 470;
    // database.css: Bar and Ring at Notion's size and colours, the ring as an svg (notion-spec-2 §7).
    const DATABASE_NUMBER_GAUGE_SPEC_BYTES = 1_334;
    // database.css: the row page panel's plain-text values, plus Notion-sized tiles and gauges.
    const DATABASE_PANEL_VALUES_TILES_BYTES = 1_069;
    // database.css: the row page title text starts over the label icons (side peek and full page).
    const DATABASE_ROW_PAGE_TITLE_INSET_BYTES = 316;
    // database.css: the row page panel's Color / Divide by box and its inset all-views note.
    const DATABASE_PANEL_GAUGE_BOX_BYTES = 2_664;
    // database.css: the Edit property panel's 8px inset, and the gauge box, tiles and down chevron in the header submenu too.
    const DATABASE_PANEL_INSET_HEADER_BOX_BYTES = 4_624;
    // database.css: the Edit formula row's chevron ends 8px from the row end.
    const DATABASE_EDIT_FORMULA_CHEVRON_BYTES = 144;
    // database.css: the yellow gauge's own 3:1 token, light and dark.
    const DATABASE_GAUGE_YELLOW_BYTES = 273;
    // database.css: the gauge box's Show number row and the property menu switch row.
    const DATABASE_SHOW_NUMBER_BYTES = 1_744;
    // assistant.css: the Ask AI question before an unlock (Keep locked / Unlock) and its comment.
    const ASSISTANT_UNLOCK_QUESTION_BYTES = 359;
    // database.css: database submenus keep the database inks; header submenus read 14px regular.
    const DATABASE_SUBMENU_TEXT_BYTES = 886;
    // database.css: the layout reset row, Notion's 56px menu with the u-turn glyph.
    const DATABASE_LAYOUT_RESET_ROW_BYTES = 1_006;
    // database.css: each colour swatch's ring in its own colour, and the ten dark ring tokens in both dark blocks.
    const DATABASE_SWATCH_RING_BYTES = 3_163;
    // database.css: the database switch's own 3:1 off track, light.
    const DATABASE_SWITCH_OFF_TRACK_BYTES = 176;
    // database.css: one 14px rule for every header-look menu, Notion's 296px Color list, the reset glyph's ink.
    const DATABASE_MENU_FOLLOWUPS_BYTES = 500;
    // database.css: Show original of a Number as one gauge per value, and the Color button's fill while its list is open.
    const DATABASE_ROLLUP_LIST_COLOR_BUTTON_BYTES = 3_239;
    // database.css: a card's lone gauge (full bar, 18px ring), the gallery's 11px inset, the peek's Comments heading.
    const DATABASE_CARD_GAUGE_COMMENTS_HEADING_BYTES = 1_818;
    // database.css: a numeric rollup at the table cell's end in tabular figures.
    const DATABASE_ROLLUP_NUMERIC_CELL_BYTES = 355;
    // database.css: the side peek's wrapped rollup list (6px lines, 21px items), a card Number's bar across the line.
    const DATABASE_PEEK_LIST_CARD_BAR_BYTES = 490;
    // database.css: a card's rollup list items never grow, even when the list wraps.
    const DATABASE_CARD_LIST_ITEM_BYTES = 181;
    // database.css: lists off the Edit property panel pad 4px, open on the current row in the hover tint, keep a checked row unfilled; the type list's "Type" line.
    const DATABASE_PANEL_LIST_BYTES = 2_428;
    // database.css: the Related property name field of Add related property (notion-spec-2 §17.1).
    const DATABASE_MIRROR_NAME_FIELD_BYTES = 863;
    // database.css: panel lists cap at 70vh; Target property's search field takes Notion's size.
    const DATABASE_PANEL_LIST_CAP_SEARCH_BYTES = 666;
    // database.css: tabular figures in table Number and Formula cells (research/35 §17).
    const DATABASE_TABLE_TABULAR_FIGURES_BYTES = 240;
    // database.css: table cell editors open with no fade or scale (research/08 Motion).
    const DATABASE_TABLE_EDITOR_NO_MOTION_BYTES = 406;
    // database.css: a number formula sits at the end of its table cell (notion-spec-2 §19.13).
    const DATABASE_FORMULA_NUMBER_END_BYTES = 129;
    // database.css: a Number or number formula cell's Comment + Copy box hugs the start edge (notion-spec-2 §19.20).
    const DATABASE_CELL_PILL_START_BYTES = 460;
    // database.css: a number rollup's box hugs the start edge; Configure rollup is 20 wide (notion-spec-2 §18.2).
    const DATABASE_ROLLUP_CELL_ACTIONS_BYTES = 197;
    // main.css: Tailwind skips the pptx engine folder (cafd284d).
    const MAIN_PPTX_SOURCE_SKIP_BYTES = 119;
    // database.css: an unchecked table checkbox fills on hover (notion-spec-2 §18.2).
    const DATABASE_CHECKBOX_HOVER_BYTES = 750;
    // database.css: peek value editors open with no fade or scale too (notion-spec-2 §19.22).
    const DATABASE_VALUE_EDITOR_NO_MOTION_BYTES = 306;
    // database.css: the Place search's one highlighted row (research/36 §7); no ring on the focused place view.
    const DATABASE_PLACE_ROW_HIGHLIGHT_BYTES = 257;
    // database.css: Add a property's "Search types…" field opens under the Type label (notion-spec-2 §18.5).
    const DATABASE_ADD_PROPERTY_SEARCH_BYTES = 308;
    // database.css: the table header "+" picker's 400-wide two-column grid (research/08).
    const DATABASE_HEADER_PICKER_GRID_BYTES = 418;
    // database.css: the table status picker takes Notion's 240x289 layout (notion-spec-2 §18.3).
    const DATABASE_STATUS_PICKER_TABLE_BYTES = 1_620;
    // database.css: the person picker takes Notion's 240-wide layout (notion-spec-2 §18.3).
    const DATABASE_PERSON_PICKER_BYTES = 759;
    // database.css: the table relation picker takes Notion's head, label and 32px page rows (notion-spec-2 §18.3).
    const DATABASE_RELATION_PICKER_BYTES = 1_019;
    // database.css: the table relation picker's "Select more" label (notion-spec-2 §19.2).
    const DATABASE_RELATION_GROUPS_BYTES = 92;
    // database.css: the table relation picker's 4px rows and "+" / "−" button (notion-spec-2 §19.15).
    const DATABASE_RELATION_TOGGLE_BYTES = 1_408;
    // database.css: Select and Multi-select picker rows place the handle and "⋯" as measured (notion-spec-2 §19.14).
    const DATABASE_SELECT_ROW_INSET_BYTES = 568;
    // database.css: a lone file chip fills its table cell (notion-spec-2 §18.1).
    const DATABASE_FILE_CHIP_FILL_BYTES = 423;
    // database.css: the picker head's 9.25px as one token, and the 1px row gaps as the space token.
    const DATABASE_PICKER_LENGTH_TOKENS_BYTES = 275;
    // database.css: the select head, hint and option "⋯" take Notion's sizes (research/08).
    const DATABASE_SELECT_PICKER_BYTES = 287;
    // database.css: the table picker rules are scoped off the row page, which keeps its own measurements.
    const DATABASE_TABLE_PICKER_SCOPE_BYTES = 1_796;
    // file.css: the Word preview's paper, page and note rules; its renderer writes inline styles only.
    const DOCX_PAPER_BYTES = 1_224;
    // database.css + keyframes.css: Add a property closes as its open in reverse (notion-spec-2 §19.22).
    const DATABASE_ADD_PROPERTY_CLOSE_BYTES = 432;
    // database.css: the table header "+" name box in the header cell, its grid at half the window (notion-spec-2 §19.11).
    const DATABASE_HEADER_PLUS_NAME_BOX_BYTES = 907;
    // fonts.css: the inlined woff2 from the 04519541 dependency refresh is 148 bytes larger.
    const FONT_REFRESH_BYTES = 148;
    // database.css: the formula warning mark, inline in the secondary ink at 16px (db0d20e6, 2deaa2a2).
    const DATABASE_FORMULA_ERROR_MARK_BYTES = 212;
    // database.css: the confirm dialog scrolls, so a button's long agent message can be read to its end.
    const DATABASE_CONFIRM_SCROLL_BYTES = 219;
    // database.css: the bar over a filled place, its address chip and its token (notion-spec-2 §19.18).
    const DATABASE_PLACE_VIEW_BAR_BYTES = 1_090;
    // database.css: the gallery card file chip (notion-spec-2 §19.17).
    const DATABASE_GALLERY_FILE_CHIP_BYTES = 577;
    // database.css: the Button's press fill, its fade and its card row (notion-spec-2 §19.19).
    const DATABASE_BUTTON_PRESS_BYTES = 664;
    // database.css: the Place hover card paints its own white surface (notion-spec-2 §19.18).
    const DATABASE_PLACE_CARD_SURFACE_BYTES = 408;
    // database.css: the table files box and its Upload / Link panel (notion-spec-2 §18.3, §19.17, §19.22).
    const DATABASE_FILES_PICKER_BYTES = 5_422;
    // database.css: the URL cell's grey path and the header menu's Show full URL switch row (notion-spec-2 §18.1, §19.21).
    const DATABASE_URL_PATH_AND_SWITCH_ROW_BYTES = 955;
    // database.css: the relation chip's page icon and underlined 500 title (notion-spec-2 §18.1, §19.17).
    const DATABASE_RELATION_CHIP_BYTES = 1_107;
    // database.css: the option search takes no natural width, so the picker stays 300 (notion-spec-2 §19.1).
    const DATABASE_SELECT_SEARCH_WIDTH_BYTES = 154;
    // database.css: the database icon in the table relation picker's head (notion-live-3/relation-editor.png).
    const DATABASE_RELATION_SCOPE_ICON_BYTES = 456;
    // database.css: a table file name stays on one line in a wrapping cell (notion-spec-2 §18.1).
    const DATABASE_TABLE_FILE_NAME_LINE_BYTES = 99;
    // isolation.css: the body-mounted link hover card gets Blok's font, not the host page's.
    const LINK_HOVER_CARD_FONT_BYTES = 205;
    // database.css: a person cell's 20px line keeps the 37px row (notion-spec-2 §18.1).
    const DATABASE_TABLE_PILL_LINE_BYTES = 364;
    // database.css: Status, Created by and Last edited by cells pad 8px (notion-spec-2 §18.1, §20.1).
    const DATABASE_TABLE_PILL_CELL_PADDING_BYTES = 327;
    // database.css: a checked table checkbox has no border (notion-spec-2 §18.1).
    const DATABASE_TABLE_CHECKBOX_NO_BORDER_BYTES = 229;
    // database.css: time cells never wrap, "by" names end in "…", 18px gallery avatars (notion-spec-2 §20.1).
    const DATABASE_STAMP_CELLS_BYTES = 1_878;
    // database.css: the rollup setup menu's floor width, labels and rules (notion-spec-2 §20.11).
    const DATABASE_ROLLUP_SETUP_BYTES = 1_071;
    // database.css: a gallery card's checkbox name beside the box (notion-spec-2 §19.17).
    const DATABASE_GALLERY_CHECKBOX_NAME_BYTES = 273;
    // database.css: gallery card pills 18 tall, 12/18 (notion-spec-2 §19.17).
    const DATABASE_GALLERY_PILL_BYTES = 249;
    // database.css: Relation cells pad 8px on a 20px line (notion-spec-2 §21.5).
    const DATABASE_TABLE_RELATION_CELL_PADDING_BYTES = 80;
    // database.css: the Edit formula box's 12px radius and its title row with a close × (notion-spec-2 §18.3).
    const DATABASE_FORMULA_BOX_BYTES = 970;
    // database.css: the side peek's first property sits 17px under the title (notion-live-3/raw/peek-1.png).
    const DATABASE_PEEK_FIRST_ROW_BYTES = 220;
    // database.css: the Edit formula box stays inside a narrow window.
    const DATABASE_FORMULA_BOX_CAP_BYTES = 169;
    // database.css: Text, Number, Date and URL cells are cut with no ellipsis (notion-spec-2 §21.1, §22.4).
    const DATABASE_TABLE_TEXT_CLIP_BYTES = 326;
    // database.css: a board card's Button row pads 4px, as the gallery's (notion-spec-2 §21.7).
    const DATABASE_BOARD_BUTTON_ROW_BYTES = 103;
    // database.css: a board card's checkbox, 14x14 with its name beside it (notion-spec-2 §21.7).
    const DATABASE_BOARD_CHECKBOX_BYTES = 310;
    // database.css: 18px avatars on a board card (notion-spec-2 §21.7).
    const DATABASE_BOARD_AVATAR_BYTES = 201;
    // database.css: a board card's file chip, 20 tall, at most 200 wide (notion-spec-2 §21.7).
    const DATABASE_BOARD_FILE_CHIP_BYTES = 280;
    // database.css: a board card's relation chip, 14.4px glyph and 12/18 title (notion-spec-2 §21.7).
    const DATABASE_BOARD_RELATION_CHIP_BYTES = 454;
    // database.css: a board card's status pill takes the 12/18 card pill (notion-spec-2 §21.7).
    const DATABASE_BOARD_STATUS_PILL_BYTES = 37;
    // database.css: checked peek and card checkboxes have no border, card boxes 14x14 (notion-spec-2 §21.4).
    const DATABASE_PEEK_CARD_CHECKBOX_BYTES = 362;
    // database.css: a related page's own emoji in its chip, 18px, 14.4px on a card (notion-spec-2 §21.6).
    const DATABASE_RELATION_CHIP_EMOJI_BYTES = 412;
    // database.css: a table file's "⋯", its View original / Rename / Delete menu and Rename field (notion-spec-2 §21.3).
    const DATABASE_FILE_MENU_BYTES = 2_258;
    // database.css: the table relation picker's divider and "+ New <query> in <database>" row (notion-spec-2 §21.2).
    const DATABASE_RELATION_CREATE_ROW_BYTES = 1_751;
    // database.css: the table relation picker's page-row highlight fill (notion-spec-2 §22.2).
    const DATABASE_RELATION_HIGHLIGHT_BYTES = 369;
    // database.css: the table file "⋯" radius, menu row gap and 364px Rename field (notion-spec-2 §22.3).
    const DATABASE_FILE_MENU_MEASURED_BYTES = 587;
    const CEILING = Math.floor(PRE_SPLIT_BYTES * 1.4805) + 1_162 + 2_854 + 9_383 + 3_437 + 952
      + CONVERSION_TYPOGRAPHY_PICKER_BYTES + REMOTE_SELECTION_SHADE_BYTES + EQUATION_EDITING_CHIP_BYTES + INLINE_MENU_MOTION_BYTES
      + SLASH_PILL_SPAN_BYTES
      + CONVERT_MENU_RAMP_BYTES
      + SLOT_INDENT_BYTES
      + FIND_IN_PAGE_BYTES
      + ASSISTANT_BAR_BYTES
      + ASSISTANT_THINKING_PICKER_BYTES
      + ASSISTANT_REPLY_MARKDOWN_BYTES
      + EMOJI_DEFERRED_SECTIONS_BYTES
      + PRESENCE_TONAL_GLYPHS_BYTES
      + TRASH_LID_HOVER_BYTES
      + DICE_ROLL_HOVER_BYTES
      + INLINE_TOOLBAR_CARD_BYTES
      + INLINE_TOOLBAR_ENTRANCE_BYTES
      + MEDIA_EMPTY_PREVIEW_BYTES
      + NOTHING_FOUND_SEARCH_PREVIEW_BYTES
      + PLUS_BUTTON_SEARCH_PILL_BYTES
      + IMAGE_CHROME_ISLANDS_BYTES
      + IMAGE_MEND_BYTES
      + IMAGE_ERROR_SHAPES_BYTES
      + NOTIFIER_MEDIA_CARD_BYTES
      + SPOTLIGHT_BYTES
      + NOTIFIER_CARD_STACK_BYTES
      + NOTIFIER_CARD_LAUNCH_BYTES
      + TABLE_OF_CONTENTS_BYTES
      + MEDIA_RADIUS_ROLES_BYTES
      + RADIUS_SYSTEM_BYTES
      + DARKROOM_EDIT_PANELS_BYTES
      + DARKROOM_MARKUP_BYTES
      + DARKROOM_FILTER_STRIP_BYTES
      + LOADING_SKELETON_BYTES
      + TOOLBOX_HOVER_PREVIEWS_BYTES
      + TABLE_FRAME_BYTES
      + CELL_PLACEHOLDER_BYTES
      + VIDEO_SPEED_PRESET_BYTES
      + DARKROOM_NAVIGATION_BYTES
      + TABLE_CORNER_AND_PILL_BYTES
      + FOCUS_MODALITY_BYTES
      + FIND_OPTIONS_SAVINGS_BYTES
      + SPACING_TOKEN_REFERENCES_BYTES
      + SHAPE_PICKER_LIVE_INK_BYTES
      + SHAPE_PICKER_TIMING_TOKENS_BYTES
      + IMAGE_CHROME_PAPER_GRAPHITE_BYTES
      + AUDIO_ERROR_PLAYER_BYTES
      + AUDIO_BEAT_MOTION_BYTES
      + EMBED_LIVING_WINDOW_BYTES
      + VIDEO_NO_SIGNAL_BYTES
      + IMAGE_RESEND_BYTES
      + TABS_TOOLBOX_PREVIEW_BYTES
      + TABS_BLOCK_BYTES
      + TABS_FOLDER_LOOK_BYTES
      + TABS_FOCUS_RING_BYTES
      + TABS_EMPTY_HINT_BYTES
      + PAGE_TITLE_HEADER_BYTES
      + AGENT_MARKER_BYTES
      + FIND_FIELD_COLUMN_BYTES
      + DATABASE_REDUCED_MOTION_BYTES
      + DATABASE_CELL_EDITORS_BYTES
      + DATABASE_TABLE_VIEW_BYTES
      + DATABASE_PROPERTY_TYPES_BYTES
      + DATABASE_BOARD_PARITY_BYTES
      + POPOVER_CLOSE_MOTION_BYTES
      + DATABASE_VIEW_SETTINGS_BYTES
      + DATABASE_GALLERY_CALENDAR_BYTES
      + DATABASE_TIMELINE_BYTES
      + DATABASE_BOARD_CARD_BYTES
      + DATABASE_COMPUTED_PROPERTIES_BYTES
      + DATABASE_ROW_PAGE_BYTES
      + DATABASE_CHART_FEED_BYTES
      + DATABASE_STRUCTURE_BYTES
      + DATABASE_BACKLOG_BYTES
      + DATABASE_ROW_PAGE_LAYOUT_BYTES
      + DATABASE_TIER3_VIEWS_BYTES
      + DATABASE_PEEK_SELECTION_BYTES
      + DATABASE_LOOK_PARITY_BYTES
      + DATABASE_OPTIONS_EDITOR_BYTES
      + DATABASE_LIST_VIEW_BYTES
      + DATABASE_TITLE_ICON_MENU_BYTES
      + DATABASE_FORM_PROVIDER_BUILDER_BYTES
      + DATABASE_AI_AUTOFILL_BYTES
      + DATABASE_GHOST_CONTEXT_BYTES
      + DATABASE_LAYOUT_BUILDER_BYTES
      + DATABASE_CELL_BUTTON_KEYBOARD_BYTES
      + DATABASE_COMMENT_BADGE_BYTES
      + DATABASE_CALENDAR_EVENT_BADGE_BYTES
      + DATABASE_VIEW_OVERFLOW_LIST_BYTES
      + DATABASE_PROPERTY_NAME_CLASH_BYTES
      + DATABASE_VIEW_PAGE_ICON_BYTES
      + DATABASE_GALLERY_KEYBOARD_BYTES
      + DATABASE_TABLE_LINK_CELL_PILL_BYTES
      + DATABASE_BOARD_CALCULATION_BYTES
      + DATABASE_ROW_PAGE_ACTIONS_BYTES
      + DATABASE_DATE_REMINDERS_BYTES
      + DATABASE_FEED_REACTIONS_BYTES
      + DATABASE_FORM_SHARE_BYTES
      + DATABASE_FORM_RESPONSE_BYTES
      + DATABASE_FORM_PREVIEW_BYTES
      + DATABASE_ROW_PAGE_BACKLINKS_BYTES
      + DATABASE_ROW_COMMENTS_EMPTY_BYTES
      + DATABASE_BUILT_IN_COMMENTS_BYTES
      + DATABASE_FEED_COMMENTS_BYTES
      + DATABASE_MAP_PLACE_BYTES
      + DATABASE_PLACE_CHIP_BYTES
      + DATABASE_MAPLIBRE_BYTES
      + DATABASE_LINKED_VIEW_BYTES
      + DATABASE_GALLERY_CARD_ACTIONS_BYTES
      + DATABASE_LIST_ROW_HANDLE_BYTES
      + DATABASE_FORM_QUESTION_NAME_CLASH_BYTES
      + DATABASE_AUTOFILL_CELL_PILL_BYTES
      + DATABASE_ROW_PAGE_TAB_OVERFLOW_BYTES
      + DATABASE_DARK_PEEK_BUILDER_BYTES
      + DATABASE_DARK_VIEWS_BYTES
      + DATABASE_ROW_PAGE_FAVORITE_BYTES
      + DATABASE_DARK_TABLE_CHROME_BYTES
      + DATABASE_DATE_REMINDER_INLINE_BYTES
      + DATABASE_PEEK_POLISH_BYTES
      + DATABASE_VIEW_HOVER_CHROME_BYTES
      + DATABASE_CARD_PILL_RADIUS_BYTES
      + DATABASE_TEMPLATE_REPEAT_BYTES
      + DATABASE_TIMELINE_CALENDAR_LAYOUT_BYTES
      + DATABASE_SIDE_PEEK_WIDTH_BYTES
      + DATABASE_GROUP_RANGE_TEXT_BYTES
      + DATABASE_CELL_EDITOR_LOOK_BYTES
      + DATABASE_LINK_CELL_UNDERLINE_BYTES
      + DATABASE_TEMPLATE_CADENCE_BYTES
      + DATABASE_PEEK_VALUE_ROW_BYTES
      + DATABASE_DATE_PICKER_ROWS_BYTES
      + DATABASE_DARK_GAPS_STAR_BYTES
      + DATABASE_CALENDAR_BOX_BYTES
      + DATABASE_TIME_ZONE_MENU_BYTES
      + DATABASE_TIMELINE_HANDLE_MAP_PIN_BYTES
      + DATABASE_BACKLINK_CRUMBS_BYTES
      + DATABASE_DARK_LEFTOVERS_BYTES + DATABASE_BACKLINK_RIGHT_PATH_BYTES
      + DATABASE_NOTION_ELEMENTS_BYTES
      + DATABASE_PROPERTY_DESCRIPTION_FIELD_BYTES
      + DATABASE_LIGHT_VALUES_BYTES
      + ASSISTANT_LIVE_PREVIEW_BYTES
      + ASSISTANT_REWRITE_PREVIEW_BYTES
      + ASSISTANT_FALLBACK_REVEAL_BYTES
      + ASSISTANT_IN_PAGE_BAR_BYTES
      + ASSISTANT_PREVIEW_HEADING_SPECIFICITY_BYTES
      + DATABASE_LAST_VIEW_CHOICE_BYTES
      + DATABASE_MANAGE_CALENDAR_BYTES
      + DATABASE_TIMELINE_CHIP_HOVER_BYTES
      + DATABASE_STARTER_TEMPLATES_BYTES
      + DATABASE_PRESSED_FILLS_BYTES
      + DATABASE_CSV_IMPORT_BYTES
      + DATABASE_MAP_VIEW_PREVIEW_BYTES
      + DATABASE_SLASH_VIEW_PREVIEWS_BYTES
      + DATABASE_CADENCE_SETTINGS_BYTES
      + DATABASE_STARTER_ICON_BYTES
      + DATABASE_HELP_LINKS_BYTES
      + DATABASE_PROPERTY_DESCRIPTION_BUTTON_BYTES
      + DATABASE_TIME_ZONE_ROWS_BYTES
      + POPOVER_SEARCH_SUFFIX_INK_BYTES
      + POPOVER_ITEM_LABEL_INK_BYTES
      + DATABASE_CONFIRM_CLOSE_BYTES
      + DATABASE_MORE_TEMPLATES_BYTES
      + ASSISTANT_REPLACED_BLOCK_BYTES
      + ASSISTANT_HALO_BUTTONS_BYTES
      + ASSISTANT_ROSE_LIGHT_BYTES
      + DATABASE_BAND_TOGGLE_BYTES
      + DATABASE_PURPLE_TEMPLATE_TILE_BYTES
      + SELECTED_OWN_BLOCK_BYTES
      + DATABASE_SELECT_CHEVRON_BYTES
      + DATABASE_NOTION_COLOURS_BYTES
      + DATABASE_STATUS_DEFAULT_BYTES
      + DATABASE_PREVIEW_GROUPS_BYTES
      + DATABASE_CARD_LAYOUT_BYTES
      + DATABASE_NOTION_COLOURS_PASS2_BYTES
      + DATABASE_CONFIRM_LOOK_BYTES
      + DATABASE_PINK_TEMPLATE_TILE_BYTES
      + DATABASE_CONFIRM_LARGE_TITLE_BYTES
      + DATABASE_CAL_TIMELINE_HALO_BYTES
      + DATABASE_ROUND13_BOARD_TOOLBAR_BYTES
      + DATABASE_CONFIRM_ROUND13_BYTES
      + DATABASE_DESCRIPTION_FIELD_CAP_BYTES
      + DATABASE_PLACE_VIEW_BYTES
      + DATABASE_PLACE_CARD_MAP_BYTES
      + DATABASE_ROUND14_COLOURS_BYTES
      + ASSISTANT_SELECTION_TINT_BYTES + DATABASE_PLAIN_CONFIRM_BYTES + ASSISTANT_ACTIONS_FOLD_BYTES
      + ASK_AI_MENU_MOTION_BYTES + ASK_AI_SKILL_ICONS_BYTES + BOOKMARK_PEEL_COVER_BYTES
      + NOTION_FONT_STACK_BYTES
      + DATABASE_DARK_RESET_MAP_BYTES
      + DATABASE_TEMPLATE_MENU_ROWS_BYTES
      + DATABASE_TITLE_PLACEHOLDER_BYTES
      + DATABASE_TOOLBAR_DISABLED_BYTES
      + DATABASE_LIST_GALLERY_BYTES
      + DATABASE_TABLE_GRID_FEEL_BYTES
      + DATABASE_HEADER_MENU_BYTES
      + DATABASE_ADD_PROPERTY_GRID_BYTES
      + DATABASE_ROW_MENU_BYTES
      + DATABASE_STATUS_POPOVER_BYTES
      + DATABASE_MULTI_HANDLES_BYTES
      + DATABASE_SELECTION_BAR_BYTES
      + DATABASE_FILTER_LIST_ACTIVE_BYTES
      + DATABASE_SELECTION_BAR_BOARD_BYTES
      + DATABASE_BOARD_COLUMNS_BYTES
      + DATABASE_CARD_TITLE_EDIT_BYTES
      + DATABASE_CARD_GLYPH_SIZE_BYTES
      + DATABASE_ROW_MENU_HEIGHT_BYTES
      + DATABASE_CARD_SELECT_PILL_BYTES
      + DATABASE_CARD_GHOST_ROWS_BYTES
      + DATABASE_CARD_PLACEHOLDER_AA_BYTES
      + DATABASE_FILTER_SORT_FEEL_BYTES
      + DATABASE_VIEW_SETTINGS_DOCK_BYTES
      + DATABASE_VIEW_SETTINGS_DOCK_BYTES
      + DATABASE_VIEW_SETTINGS_GLYPH_BYTES
      + DATABASE_VIEW_SETTINGS_NAME_BYTES
      + DATABASE_VIEW_SETTINGS_LAYOUT_TILES_BYTES
      + DATABASE_VIEW_SETTINGS_PROPERTY_EYES_BYTES
      + DATABASE_VIEW_SETTINGS_BACK_BYTES
      + DATABASE_ROW_PAGE_PROPS_BYTES
      + DATABASE_ROW_PAGE_MENU_BYTES
      + DATABASE_CAL_TIMELINE_FEEL_BYTES
      + DATABASE_PEEK_SHELL_BYTES
      + DATABASE_CREATION_FEEL_BYTES
      + ASSISTANT_BLOOM_BYTES
      + DATABASE_KEYS_VIEWS_BYTES
      + DATABASE_VIEW_TABS_BYTES
      + DATABASE_ROW_PAGE_PARITY_BYTES
      + DATABASE_VALUE_EDITOR_BYTES
      + DATABASE_ADD_PROPERTY_MENU_BYTES
      + DATABASE_DATE_PICKER_BYTES
      + DATABASE_ROW_PAGE_FINISH_BYTES
      + DATABASE_SHOW_AS_TILES_BYTES
      + DATABASE_NUMBER_GAUGE_BYTES
      + DATABASE_NUMBER_GAUGE_SPEC_BYTES
      + DATABASE_PANEL_VALUES_TILES_BYTES
      + DATABASE_ROW_PAGE_TITLE_INSET_BYTES
      + DATABASE_PANEL_GAUGE_BOX_BYTES
      + DATABASE_PANEL_INSET_HEADER_BOX_BYTES
      + DATABASE_EDIT_FORMULA_CHEVRON_BYTES
      + DATABASE_GAUGE_YELLOW_BYTES
      + DATABASE_SHOW_NUMBER_BYTES
      + ASSISTANT_UNLOCK_QUESTION_BYTES
      + DATABASE_SUBMENU_TEXT_BYTES
      + DATABASE_SUBMENU_TEXT_BYTES
      + DATABASE_LAYOUT_RESET_ROW_BYTES
      + DATABASE_SWATCH_RING_BYTES
      + DATABASE_SWITCH_OFF_TRACK_BYTES
      + DATABASE_MENU_FOLLOWUPS_BYTES
      + DATABASE_ROLLUP_LIST_COLOR_BUTTON_BYTES
      + DATABASE_CARD_GAUGE_COMMENTS_HEADING_BYTES
      + DATABASE_ROLLUP_NUMERIC_CELL_BYTES
      + DATABASE_PEEK_LIST_CARD_BAR_BYTES
      + DATABASE_CARD_LIST_ITEM_BYTES
      + DATABASE_PANEL_LIST_BYTES
      + FONT_REFRESH_BYTES
      + DATABASE_FORMULA_ERROR_MARK_BYTES
      + DATABASE_MIRROR_NAME_FIELD_BYTES
      + DATABASE_PANEL_LIST_CAP_SEARCH_BYTES
      + DATABASE_CONFIRM_SCROLL_BYTES
      + DATABASE_TABLE_TABULAR_FIGURES_BYTES
      + DATABASE_TABLE_EDITOR_NO_MOTION_BYTES
      + DATABASE_PLACE_ROW_HIGHLIGHT_BYTES
      + DATABASE_ADD_PROPERTY_SEARCH_BYTES
      + DATABASE_HEADER_PICKER_GRID_BYTES
      + DATABASE_STATUS_PICKER_TABLE_BYTES
      + DATABASE_PERSON_PICKER_BYTES
      + DATABASE_RELATION_PICKER_BYTES
      + DATABASE_RELATION_GROUPS_BYTES
      + DATABASE_RELATION_TOGGLE_BYTES
      + DATABASE_SELECT_ROW_INSET_BYTES
      + DATABASE_FILE_CHIP_FILL_BYTES
      + DATABASE_PICKER_LENGTH_TOKENS_BYTES
      + DATABASE_SELECT_PICKER_BYTES
      + DATABASE_TABLE_PICKER_SCOPE_BYTES
      + DOCX_PAPER_BYTES
      + DATABASE_ADD_PROPERTY_CLOSE_BYTES
      + DATABASE_HEADER_PLUS_NAME_BOX_BYTES
      + DATABASE_FORMULA_NUMBER_END_BYTES
      + DATABASE_CELL_PILL_START_BYTES
      + DATABASE_ROLLUP_CELL_ACTIONS_BYTES
      + MAIN_PPTX_SOURCE_SKIP_BYTES
      + DATABASE_CHECKBOX_HOVER_BYTES
      + DATABASE_VALUE_EDITOR_NO_MOTION_BYTES
      + DATABASE_PLACE_VIEW_BAR_BYTES
      + DATABASE_GALLERY_FILE_CHIP_BYTES
      + DATABASE_BUTTON_PRESS_BYTES
      + DATABASE_PLACE_CARD_SURFACE_BYTES
      + DATABASE_FILES_PICKER_BYTES
      + DATABASE_URL_PATH_AND_SWITCH_ROW_BYTES
      + DATABASE_RELATION_CHIP_BYTES
      + DATABASE_SELECT_SEARCH_WIDTH_BYTES
      + DATABASE_RELATION_SCOPE_ICON_BYTES
      + DATABASE_TABLE_FILE_NAME_LINE_BYTES
      + LINK_HOVER_CARD_FONT_BYTES
      + DATABASE_TABLE_PILL_LINE_BYTES
      + DATABASE_TABLE_PILL_CELL_PADDING_BYTES
      + DATABASE_TABLE_CHECKBOX_NO_BORDER_BYTES
      + DATABASE_STAMP_CELLS_BYTES
      + DATABASE_ROLLUP_SETUP_BYTES
      + DATABASE_GALLERY_CHECKBOX_NAME_BYTES
      + DATABASE_GALLERY_PILL_BYTES
      + DATABASE_TABLE_RELATION_CELL_PADDING_BYTES
      + DATABASE_FORMULA_BOX_BYTES
      + DATABASE_PEEK_FIRST_ROW_BYTES
      + DATABASE_FORMULA_BOX_CAP_BYTES
      + DATABASE_TABLE_TEXT_CLIP_BYTES
      + DATABASE_BOARD_BUTTON_ROW_BYTES
      + DATABASE_BOARD_CHECKBOX_BYTES
      + DATABASE_BOARD_AVATAR_BYTES
      + DATABASE_BOARD_FILE_CHIP_BYTES
      + DATABASE_BOARD_RELATION_CHIP_BYTES
      + DATABASE_BOARD_STATUS_PILL_BYTES
      + DATABASE_PEEK_CARD_CHECKBOX_BYTES
      + DATABASE_RELATION_CHIP_EMOJI_BYTES
      + DATABASE_FILE_MENU_BYTES
      + DATABASE_RELATION_CREATE_ROW_BYTES
      + DATABASE_RELATION_HIGHLIGHT_BYTES
      + DATABASE_FILE_MENU_MEASURED_BYTES;
    const actual = localImportedByteBudget(ENTRY);

    expect(actual).toBeLessThanOrEqual(CEILING);
  });
});
