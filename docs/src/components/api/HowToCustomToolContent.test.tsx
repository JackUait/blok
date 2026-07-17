import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HowToCustomToolContent } from './HowToCustomToolContent';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';

const renderHowTo = (framework?: string) =>
  render(
    <MemoryRouter
      initialEntries={[framework === undefined ? '/' : `/?framework=${framework}`]}
    >
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

  describe('component authoring section (framework adapters)', () => {
    it('is absent for vanilla — there is no component factory to show', () => {
      renderHowTo();
      expect(screen.queryByText('Or write it as a component')).toBeNull();
    });

    it('shows createReactBlock for react, including the live tool-config note', () => {
      const { container } = renderHowTo('react');
      expect(screen.getByText('Or write it as a component')).toBeInTheDocument();
      const code = container.textContent ?? '';
      expect(code).toContain('createReactBlock');
      expect(code).toContain('propSchema');
      expect(code).toContain('commit(');
      // The react copy documents live tool-config functions (no deps needed).
      expect(code).toContain('stay live');
    });

    it('shows createVueBlock for vue', () => {
      const { container } = renderHowTo('vue');
      expect(screen.getByText('Or write it as a component')).toBeInTheDocument();
      const code = container.textContent ?? '';
      expect(code).toContain('createVueBlock');
      expect(code).toContain('propSchema');
    });

    it('shows createAngularBlock for angular', () => {
      const { container } = renderHowTo('angular');
      expect(screen.getByText('Or write it as a component')).toBeInTheDocument();
      const code = container.textContent ?? '';
      expect(code).toContain('createAngularBlock');
      expect(code).toContain('BLOK_BLOCK_CONTEXT');
    });
  });

  it('does not draw its own bordered/card box around the Going further panel (a divider separates it instead)', () => {
    renderHowTo();
    const heading = screen.getByText('Going further');
    const panel = heading.closest('div');
    expect(panel).not.toBeNull();
    expect(panel?.className).not.toMatch(/bg-card/);
  });
});
