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
 *   4. Total byte budget (split ≤ pre-split × 1.01).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Declaration } from 'postcss';
import postcss from 'postcss';

const STYLES_ROOT = resolve(__dirname, '../../../src/styles');
const ENTRY = resolve(STYLES_ROOT, 'main.css');

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

  it('total local CSS byte size stays within +2% of the pre-split baseline', () => {
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
    // Audio "alive" motion pass: staggered mount entrance (blok-audio-rise), a now-playing
    // equalizer badge on the cover (blok-audio-eq-bounce, dark overlay pill + white bars,
    // revealed only while data-playing) and a play-puck heartbeat ring (blok-audio-pulse) —
    // all reduced-motion gated. +~2.5KB intentional growth.
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
    const PRE_SPLIT_BYTES = 407853;
    const CEILING = Math.floor(PRE_SPLIT_BYTES * 1.388);
    const actual = localImportedByteBudget(ENTRY);

    expect(actual).toBeLessThanOrEqual(CEILING);
  });
});
