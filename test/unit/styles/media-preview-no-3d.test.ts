/**
 * A 3D transform on the element around the media preview SVG makes the
 * browser draw the SVG to a bitmap and tilt the bitmap, so its lines turn
 * jagged on hover. The tilt must stay 2D and live inside the SVG, where it is
 * redrawn as vectors.
 */
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { readMainCss } from './helpers/read-main-css';

const THREE_D = /perspective|rotate[XY]\(|rotate3d|translate[Z3]|scale[Z3]|matrix3d|preserve-3d/;

const isPreviewRule = (rule: postcss.Rule): boolean => rule.selector.includes('blok-media-preview')
  || (rule.parent?.type === 'atrule' && (rule.parent as postcss.AtRule).params.startsWith('blok-media-preview'));

const threeDInPreviewRules = (): string[] => {
  const offenders: string[] = [];
  postcss.parse(readMainCss()).walkRules((rule) => {
    if (!isPreviewRule(rule)) return;
    rule.walkDecls((decl) => {
      if (THREE_D.test(`${decl.prop}: ${decl.value}`)) offenders.push(`${rule.selector} { ${decl.prop}: ${decl.value} }`);
    });
  });
  return offenders;
};

describe('media preview stays crisp', () => {
  it('uses no 3D transform in any preview rule or preview keyframes', () => {
    expect(threeDInPreviewRules()).toEqual([]);
  });
});
