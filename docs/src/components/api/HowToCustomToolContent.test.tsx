import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HowToCustomToolContent } from './HowToCustomToolContent';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';

const renderHowTo = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <FrameworkProvider>
          <HowToCustomToolContent />
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );

describe('HowToCustomToolContent', () => {
  it('lays out the task as ordered steps', () => {
    renderHowTo();
    expect(screen.getByText('Write the tool class')).toBeInTheDocument();
    expect(screen.getByText('Register it in the editor')).toBeInTheDocument();
    expect(screen.getByText('Use it and save')).toBeInTheDocument();
  });

  it('shows the BlockTool contract in the example code', () => {
    const { container } = renderHowTo();
    const code = container.textContent ?? '';
    expect(code).toContain('static get toolbox');
    expect(code).toContain('render()');
    expect(code).toContain('save(');
    expect(code).toContain('tools:');
  });

  it('links onward to the Tools API and BlockData reference via router links', () => {
    const { container } = renderHowTo();
    expect(screen.getByRole('link', { name: 'Tools API' })).toHaveAttribute(
      'href',
      '/docs/tools-api',
    );
    expect(screen.getByRole('link', { name: 'BlockData' })).toHaveAttribute(
      'href',
      '/docs/block-data',
    );
    expect(container.querySelector('a[href^="#"]')).toBeNull();
  });

  it('extends the Going further section with a validate()/tunes example', () => {
    const { container } = renderHowTo();
    expect(screen.getByText('Going further')).toBeInTheDocument();
    const code = container.textContent ?? '';
    expect(code).toContain('validate(savedData');
    expect(code).toContain("tunes: ['textColor']");
  });
});
