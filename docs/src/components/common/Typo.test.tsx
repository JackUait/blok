import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Typo } from './Typo';
import { I18nProvider } from '../../contexts/I18nContext';

const NBSP = ' ';

const renderTypo = (ui: React.ReactNode) =>
  render(<I18nProvider>{ui}</I18nProvider>);

describe('Typo', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('applies English typography to its text by default', () => {
    const { container } = renderTypo(<Typo>the editor is a tool</Typo>);
    expect(container.textContent).toBe(`the${NBSP}editor is${NBSP}a${NBSP}tool`);
  });

  it('applies Russian typography when the active locale is Russian', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    const { container } = renderTypo(<Typo>в блоке текста</Typo>);
    expect(container.textContent).toBe(`в${NBSP}блоке текста`);
  });

  it('does not wrap the text in an element by default', () => {
    const { container } = renderTypo(<Typo>plain text</Typo>);
    // No extra wrapper element — the text lives directly in the container.
    expect(container.querySelector('span')).toBeNull();
  });

  it('renders inside a span when an "as" element is requested', () => {
    const { container } = renderTypo(
      <Typo as="span" className="lead">
        the editor
      </Typo>,
    );
    const span = container.querySelector('span.lead');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe(`the${NBSP}editor`);
  });

  it('joins multiple string children before processing', () => {
    const { container } = renderTypo(<Typo>{['the ', 'editor']}</Typo>);
    expect(container.textContent).toBe(`the${NBSP}editor`);
  });
});
