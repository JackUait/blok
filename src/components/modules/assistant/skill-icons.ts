import {
  IconAskAiActionItems,
  IconAskAiContinue,
  IconAskAiExplain,
  IconAskAiImprove,
  IconAskAiLonger,
  IconAskAiProofread,
  IconAskAiShorter,
  IconAskAiSimplify,
  IconAskAiSummarize,
} from '../../icons';
import { generateBlockId } from '../../utils/id-generator';

/** A shape's part name for ask-ai-icons.css, and whether the act erases it ('out') or draws it in ('in'). */
type Part = readonly [name: string, draw?: 'in' | 'out'];

/** A shape only the coloured copy has: the act draws it in or pops it. */
type Extra = readonly [tag: 'path' | 'circle', attributes: Record<string, string>, part: Part];

interface Skill {
  act: string;
  /** One per shape of the icon, in order; [''] leaves a shape still. */
  parts: readonly Part[];
  extras?: readonly Extra[];
}

const line = (d: string, part: Part): Extra => ['path', { d }, part];

const SKILLS = new Map<string, Skill>([
  [IconAskAiSummarize, { act: 'summarize', parts: [['summarize-strand', 'out'], ['summarize-strand2', 'out'], ['summarize-line']] }],
  [IconAskAiActionItems, {
    act: 'actionItems',
    parts: [['actionItems-box', 'out'], ['actionItems-box2', 'out'], ['']],
    extras: [line('M2.9 6.6l1.3 1.3 2.6-2.8', ['actionItems-tick', 'in']), line('M2.9 13.6l1.3 1.3 2.6-2.8', ['actionItems-tick2', 'in'])],
  }],
  [IconAskAiProofread, {
    act: 'proofread',
    parts: [[''], ['proofread-wave', 'out']],
    extras: [line('M3 13.5H13', ['proofread-flat', 'in']), line('M14.5 13.4l1 1 2-2.2', ['proofread-ok', 'in'])],
  }],
  [IconAskAiContinue, {
    act: 'continue',
    parts: [[''], [''], ['continue-dot'], ['continue-dot2'], ['continue-dot3']],
    extras: [line('M8 13.5H17', ['continue-trail', 'in'])],
  }],
  [IconAskAiImprove, {
    act: 'improve',
    parts: [['improve-rough', 'out']],
    extras: [
      line('M6.5 4.5H13.5L17 8.5L10 16.5L3 8.5Z', ['improve-cut', 'in']),
      line('M3 8.5H17M8.25 4.5L7.25 8.5L10 16.5L12.75 8.5L11.75 4.5', ['improve-facet', 'in']),
      ['circle', { cx: '16.5', cy: '3.5', r: '0.8', fill: 'currentColor' }, ['improve-spark']],
    ],
  }],
  [IconAskAiShorter, {
    act: 'shorter',
    parts: [['shorter-top'], ['shorter-mid', 'out'], ['shorter-bottom'], ['shorter-top'], ['shorter-bottom']],
  }],
  [IconAskAiLonger, {
    act: 'longer',
    parts: [['longer-top'], ['longer-bottom'], ['longer-top'], ['longer-bottom']],
    extras: [line('M3 10H12', ['longer-mid', 'in'])],
  }],
  [IconAskAiSimplify, { act: 'simplify', parts: [['simplify-tangle', 'out']], extras: [line('M3 10H17', ['simplify-line', 'in'])] }],
  [IconAskAiExplain, {
    act: 'explain',
    parts: [['explain-bubble'], ['explain-q'], ['explain-q']],
    extras: [line('M6.5 7.25H13.5', ['explain-answer', 'in']), line('M6.5 10.25H11', ['explain-answer2', 'in'])],
  }],
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const STROKE = { stroke: 'currentColor', 'stroke-width': '1.25', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const element = (tag: string, attributes: Record<string, string>): Element => {
  const node = document.createElementNS(SVG_NS, tag);

  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));

  return node;
};

const tag = (shape: Element, [name, draw]: Part): void => {
  if (name !== '') {
    shape.setAttribute('data-blok-ask-ai-part', name);
  }
  if (draw !== undefined) {
    shape.setAttribute('data-blok-ask-ai-draw', draw);
  }
};

/** One unit per stroke, so CSS can draw a stroke in or erase it with a dash. */
const measure = (svg: Element): void => {
  svg.querySelectorAll('[stroke]').forEach((shape) => shape.setAttribute('pathLength', '1'));
};

/**
 * Markup for a skill icon that acts out its skill on hover: the ink icon, and over it a
 * coloured copy whose parts ask-ai-icons.css moves. Any other icon comes back unchanged.
 * @param icon - the action's icon markup
 */
export const dressSkillIcon = (icon: string): string => {
  const skill = SKILLS.get(icon);
  const ink = skill === undefined ? null : new DOMParser().parseFromString(icon, 'image/svg+xml').querySelector('svg');

  if (skill === undefined || ink === null) {
    return icon;
  }

  const hue = ink.cloneNode(true) as Element;
  const gradient = element('linearGradient', {
    id: `blok-ask-ai-hue-${generateBlockId()}`,
    // Canvas units: a gradient sized to each shape has no height on a flat line, which then draws nothing.
    gradientUnits: 'userSpaceOnUse',
    x1: '3',
    y1: '3',
    x2: '17',
    y2: '17',
  });
  const paint = `url(#${gradient.id})`;

  hue.querySelectorAll('path, circle').forEach((shape, index) => tag(shape, skill.parts[index] ?? ['']));
  skill.extras?.forEach(([name, attributes, part]) => {
    const shape = element(name, attributes.fill === undefined ? { ...attributes, ...STROKE } : attributes);

    tag(shape, part);
    hue.append(shape);
  });
  ['0', '0.5', '1'].forEach((offset) => gradient.append(element('stop', { offset })));
  hue.prepend(gradient);
  hue.querySelectorAll('[stroke="currentColor"]').forEach((shape) => shape.setAttribute('stroke', paint));
  hue.querySelectorAll('[fill="currentColor"]').forEach((shape) => shape.setAttribute('fill', paint));
  hue.setAttribute('data-blok-ask-ai-hue', '');
  hue.setAttribute('data-blok-ask-ai-act', skill.act);
  ink.setAttribute('data-blok-ask-ai-ink', '');
  measure(ink);
  measure(hue);

  return ink.outerHTML + hue.outerHTML;
};
