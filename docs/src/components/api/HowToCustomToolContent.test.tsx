import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
      '/docs/tools-api/',
    );
    expect(screen.getByRole('link', { name: 'BlockData' })).toHaveAttribute(
      'href',
      '/docs/block-data/',
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

  describe('container-block section (framework adapters)', () => {
    it('is absent for vanilla — the container hooks live on the adapter specs', () => {
      renderHowTo();
      expect(screen.queryByText('Container blocks')).toBeNull();
    });

    it.each([
      ['react', 'useBlokInstance', 'childAttributes'],
      ['vue', 'useBlokInstance', 'childAttributes'],
      ['angular', 'injectBlokInstance', 'mountChildren'],
    ])('documents the container surface for %s', (framework, instanceHook, childHook) => {
      const { container } = renderHowTo(framework);
      expect(screen.getByText('Container blocks')).toBeInTheDocument();
      const code = container.textContent ?? '';
      // The general statics channel and the toolbar anchor, plus the editor
      // instance and the per-child decoration hook.
      expect(code).toContain('statics:');
      expect(code).toContain('ownsChildren');
      expect(code).toContain('getToolbarAnchorElement');
      expect(code).toContain(instanceHook);
      expect(code).toContain(childHook);
    });

    /**
     * Blok's decoration law blesses the child holder AND the child's
     * `[data-blok-element-content]` wrapper. Documenting only the holder half is
     * what pushed containers into hard-coding the engine's wrapper chain in their
     * own CSS to reach a child's content box.
     */
    it.each([
      ['react', 'childContentAttributes'],
      ['vue', 'childContentAttributes'],
      ['angular', 'childContentAttributes'],
    ])('shows %s containers the content-wrapper decoration hook', (framework, hook) => {
      const { container } = renderHowTo(framework);
      const code = container.textContent ?? '';

      expect(code).toContain(hook);
    });

    /**
     * The anchor hook is resolved OUTSIDE the component, so without the
     * ref/setter channel an author has to invent a data attribute and
     * querySelector for it — which is exactly what the older example showed.
     */
    it.each([
      ['react', 'toolbarAnchorRef'],
      ['vue', 'toolbarAnchorRef'],
      ['angular', 'setToolbarAnchor'],
    ])('shows %s containers how to name the toolbar anchor from inside', (framework, member) => {
      const { container } = renderHowTo(framework);
      const code = container.textContent ?? '';

      expect(code).toContain(member);
    });

    it.each(['react', 'vue', 'angular'])(
      'shows %s containers how to keep Enter inside the container',
      (framework) => {
        const { container } = renderHowTo(framework);
        const code = container.textContent ?? '';
        expect(code).toContain('keepsChildrenOnEnter');
      }
    );

    it.each(['react', 'vue', 'angular'])(
      'shows %s containers the post-mount seeding hook',
      (framework) => {
        const { container } = renderHowTo(framework);
        const code = container.textContent ?? '';
        // rendered() runs BEFORE the adapter's first commit, so seeding (and
        // caret work) belongs after it — and `onCreated` is the narrowed form
        // that only fires for a genuine creation, so a load/undo/paste replay
        // never fabricates children.
        expect(code).toContain('onCreated');
      }
    );

    it.each(['react', 'vue', 'angular'])(
      'never shows %s containers the origin === user seeding gate',
      (framework) => {
        const { container } = renderHowTo(framework);
        const code = container.textContent ?? '';
        /*
         * The intuitive gate is WRONG and must not be modelled: `user` is only
         * the keystroke path, so a container seeded that way stays empty for
         * `api.blocks.insert(...)` and for a turn-into. `onCreated` covers the
         * whole creation set (`user`, `api`, `convert`) instead.
         */
        expect(code).not.toContain("origin === 'user'");
      }
    );

    it('states the holder-write guarantee and where it stops', () => {
      const { container } = renderHowTo('react');
      const code = container.textContent ?? '';
      expect(code).toContain('DIRECT children of the nested slot');
      expect(code).toContain('tool root');
    });
  });

  describe('inline tool authoring section (react only)', () => {
    it('is absent for vanilla — there is no inline-tool factory to show', () => {
      renderHowTo();
      expect(screen.queryByText('Inline tools as components')).toBeNull();
    });

    it('shows createReactInlineTool for react with the surround/checkState contract', () => {
      const { container } = renderHowTo('react');
      expect(screen.getByText('Inline tools as components')).toBeInTheDocument();
      const code = container.textContent ?? '';
      expect(code).toContain('createReactInlineTool');
      expect(code).toContain('surround');
      expect(code).toContain('checkState');
    });

    it('documents the declarative mark spec with derived surround/checkState/sanitize', () => {
      const { container } = renderHowTo('react');
      const code = container.textContent ?? '';
      // A single-class toggle is just a mark spec — nothing else to write.
      expect(code).toContain("mark: { tag: 'span', className: 'my-highlight' }");
      // The body copy states that the three tool hooks are derived from it.
      expect(code).toContain('sanitize');
      expect(code).toContain('derived');
      // Operations run through the editor's range-aware mark engine.
      expect(code).toContain('api.marks');
    });

    it('documents useInlineTool() for nested UI and the api second argument', () => {
      const { container } = renderHowTo('react');
      const code = container.textContent ?? '';
      expect(code).toContain('useInlineTool');
      // surround/checkState now receive the editor api as a second argument.
      expect(code).toContain('(range, api)');
      expect(code).toContain('(selection, api)');
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
