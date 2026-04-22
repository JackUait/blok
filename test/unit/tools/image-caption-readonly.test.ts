/**
 * Regression: in read-only mode, an empty image caption must NOT display the
 * `Write a caption…` placeholder. Empty non-editable captions should be fully
 * invisible, not a grey ghost under the image.
 *
 * The placeholder is rendered purely via CSS (`:empty::before { content:
 * attr(data-placeholder) }`). The fix scopes the selector to
 * `[contenteditable="true"]` so read-only captions — which carry
 * `contenteditable="false"` — don't generate the pseudo-element content.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from '../styles/helpers/read-main-css';

const css = readMainCss();

describe('image caption placeholder — read-only mode', () => {
  it('placeholder pseudo-element selector targets only contenteditable="true" captions', () => {
    const captionLines = css
      .split('\n')
      .filter((line) => /\.blok-image-caption\S*:empty::before/.test(line));

    expect(captionLines.length).toBeGreaterThan(0);

    for (const line of captionLines) {
      expect(line).toMatch(/\.blok-image-caption\[contenteditable="true"\]:empty::before/);
    }
  });
});
