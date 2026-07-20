/**
 * The toolbar's stretched-block offset math must honour the PUBLIC content-width
 * token.
 *
 * `--blok-content-max-width` is the documented host hook for the content column
 * cap, and the CSS resolves it as `var(--blok-content-max-width,
 * var(--max-width-content))`. The toolbar's offset math read only the private
 * `--max-width-content`, so a host that capped the column at, say, 650px got
 * toolbar controls positioned against the uncapped 720px default — the plus
 * button and drag handle sat 35px off the visible content edge for every
 * stretched block.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveVisualContentWidth } from '../../../../../src/components/modules/toolbar/content-alignment';
import { DATA_ATTR } from '../../../../../src/components/constants';

const makeRect = (left: number, width: number): DOMRect =>
  ({
    left,
    right: left + width,
    top: 0,
    bottom: 0,
    width,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const stretchedHolder = (): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute(DATA_ATTR.stretched, 'true');

  return holder;
};

describe('toolbar content-alignment public token', () => {
  const ORIGINAL_GET_PROPERTY_VALUE = CSSStyleDeclaration.prototype.getPropertyValue;

  const stubTokens = (tokens: Record<string, string>): void => {
    CSSStyleDeclaration.prototype.getPropertyValue = function patched(property: string): string {
      return tokens[property] ?? '';
    };
  };

  afterEach(() => {
    CSSStyleDeclaration.prototype.getPropertyValue = ORIGINAL_GET_PROPERTY_VALUE;
  });

  beforeEach(() => {
    stubTokens({ '--max-width-content': '720px' });
  });

  it('prefers --blok-content-max-width over the private default', () => {
    stubTokens({
      '--max-width-content': '720px',
      '--blok-content-max-width': '650px',
    });

    const width = resolveVisualContentWidth(stretchedHolder(), makeRect(0, 1200), makeRect(0, 1200));

    expect(width).toBe(650);
  });

  it('falls back to --max-width-content when the public token is unset', () => {
    const width = resolveVisualContentWidth(stretchedHolder(), makeRect(0, 1200), makeRect(0, 1200));

    expect(width).toBe(720);
  });

  it('ignores a non-length public token value and falls back', () => {
    stubTokens({
      '--max-width-content': '720px',
      '--blok-content-max-width': 'none',
    });

    const width = resolveVisualContentWidth(stretchedHolder(), makeRect(0, 1200), makeRect(0, 1200));

    expect(width).toBe(720);
  });
});
