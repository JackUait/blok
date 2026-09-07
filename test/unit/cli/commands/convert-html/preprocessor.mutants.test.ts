import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { preprocess } from '../../../../../src/cli/commands/convert-html/preprocessor';

const NBSP = ' ';

const run = (html: string): HTMLElement => {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  preprocess(wrapper);

  return wrapper;
};

describe('convert-html preprocessor mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('background divs become callouts', () => {
    it('turns a coloured div into an aside carrying the colour', () => {
      const wrapper = run('<div style="background-color: rgb(255, 240, 200)"><p>note</p></div>');
      const aside = wrapper.querySelector('aside');

      expect(aside).not.toBeNull();
      expect(aside?.style.backgroundColor).toBe('rgb(255, 240, 200)');
      expect(aside?.querySelector('p')?.textContent).toBe('note');
      expect(wrapper.querySelector('div')).toBeNull();
    });

    it('leaves a white background alone', () => {
      const wrapper = run('<div style="background-color: rgb(255, 255, 255)"><p>plain</p></div>');

      expect(wrapper.querySelector('aside')).toBeNull();
    });

    it('leaves a near-white background alone', () => {
      const wrapper = run('<div style="background-color: rgb(251, 252, 253)"><p>plain</p></div>');

      expect(wrapper.querySelector('aside')).toBeNull();
    });

    it('leaves a transparent background alone', () => {
      const wrapper = run('<div style="background-color: transparent"><p>plain</p></div>');

      expect(wrapper.querySelector('aside')).toBeNull();
    });

    it('leaves a div inside a table alone', () => {
      const wrapper = run(
        '<table><tbody><tr><td><div style="background-color: rgb(255, 240, 200)">cell</div></td></tr></tbody></table>',
      );

      expect(wrapper.querySelector('aside')).toBeNull();
      expect(wrapper.querySelector('td div')).not.toBeNull();
    });

    it('reads the shorthand background property too', () => {
      const wrapper = run('<div style="background: rgb(200, 220, 255)"><p>note</p></div>');

      expect(wrapper.querySelector('aside')?.style.backgroundColor).toBe('rgb(200, 220, 255)');
    });

    it('ignores a shorthand background that is an image rather than a colour', () => {
      const wrapper = run('<div style="background: url(https://example.test/x.png)"><p>plain</p></div>');

      expect(wrapper.querySelector('aside')).toBeNull();
    });

    it('unwraps bare div shells so the aside holds the content directly', () => {
      const wrapper = run(
        '<div style="background-color: rgb(255, 240, 200)"><div><div><p>deep</p></div></div></div>',
      );
      const aside = wrapper.querySelector('aside');

      expect(aside?.querySelector('div')).toBeNull();
      expect(aside?.firstElementChild?.tagName).toBe('P');
    });

    it('keeps an inner div that carries a class or style of its own', () => {
      const wrapper = run(
        '<div style="background-color: rgb(255, 240, 200)"><div class="keep"><p>deep</p></div></div>',
      );

      expect(wrapper.querySelector('aside > div.keep')).not.toBeNull();
    });

    it('drops a trailing break inside a paragraph, which would become an empty block', () => {
      const wrapper = run('<div style="background-color: rgb(255, 240, 200)"><p>note<br></p></div>');

      expect(wrapper.querySelector('aside p br')).toBeNull();
      expect(wrapper.querySelector('aside p')?.textContent).toBe('note');
    });

    it('keeps a break that is not the last element in the paragraph', () => {
      const wrapper = run('<div style="background-color: rgb(255, 240, 200)"><p>a<br><i>b</i></p></div>');

      expect(wrapper.querySelector('aside p br')).not.toBeNull();
    });
  });

  describe('spurious background colours', () => {
    it('strips a white background from an inline element', () => {
      const wrapper = run('<p><span style="background-color: rgb(255, 255, 255); color: red">x</span></p>');
      const span = wrapper.querySelector('span');

      expect(span?.style.backgroundColor).toBe('');
      expect(span?.style.color).toBe('red');
    });

    it('unwraps a span left with no attributes and no visible text', () => {
      const wrapper = run('<p>a<span style="background-color: rgb(255, 255, 255)"> </span>c</p>');

      expect(wrapper.querySelector('span')).toBeNull();
      expect(wrapper.querySelector('p')?.textContent).toBe('a c');
    });

    it('keeps a span that still holds text, stripping only the colour', () => {
      const wrapper = run('<p>a<span style="background-color: rgb(255, 255, 255)">b</span>c</p>');

      expect(wrapper.querySelector('span')?.textContent).toBe('b');
      expect(wrapper.querySelector('span')?.hasAttribute('style')).toBe(false);
    });

    it('keeps a span that still carries another attribute', () => {
      const wrapper = run('<p><span class="k" style="background-color: rgb(255, 255, 255)">b</span></p>');

      expect(wrapper.querySelector('span.k')).not.toBeNull();
      expect(wrapper.querySelector('span')?.hasAttribute('style')).toBe(false);
    });

    it('keeps a real background colour', () => {
      const wrapper = run('<p><span style="background-color: rgb(255, 240, 200)">b</span></p>');

      expect(wrapper.querySelector('span')?.style.backgroundColor).toBe('rgb(255, 240, 200)');
    });
  });

  describe('table cell paragraphs', () => {
    it('replaces paragraph boundaries inside a cell with breaks', () => {
      const wrapper = run('<table><tbody><tr><td><p>one</p><p>two</p></td></tr></tbody></table>');
      const cell = wrapper.querySelector('td');

      expect(cell?.querySelector('p')).toBeNull();
      expect(cell?.querySelectorAll('br').length).toBeGreaterThan(0);
      expect(cell?.textContent).toBe('onetwo');
    });

    it('leaves a top-level paragraph intact', () => {
      const wrapper = run('<p>one</p><p>two</p>');

      expect(wrapper.querySelectorAll('p')).toHaveLength(2);
    });
  });

  describe('blank paragraphs', () => {
    it('removes a paragraph holding only non-breaking spaces', () => {
      const wrapper = run(`<p>${NBSP}${NBSP}</p><p>kept</p>`);

      expect(wrapper.querySelectorAll('p')).toHaveLength(1);
      expect(wrapper.querySelector('p')?.textContent).toBe('kept');
    });

    it('removes a paragraph holding only ordinary whitespace', () => {
      const wrapper = run('<p>   </p><p>kept</p>');

      expect(wrapper.querySelectorAll('p')).toHaveLength(1);
    });

    it('drops a blank cell paragraph in the cell pass rather than the blank pass', () => {
      const wrapper = run(`<table><tbody><tr><td><p>${NBSP}</p><p>kept</p></td></tr></tbody></table>`);

      expect(wrapper.querySelector('td')?.textContent).toBe('kept');
      expect(wrapper.querySelector('td p')).toBeNull();
    });
  });

  describe('strikethrough', () => {
    it('rewrites both legacy tags to s, keeping their content', () => {
      const wrapper = run('<p><del>gone</del> and <strike>also</strike></p>');

      expect(wrapper.querySelectorAll('s')).toHaveLength(2);
      expect(wrapper.querySelector('del')).toBeNull();
      expect(wrapper.querySelector('strike')).toBeNull();
      expect(wrapper.querySelector('p')?.textContent).toBe('gone and also');
    });
  });

  describe('pseudo-lists', () => {
    it.each([
      ['bullet', '• one'],
      ['middle dot', '· one'],
      ['hyphen', '- one'],
    ])('turns a %s paragraph into a list item', (_name, text) => {
      const wrapper = run(`<p>${text}</p>`);

      expect(wrapper.querySelector('ul li')?.textContent).toBe('one');
      expect(wrapper.querySelector('p')).toBeNull();
    });

    it('groups consecutive bullet paragraphs into one list', () => {
      const wrapper = run('<p>• one</p><p>• two</p><p>• three</p>');

      expect(wrapper.querySelectorAll('ul')).toHaveLength(1);
      expect(wrapper.querySelectorAll('li')).toHaveLength(3);
    });

    it('starts a second list after a paragraph breaks the run', () => {
      const wrapper = run('<p>• one</p><p>prose</p><p>• two</p>');

      expect(wrapper.querySelectorAll('ul')).toHaveLength(2);
    });

    it('keeps inline markup that follows the bullet', () => {
      const wrapper = run('<p>• one <b>bold</b></p>');

      expect(wrapper.querySelector('li b')?.textContent).toBe('bold');
    });

    it('leaves a paragraph that merely starts with a hyphen and no space', () => {
      const wrapper = run('<p>-dash</p>');

      expect(wrapper.querySelector('ul')).toBeNull();
      expect(wrapper.querySelector('p')?.textContent).toBe('-dash');
    });
  });
});
