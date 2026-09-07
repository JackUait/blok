import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';

import { IconCheck } from '../../../src/components/icons';

const css = postcss.parse(readFileSync(resolve(__dirname, '../../../src/styles/checklist.css'), 'utf8'));
const checkedSelector = '[data-blok-interface] [data-list-style="checklist"] input[type="checkbox"]:checked';

const checkedValue = (property: string): string => {
  let value: string | undefined;

  css.walkRules(checkedSelector, rule => {
    rule.walkDecls(property, declaration => {
      value = declaration.value;
    });
  });

  if (value === undefined) {
    throw new Error(`Missing checked ${property}`);
  }

  return value;
};

const svgOf = (source: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

const pathOf = (svg: SVGSVGElement): SVGPathElement => {
  const path = svg.querySelector('path');

  if (path === null) {
    throw new Error('Missing check path');
  }

  return path;
};

const commandsOf = (path: SVGPathElement): { command: string; values: number[] }[] =>
  Array.from((path.getAttribute('d') ?? '').matchAll(/([ML])([^ML]*)/gi), match => ({
    command: match[1],
    values: (match[2].match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number),
  }));

describe('checklist micro check in the Blok Line family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the half-scale IconCheck skeleton with a deliberate double-weight micro stroke', () => {
    const dataUrl = checkedValue('background-image').match(/data:image\/svg\+xml,([^"]+)/)?.[1];

    if (dataUrl === undefined) {
      throw new Error('Missing checklist SVG data URL');
    }

    const microSvg = svgOf(decodeURIComponent(dataUrl));
    const microPath = pathOf(microSvg);
    const standardPath = pathOf(svgOf(IconCheck));
    const scale = 10 / 20;

    expect(commandsOf(microPath)).toStrictEqual(commandsOf(standardPath).map(({ command, values }) => ({
      command,
      values: values.map(value => value * scale),
    })));
    expect(Number(microPath.getAttribute('stroke-width'))).toBe(Number(standardPath.getAttribute('stroke-width')) * scale * 2);
    expect(microSvg.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(microPath.getAttribute('stroke')).toBe('white');
    expect(microPath.getAttribute('stroke-linecap')).toBe('round');
    expect(microPath.getAttribute('stroke-linejoin')).toBe('round');
    expect(microPath.getAttribute('fill')).toBe('none');
    expect(checkedValue('background-size')).toBe('10px 10px');
    expect(checkedValue('background-color')).toBe('var(--blok-active-icon)');
    expect(checkedValue('border-color')).toBe('var(--blok-active-icon)');
  });
});
