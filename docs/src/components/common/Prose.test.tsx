import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Prose } from './Prose';
import { I18nProvider } from '../../contexts/I18nContext';

const NBSP = '\u00A0';

const renderProse = (text: string, locale: 'en' | 'ru' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <Prose text={text} />
    </I18nProvider>,
  );

describe('Prose', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('renders a single line as one paragraph', () => {
    const { container } = renderProse('One short line.');
    const paragraphs = container.querySelectorAll('p');

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('One short line.');
  });

  // The whole point: a 500 word value used to render as one <p>. A blank line is
  // what an author writes to split it, so it has to reach the DOM as two <p>.
  it('splits a blank line into separate paragraphs', () => {
    const { container } = renderProse('First idea.\n\nSecond idea.');
    const paragraphs = container.querySelectorAll('p');

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('First idea.');
    expect(paragraphs[1].textContent).toBe('Second idea.');
  });

  it('renders a run of "- " lines as one list', () => {
    const { container } = renderProse('Lead in:\n\n- first\n- second\n- third');
    const items = container.querySelectorAll('ul > li');

    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect([...items].map((li) => li.textContent)).toEqual(['first', 'second', 'third']);
  });

  it('nests a two-space indented item inside the item above it', () => {
    const { container } = renderProse('- parent\n  - child\n- sibling');
    const topLevel = container.querySelectorAll(':scope > ul > li');

    expect(topLevel).toHaveLength(2);
    expect(topLevel[0].querySelector('ul > li')?.textContent).toBe('child');
    expect(topLevel[1].textContent).toBe('sibling');
  });

  it('returns to the paragraph flow after a list', () => {
    const { container } = renderProse('- only item\n\nAfter the list.');

    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('p')?.textContent).toBe(`After the${NBSP}list.`);
  });

  // `Typo` rendered backticks literally, so a reader saw `contentIds` with the
  // backticks in it. Every prose value carries identifiers, so the block renderer
  // has to do what `renderInline` did.
  it('renders a backticked span as code, in a paragraph and in a list item', () => {
    const { container } = renderProse('Set `holder` first.\n\n- pass `readOnly`');

    expect(container.querySelector('p code')?.textContent).toBe('holder');
    expect(container.querySelector('li code')?.textContent).toBe('readOnly');
    expect(container.textContent).not.toContain('`');
  });

  it('applies locale typography to prose but never inside code', () => {
    const { container } = renderProse('a tool named `a tool`');
    const code = container.querySelector('code');

    // The identifier is copied out by readers, so a non-breaking space in it is a
    // silent corruption; the surrounding prose still gets one.
    expect(code?.textContent).toBe('a tool');
    expect(container.querySelector('p')?.textContent).toBe(`a${NBSP}tool named a tool`);
  });

  it('applies Russian typography when the active locale is Russian', () => {
    const { container } = renderProse('в блоке текста', 'ru');

    expect(container.querySelector('p')?.textContent).toBe(`в${NBSP}блоке текста`);
  });

  // Author error, not reader error: a stray blank line must not produce an empty
  // paragraph that shows up as a gap in the page.
  it('drops blank runs instead of emitting empty paragraphs', () => {
    const { container } = renderProse('One.\n\n\n\nTwo.\n\n');

    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('joins consecutive non-blank prose lines into one paragraph', () => {
    const { container } = renderProse('First line.\nSecond line.');
    const paragraphs = container.querySelectorAll('p');

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('First line. Second line.');
  });

  it('forwards a class name to every paragraph so callers keep their type scale', () => {
    const { container } = render(
      <I18nProvider locale="en">
        <Prose text={'One.\n\nTwo.'} className="text-sm" />
      </I18nProvider>,
    );

    expect([...container.querySelectorAll('p')].every((p) => p.classList.contains('text-sm'))).toBe(true);
  });

  // A list with no marker and no indent reads as a run of stray lines, which is
  // the wall of text this component exists to break up.
  it('gives lists a marker and an indent of their own', () => {
    const { container } = renderProse('- one\n- two');
    const list = container.querySelector('ul');

    expect(list?.classList.contains('list-disc')).toBe(true);
    expect(list?.classList.contains('pl-5')).toBe(true);
  });

  it('marks a sub-list differently from its parent list', () => {
    const { container } = renderProse('- parent\n  - child');
    const sub = container.querySelector('ul ul');

    expect(sub?.classList.contains('list-[circle]')).toBe(true);
  });

  it('separates stacked blocks but never indents the first one', () => {
    const { container } = renderProse('One.\n\nTwo.');
    const paragraphs = container.querySelectorAll('p');

    expect(paragraphs[0].classList.contains('first:mt-0')).toBe(true);
    expect(paragraphs[1].classList.contains('mt-3')).toBe(true);
  });
});
