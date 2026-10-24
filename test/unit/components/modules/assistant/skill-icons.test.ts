import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as icons from '../../../../../src/components/icons';
import { assistantActions } from '../../../../../src/components/modules/assistant/actions';
import { dressSkillIcon } from '../../../../../src/components/modules/assistant/skill-icons';

const t = (key: string): string => key;

const SKILLS = {
  summarize: icons.IconAskAiSummarize,
  actionItems: icons.IconAskAiActionItems,
  proofread: icons.IconAskAiProofread,
  continue: icons.IconAskAiContinue,
  improve: icons.IconAskAiImprove,
  shorter: icons.IconAskAiShorter,
  longer: icons.IconAskAiLonger,
  simplify: icons.IconAskAiSimplify,
  explain: icons.IconAskAiExplain,
};

/** The ink copy and the coloured copy, as the glyph holds them. */
const dress = (icon: string): { ink: SVGSVGElement; hue: SVGSVGElement } => {
  const host = document.createElement('span');

  host.innerHTML = dressSkillIcon(icon);

  const ink = host.querySelector<SVGSVGElement>('svg[data-blok-ask-ai-ink]');
  const hue = host.querySelector<SVGSVGElement>('svg[data-blok-ask-ai-hue]');

  if (ink === null || hue === null || host.children.length !== 2) {
    throw new Error('expected an ink copy and a coloured copy');
  }

  return { ink, hue };
};

const strokes = (svg: SVGSVGElement): Element[] => [...svg.querySelectorAll('path, circle')]
  .filter((shape) => shape.hasAttribute('stroke'));

describe('Ask AI skill icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives each built-in skill its own Ask AI icon', () => {
    const iconOf = (labelKey: string): string | undefined => [...assistantActions('selection', t), ...assistantActions('caret', t)]
      .find((action) => action.label === `assistant.action.${labelKey}`)?.icon;

    for (const [act, icon] of Object.entries(SKILLS)) {
      expect(iconOf(act), act).toBe(icon);
    }
  });

  it('leaves a host icon as it is', () => {
    expect(dressSkillIcon(icons.IconWand)).toBe(icons.IconWand);
  });

  it.each(Object.entries(SKILLS))('lays a coloured copy over the %s ink, which names its act', (act, icon) => {
    const { ink, hue } = dress(icon);

    expect(hue.getAttribute('data-blok-ask-ai-act')).toBe(act);
    expect(hue.getAttribute('aria-hidden')).toBe('true');
    expect(ink.querySelector('[stroke]')?.getAttribute('stroke')).toBe('currentColor');
    expect(hue.querySelector('[stroke="currentColor"], [fill="currentColor"]')).toBeNull();
  });

  it.each(Object.entries(SKILLS))('measures every %s stroke as one, so it can draw itself in and out', (_act, icon) => {
    const { ink, hue } = dress(icon);

    for (const svg of [ink, hue]) {
      expect(strokes(svg).length).toBeGreaterThan(0);
      expect(strokes(svg).every((shape) => shape.getAttribute('pathLength') === '1')).toBe(true);
    }
  });

  it('paints the coloured copy across the 20-unit canvas, so a flat line still shows', () => {
    // A gradient sized to each shape has no height on a flat line, and the line draws nothing.
    const { hue } = dress(icons.IconAskAiContinue);
    const gradient = hue.querySelector('linearGradient');

    expect(gradient?.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    expect([...hue.querySelectorAll('[stroke]')].every((shape) => shape.getAttribute('stroke') === `url(#${gradient?.id})`)).toBe(true);
    expect(gradient?.querySelectorAll('stop')).toHaveLength(3);
  });

  it('gives every copy a gradient of its own', () => {
    const first = dress(icons.IconAskAiExplain).hue.querySelector('linearGradient')?.id;
    const second = dress(icons.IconAskAiExplain).hue.querySelector('linearGradient')?.id;

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  // Pinned by shape order: a redrawn icon must fail here, not move the wrong stroke.
  it.each([
    ['summarize', ['summarize-strand', 'summarize-strand2', 'summarize-line']],
    ['actionItems', ['actionItems-box', 'actionItems-box2', '', 'actionItems-tick', 'actionItems-tick2']],
    ['proofread', ['', 'proofread-wave', 'proofread-flat', 'proofread-ok']],
    ['continue', ['', '', 'continue-dot', 'continue-dot2', 'continue-dot3', 'continue-trail']],
    ['improve', ['improve-rough', 'improve-cut', 'improve-facet', 'improve-spark']],
    ['shorter', ['shorter-top', 'shorter-mid', 'shorter-bottom', 'shorter-top', 'shorter-bottom']],
    ['longer', ['longer-top', 'longer-bottom', 'longer-top', 'longer-bottom', 'longer-mid']],
    ['simplify', ['simplify-tangle', 'simplify-line']],
    ['explain', ['explain-bubble', 'explain-q', 'explain-q', 'explain-answer', 'explain-answer2']],
  ] as const)('names the parts the %s act moves', (act, parts) => {
    const { hue } = dress(SKILLS[act]);
    const shapes = [...hue.querySelectorAll('path, circle')];

    expect(shapes.map((shape) => shape.getAttribute('data-blok-ask-ai-part') ?? '')).toEqual(parts);
  });

  it('keeps the parts the act draws in out of the ink copy', () => {
    for (const icon of Object.values(SKILLS)) {
      const { ink, hue } = dress(icon);

      expect(ink.querySelector('[data-blok-ask-ai-part], [data-blok-ask-ai-draw]')).toBeNull();
      expect(strokes(ink).length).toBeLessThanOrEqual(strokes(hue).length);
    }
    expect(dress(icons.IconAskAiProofread).hue.querySelectorAll('[data-blok-ask-ai-draw="in"]')).toHaveLength(2);
    expect(dress(icons.IconAskAiProofread).hue.querySelectorAll('[data-blok-ask-ai-draw="out"]')).toHaveLength(1);
  });
});
