import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConceptsContent } from './ConceptsContent';
import { I18nProvider } from '../../contexts/I18nContext';

const renderConcepts = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <ConceptsContent />
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ConceptsContent', () => {
  it('states the core idea that every piece of content is a block', () => {
    renderConcepts();
    expect(
      screen.getByText(/every piece of content is a block/i),
    ).toBeInTheDocument();
  });

  it('renders the section headings of the explanation', () => {
    renderConcepts();
    expect(screen.getByText('The shape of a block')).toBeInTheDocument();
    expect(screen.getByText('Blocks form a tree')).toBeInTheDocument();
    expect(screen.getByText('What is not a block')).toBeInTheDocument();
    expect(screen.getByText('Why this matters to you')).toBeInTheDocument();
  });

  it('shows the block shape and tree code examples', () => {
    const { container } = renderConcepts();
    const code = container.textContent ?? '';
    expect(code).toContain('contentIds');
    expect(code).toContain('parentId');
    expect(code).toContain('database-row');
  });

  it('renders the "is this a block?" decision prompt for extenders', () => {
    renderConcepts();
    expect(screen.getByText(/is this a block/i)).toBeInTheDocument();
  });

  it('links onward to the Blocks API and BlockData reference via router links', () => {
    const { container } = renderConcepts();
    expect(screen.getByRole('link', { name: 'Blocks API' })).toHaveAttribute(
      'href',
      '/docs/blocks-api',
    );
    expect(screen.getByRole('link', { name: 'BlockData' })).toHaveAttribute(
      'href',
      '/docs/block-data',
    );
    expect(container.querySelector('a[href^="#"]')).toBeNull();
  });
});
