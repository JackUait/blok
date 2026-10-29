# Parity: src/html vs parse5 8.0.1

Verdict: **better than the original.** Every must-have is done, outputs match parse5 wherever parse5 follows the spec, and it is faster and smaller.

## Scores

- Feature parity: **100 / 100**. 13 of 13 must-haves, 1 should-have. Nine parse5 features are left out on purpose, see `features.csv`.
- No screens, so there is no layout score.

## Evidence

| Check | Result |
|---|---|
| html5lib tokenizer suite | 7032 / 7032 |
| html5lib tree construction (upstream + fork) | 1745 pass; 27 `#script-off` skipped by design; parse5's 6 known-outdated fork cases fail for both |
| Token stream vs parse5, run boundaries included | 0 diffs (corpus, 20k fuzz, 7 start states) |
| Trees vs parse5 | 0 diffs over ~1M comparisons (lane B) and 1.05M adversarial parses (security review) |
| Serializer vs parse5 | byte-identical on 61k trees |
| Call-site goldens recorded on parse5 | byte-identical: 30+ functions, ~7,100 inputs, including the inputs that throw |
| Throws on lone surrogates | exactly where parse5 does: 95 hand cases + 120k fuzz |

## Behaviour differences

| Flow | parse5 8.0.1 does | src/html does | Keep or fix |
|---|---|---|---|
| A name that needs `;` but lacks it (`&Gdot `) | decodes it and eats the next character (bug in its `entities@8.0.0`) | leaves it as text, as the spec says | keep: bug fix, release-note line |
| An attribute like `&centerdot` | decodes `&cent` | leaves it literal (attribute rule) | keep: bug fix |
| 64k distinct attributes on one tag | 1,146 ms (quadratic dedupe) | 6 ms | keep |
| A tree 20k levels deep | parses, then the serializer overflows | parses and serializes | keep |

## Speed and size (measured, see the session report)

- **Jint:** every op that parses HTML is 1.7× to 3× faster on marked-up input.
- **Node:** 1.4× to 2.5× faster.
- **Plain documents** (no parsing): equal or faster.
- **Bundle size, gzip:**
  - `view` and `migrate`: −17.4 KB each;
  - the server runtime and MCP bundle shrink too;
  - `blok`, `full` and `markdown`: byte-identical size.

## Decided (pre-existing, also in parse5)

1. **Spec-required blowups:** no node or depth cap (user decision 2026-10-29).
   - Formatting reconstruction can make a 4 KB input into 90k nodes.
   - Deep nesting is quadratic in parse time: 20k nested lists take about a minute.
2. **Sanitizer configs that allow `svg` and `style`/`script` together:** both sanitizers now drop `script`/`style` anywhere inside SVG or MathML (ab95c6d9, BREAKING).
3. **Deep nesting in the sanitizer and in `htmlToBlocks`:** both are loops now. The sanitizer was fixed in 74156d7b; `htmlToBlocks` queues its steps instead of recursing, with byte-identical goldens and the same Jint speed.
