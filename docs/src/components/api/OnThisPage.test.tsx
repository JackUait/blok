import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';
import { OnThisPage, getOnThisPageItems } from './OnThisPage';
import type { ApiSection } from './api-data';

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lacks IntersectionObserver
  vi.stubGlobal('IntersectionObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
});

const section: ApiSection = {
  id: 'caret-api',
  title: 'Caret API',
  methods: [
    { name: 'focus(atEnd?)', description: 'd', returnType: 'void' },
    { name: 'setToBlock(index)', description: 'd', returnType: 'void' },
  ],
} as ApiSection;

describe('OnThisPage', () => {
  it('derives one item per method with correct anchor', () => {
    expect(getOnThisPageItems(section)).toEqual([
      { id: 'caret-api-focus', label: 'focus(atEnd?)' },
      { id: 'caret-api-settoblock', label: 'setToBlock(index)' },
    ]);
  });

  it('renders links to those anchors', () => {
    render(<I18nProvider><OnThisPage section={section} /></I18nProvider>);
    expect(screen.getByRole('link', { name: 'focus(atEnd?)' })).toHaveAttribute('href', '#caret-api-focus');
  });

  it('renders nothing when no entries', () => {
    const { container } = render(
      <I18nProvider><OnThisPage section={{ id: 'x', title: 'X' } as ApiSection} /></I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
