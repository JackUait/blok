import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HowToCustomToolContent } from './HowToCustomToolContent';
import { I18nProvider } from '../../contexts/I18nContext';

const renderHowTo = () =>
  render(
    <I18nProvider>
      <HowToCustomToolContent />
    </I18nProvider>,
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

  it('links onward to the Tools API and BlockData reference', () => {
    renderHowTo();
    expect(screen.getByRole('link', { name: 'Tools API' })).toHaveAttribute(
      'href',
      '#tools-api',
    );
    expect(screen.getByRole('link', { name: 'BlockData' })).toHaveAttribute(
      'href',
      '#block-data',
    );
  });
});
