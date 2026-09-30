import { IconChevronRight } from '../../components/icons';
import { createPreview, h } from '../../components/utils/block-preview';

interface HeadingSample {
  title: string;
  body: Array<{ bullet: boolean; text: string }>;
}

const bullet = (text: string): { bullet: boolean; text: string } => ({ bullet: true, text });
const line = (text: string): { bullet: boolean; text: string } => ({ bullet: false, text });

const HEADINGS: Record<number, HeadingSample> = {
  1: { title: 'How?', body: [ line('Start with the question.') ] },
  2: { title: 'Our Values', body: [ bullet('Ship small, learn fast'), bullet('Leave it better than you found it') ] },
  3: { title: 'Tuesday standup', body: [ line('Design review moved to 3pm. Bring the prototype, not the slides.') ] },
  4: { title: 'Open questions', body: [ bullet('Who owns onboarding?'), bullet('Dark mode on day one?') ] },
  5: { title: 'Ingredients', body: [ bullet('2 cups flour'), bullet('1 tsp sea salt'), bullet('A little patience') ] },
  6: { title: 'Footnotes', body: [ line('¹ March survey, 212 replies.'), line('² Rounded to whole percent.') ] },
};

const TOGGLES: Record<number, HeadingSample> = {
  1: { title: 'Roadmap', body: [ bullet('Q3 — offline mode'), bullet('Q4 — shared templates'), bullet('2027 — a surprise') ] },
  2: { title: 'Meeting notes', body: [ bullet('Ship on Friday'), bullet('Priya owns the launch post'), bullet('Cake, obviously') ] },
  3: { title: 'Spoilers ahead', body: [ line('The butler didn’t do it.'), line('The cat did.') ] },
  4: { title: 'What’s in the box?', body: [ bullet('One keyboard, two cables'), bullet('A very small screwdriver') ] },
  5: { title: 'Changelog', body: [ bullet('Search is twice as fast'), bullet('Fewer clicks to share'), bullet('Dark mode, finally') ] },
  6: { title: 'Details', body: [ line('Build 4.2.1 · 12 MB'), line('Updated yesterday by Sam') ] },
};

const renderBody = (sample: HeadingSample): HTMLElement[] => sample.body.map(({ bullet: isBullet, text }) => isBullet
  ? h('div', { 'data-part': 'item' }, h('span', { 'data-part': 'marker', 'aria-hidden': 'true' }, '•'), h('span', {}, text))
  : h('div', { 'data-part': 'line' }, text));

/**
 * Toolbox drawing for a heading level: the "#" shortcut melts away as the
 * line grows to the level's real size, with body text below for scale.
 * @param level - heading level, 1-6
 */
export const renderHeadingPreview = (level: number): HTMLElement => {
  const sample = HEADINGS[level] ?? HEADINGS[1];

  return createPreview(
    `header-${level}`,
    h(
      'div',
      { 'data-part': 'heading' },
      h('span', { 'data-part': 'shortcut', 'aria-hidden': 'true' }, '#'.repeat(level)),
      h('span', { 'data-part': 'title' }, sample.title)
    ),
    ...renderBody(sample)
  );
};

/**
 * Toolbox drawing for a toggle heading level: Blok's chevron turns open and
 * the content under the heading unfolds.
 * @param level - heading level, 1-6
 */
export const renderToggleHeadingPreview = (level: number): HTMLElement => {
  const sample = TOGGLES[level] ?? TOGGLES[1];
  const arrow = h('span', { 'data-part': 'arrow', 'aria-hidden': 'true' });

  arrow.innerHTML = IconChevronRight;

  return createPreview(
    `toggle-header-${level}`,
    h('div', { 'data-part': 'row' }, arrow, h('div', { 'data-part': 'heading' }, sample.title)),
    h('div', { 'data-part': 'children' }, ...renderBody(sample))
  );
};
