import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as icons from '../../../../../src/components/icons';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

const CATEGORIES = [
  { id: 'callout', key: 'tools.callout.calloutEmojiCategory' },
  { id: 'people', key: 'tools.callout.emojiCategoryPeople' },
  { id: 'nature', key: 'tools.callout.emojiCategoryNature' },
  { id: 'foods', key: 'tools.callout.emojiCategoryFood' },
  { id: 'activity', key: 'tools.callout.emojiCategoryActivity' },
  { id: 'places', key: 'tools.callout.emojiCategoryTravel' },
  { id: 'objects', key: 'tools.callout.emojiCategoryObjects' },
  { id: 'symbols', key: 'tools.callout.emojiCategorySymbols' },
  { id: 'flags', key: 'tools.callout.emojiCategoryFlags' },
];

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

describe('EmojiPicker category tooltips', () => {
  let picker: EmojiPicker;
  let container: HTMLElement;
  let anchor: HTMLButtonElement;
  let tooltip: HTMLElement;

  function nav(category: string): HTMLButtonElement {
    const button = requireElement<HTMLButtonElement>(picker.getElement(), `[data-emoji-nav="${category}"]`);

    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 36, 36));

    return button;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
    }));
    container = document.createElement('div');
    anchor = document.createElement('button');
    picker = new EmojiPicker({
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      i18n: { t: (key: string) => `[translated:${key}]` },
      locale: 'en',
    });
    container.append(anchor, picker.getElement());
    document.body.appendChild(container);
    await picker.open(anchor);
    tooltip = requireElement(document, '[role="tooltip"]');
    requireElement<HTMLElement>(picker.getElement(), '[data-emoji-picker-body]').scrollTo = vi.fn();
  });

  afterEach(() => {
    picker.close();
    destroyTooltip();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['callout', 'IconEmojiSparkles'], ['people', 'IconEmojiWink'], ['nature', 'IconEmojiSprout'],
    ['foods', 'IconEmojiBowl'], ['activity', 'IconEmojiGamepad'], ['places', 'IconEmojiMap'],
    ['objects', 'IconEmojiLightbulb'], ['symbols', 'IconEmojiHearts'], ['flags', 'IconEmojiFlag'],
  ])('pairs the %s category with its distinct pictogram', (id, name) => {
    const markup = Object.entries(icons).find(([key]) => key === name)?.[1];

    expect(typeof markup, name).toBe('string');
    const expected = document.createElement('div');

    expected.innerHTML = String(markup);
    expect(nav(id).innerHTML.trim()).toBe(expected.innerHTML.trim());
  });

  it.each(CATEGORIES)('shows the translated $id label above its button after 300ms hover', ({ id, key }) => {
    const button = nav(id);

    expect(picker.getElement().querySelectorAll('[data-emoji-nav]')).toHaveLength(9);
    button.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(299);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');

    vi.advanceTimersByTime(1);
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    expect(tooltip.textContent).toBe(`[translated:${key}]`);
    expect(tooltip).toHaveAttribute('data-blok-placement', 'top');
    expect(button).toHaveAttribute('aria-label', `[translated:${key}]`);
    expect(button).not.toHaveAttribute('title');
  });

  it.each([250, 299])('never reveals after leaving a pending category hint at %sms', (elapsed) => {
    const button = nav('people');

    button.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(elapsed);
    button.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(300 - elapsed);

    expect.soft(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(1000);
    expect.soft(tooltip).toHaveAttribute('aria-hidden', 'true');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('restarts the delay when reentering a category whose pending hint was cancelled', () => {
    const button = nav('people');

    button.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(250);
    button.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(25);
    button.dispatchEvent(new MouseEvent('mouseenter'));

    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(25);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(274);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(1);
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps visible hints for the grace period and skips the next category delay only while warm', () => {
    const button = nav('people');
    const nextButton = nav('nature');

    button.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);
    button.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(99);

    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    vi.advanceTimersByTime(1);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');

    nextButton.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    expect(tooltip.textContent).toBe('[translated:tools.callout.emojiCategoryNature]');

    nextButton.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(400);
    button.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(299);
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(1);
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
  });

  it('shows the category label immediately on keyboard focus and dismisses it on blur', () => {
    const button = nav('people');

    button.focus();

    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    expect(tooltip.textContent).toBe('[translated:tools.callout.emojiCategoryPeople]');
    expect(button).toHaveAttribute('aria-describedby', 'blok-tooltip');

    anchor.focus();

    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  describe.each([
    { state: 'pending', elapsed: 100 },
    { state: 'visible', elapsed: 300 },
  ])('$state hints', ({ elapsed }) => {
    let button: HTMLButtonElement;

    beforeEach(() => {
      button = nav('people');
      button.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(elapsed);
      expect(button).toHaveAttribute('aria-describedby', 'blok-tooltip');
      expect(tooltip).toHaveAttribute('aria-hidden', elapsed === 300 ? 'false' : 'true');
    });

    it('dismisses on category click without closing the picker', () => {
      button.click();

      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(button).toHaveAttribute('aria-current', 'true');
      expect(picker.isOpen()).toBe(true);
      vi.advanceTimersByTime(500);
      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    });

    it('dismisses on pointer leave after the shared tooltip grace period', () => {
      button.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(100);

      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
      expect(button).not.toHaveAttribute('aria-describedby');
      vi.advanceTimersByTime(500);
      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    });

    it('dismisses on close and does not reappear on reopen', async () => {
      picker.close();

      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
      expect(button).not.toHaveAttribute('aria-describedby');
      await picker.open(anchor);
      vi.advanceTimersByTime(500);
      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    });

    it.each(['grinning', 'no-such-emoji-zzzz', ''])('dismisses when query "%s" hides or rebuilds category buttons', (query) => {
      picker.setQuery(query);

      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
      expect(button).not.toHaveAttribute('aria-describedby');
      vi.advanceTimersByTime(500);
      expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
