import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealBlock, SCROLL_SETTLE_MS, SPOTLIGHT_MS } from '../../../../src/components/utils/reveal-block';
import * as motion from '../../../../src/components/utils/reduced-motion';

const rect = (top: number, height: number): DOMRect => new DOMRect(0, top, 300, height);

const makeBlock = (): { holder: HTMLElement; content: HTMLElement; card: HTMLElement; retry: HTMLButtonElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const card = document.createElement('div');
  const retry = document.createElement('button');

  card.setAttribute('data-blok-spotlight-target', '');
  retry.setAttribute('data-blok-spotlight-focus', '');
  card.appendChild(retry);
  content.appendChild(card);
  holder.appendChild(content);
  document.body.appendChild(holder);

  return { holder, content, card, retry };
};

const lit = (el: Element): boolean => el.hasAttribute('data-blok-spotlight');

describe('revealBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('centres an off-screen target with a smooth scroll', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(2000, 80));
    revealBlock(holder, content);

    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('jumps instead of gliding under reduced motion', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(motion, 'prefersReducedMotion').mockReturnValue(true);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(2000, 80));
    revealBlock(holder, content);

    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
  });

  it('lights the target only once the scroll has ended', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(2000, 80));
    revealBlock(holder, content);

    expect(lit(card)).toBe(false);
    window.dispatchEvent(new Event('scrollend'));
    expect(lit(card)).toBe(true);
  });

  it('lights the target after a fallback when the browser never reports the scroll end', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(2000, 80));
    revealBlock(holder, content);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1);
    expect(lit(card)).toBe(false);
    vi.advanceTimersByTime(1);

    expect(lit(card)).toBe(true);
  });

  it('does not scroll a target that is already in view and lights it at once', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(100, 80));
    revealBlock(holder, content);

    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(lit(card)).toBe(true);
  });

  it('falls back to the block content when the tool marks no target', () => {
    const { holder, content, card } = makeBlock();

    card.removeAttribute('data-blok-spotlight-target');
    revealBlock(holder, content);

    expect(lit(content)).toBe(true);
    expect(lit(card)).toBe(false);
  });

  it('moves focus to the marked control without scrolling', () => {
    const { holder, content, retry } = makeBlock();
    const focus = vi.spyOn(retry, 'focus');

    revealBlock(holder, content);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(retry).toHaveFocus();
  });

  it('turns the light off after the spotlight', () => {
    const { holder, content, card } = makeBlock();

    revealBlock(holder, content);
    vi.advanceTimersByTime(SPOTLIGHT_MS);

    expect(lit(card)).toBe(false);
  });

  it('does not light a target twice from one late scroll end', () => {
    const { holder, content, card } = makeBlock();

    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(2000, 80));
    revealBlock(holder, content);
    vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    vi.advanceTimersByTime(SPOTLIGHT_MS);
    window.dispatchEvent(new Event('scrollend'));

    expect(lit(card)).toBe(false);
  });

  it('keeps the light on exactly as long as the pulse runs', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/spotlight.css'), 'utf8');

    expect(css).toMatch(new RegExp(`blok-spotlight-trace ${SPOTLIGHT_MS}ms`));
    expect(css).toMatch(new RegExp(`blok-spotlight-bloom ${SPOTLIGHT_MS}ms`));
  });
});
