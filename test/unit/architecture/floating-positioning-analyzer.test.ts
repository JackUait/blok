import { describe, expect, it } from 'vitest';

import {
  analyzeFloatingSource,
  type FloatingEvidenceKind,
} from './floating-positioning-analyzer';

const evidenceKinds = (source: string, fileName?: string): Set<FloatingEvidenceKind> =>
  new Set(analyzeFloatingSource(source, fileName).map(({ kind }) => kind));

const expectKinds = (
  source: string,
  expected: FloatingEvidenceKind[],
  fileName?: string
): void => {
  const kinds = evidenceKinds(source, fileName);

  expected.forEach((kind) => expect(kinds, `missing ${kind}`).toContain(kind));
};

describe('floating-positioning AST analyzer', () => {
  it('detects direct, aliased, optional, and computed root mounts', () => {
    const fixtures = [
      `document.body.appendChild(menu);`,
      `const root = document.documentElement; root.append(menu);`,
      `const root = document['body']; root?.['appendChild'](menu);`,
      `const root = document.body; const alias = root; alias.prepend(menu);`,
      `document.body.insertBefore(menu, document.body.firstChild);`,
    ];

    fixtures.forEach((source) => expectKinds(source, ['root-mount']));
    expect(evidenceKinds(`container.appendChild(menu);`)).not.toContain('root-mount');
  });

  it('detects roots passed through local mount helpers and methods', () => {
    expectKinds(`
      const mount = (target: Element, node: Element): void => {
        target.appendChild(node);
      };
      const root = document.body;
      mount(root, menu);
    `, ['root-mount']);

    expectKinds(`
      class Surface {
        private append(target: Element, node: Element): void {
          target.appendChild(node);
        }
        show(): void {
          this.append(document.documentElement, menu);
        }
      }
    `, ['root-mount']);

    expect(evidenceKinds(`
      const mount = (target: Element, node: Element): void => target.appendChild(node);
      mount(container, menu);
    `)).not.toContain('root-mount');
  });

  it('detects direct and aliased root geometry reads', () => {
    expectKinds(`document.body.getBoundingClientRect();`, [
      'geometry-read',
      'root-geometry-read',
    ]);
    expectKinds(`
      const root = document.documentElement;
      const alias = root;
      alias['getBoundingClientRect']();
    `, ['geometry-read', 'root-geometry-read']);

    const localKinds = evidenceKinds(`anchor.getBoundingClientRect();`);

    expect(localKinds).toContain('geometry-read');
    expect(localKinds).not.toContain('root-geometry-read');
  });

  it('detects direct, aliased, computed, and setProperty coordinate writes', () => {
    const fixtures = [
      `menu.style.top = top + 'px';`,
      `menu.style['left'] = left + 'px';`,
      `const style = menu.style; style.top = top + 'px';`,
      `const style = menu['style']; style['left'] = left + 'px';`,
      `menu.style.setProperty('top', top + 'px');`,
      `const style = menu.style; style['setProperty']('left', left + 'px');`,
    ];

    fixtures.forEach((source) => expectKinds(source, ['coordinate-write']));
    expect(evidenceKinds(`menu.style.width = width + 'px';`)).not.toContain('coordinate-write');
  });

  it('detects Object.assign coordinate writes through direct and aliased styles', () => {
    expectKinds(`Object.assign(menu.style, { top, left });`, ['coordinate-write']);
    expectKinds(`
      const style = menu.style;
      Object.assign(style, { ['top']: top });
    `, ['coordinate-write']);

    expect(evidenceKinds(`Object.assign(menu.style, { width, height });`))
      .not.toContain('coordinate-write');
  });

  it('detects cssText and style-attribute coordinate writes', () => {
    expectKinds(`menu.style.cssText = 'position: fixed; top: 1px; left: 2px';`, [
      'coordinate-write',
      'fixed-position-signal',
    ]);
    expectKinds(`menu.setAttribute('style', 'top: 1px; left: 2px');`, [
      'coordinate-write',
    ]);

    expect(evidenceKinds(`menu.setAttribute('aria-label', 'top: 1px');`))
      .not.toContain('coordinate-write');
  });

  it('rejects dynamic property access on known root and style aliases', () => {
    expectKinds(`
      const root = document.body;
      root[mountMethod](menu);
    `, ['dynamic-root-style-access']);
    expectKinds(`
      const style = menu.style;
      style[property] = value;
    `, ['dynamic-root-style-access']);
  });

  it('detects fixed-position and top-layer signals', () => {
    expectKinds(`menu.style.position = 'fixed';`, ['fixed-position-signal']);
    expectKinds(`Object.assign(menu.style, { position: 'fixed' });`, ['fixed-position-signal']);
    expectKinds(`promoteToTopLayer(menu);`, ['top-layer-signal']);
  });

  it('detects shared placement and tracking calls by syntax', () => {
    expectKinds(`
      positionAnchored(options);
      positionFixedAnchored(options);
      resolveBoundaryRect(boundary, viewport);
      resolvePosition(options);
      createPositionTracker(menu, reposition);
    `, ['shared-position-call', 'position-tracker-call']);
  });

  it('classifies tracked, dismissible, and unclassified virtual popover literals', () => {
    expectKinds(`
      new PopoverDesktop({ items, position, positionContext });
    `, ['popover-desktop-construction', 'tracked-virtual-position']);

    expectKinds(`
      new PopoverDesktop({
        items,
        position: caretRect,
        positionLifecycle: 'dismiss-on-nested-scroll',
      });
    `, ['popover-desktop-construction', 'dismissible-virtual-position']);

    expectKinds(`
      new PopoverDesktop({ items, position: caretRect });
    `, ['popover-desktop-construction', 'unclassified-virtual-position']);

    const ordinary = evidenceKinds(`new PopoverDesktop({ items, trigger });`);

    expect(ordinary).toContain('popover-desktop-construction');
    expect(ordinary).not.toContain('unclassified-virtual-position');
  });

  it('parses TSX without hiding executable root mounts', () => {
    expectKinds(`
      const view = <div />;
      document.body.append(view);
    `, ['root-mount'], 'fixture.tsx');
  });

  it('ignores unsafe-looking comments, strings, and local-only positioning', () => {
    const evidence = analyzeFloatingSource(`
      // document.body.appendChild(menu);
      const explanation = "menu.style.top = anchor.getBoundingClientRect().bottom";
      const rect = anchor.getBoundingClientRect();
      localContainer.appendChild(menu);
      menu.style.top = rect.bottom + 'px';
    `);
    const kinds = new Set(evidence.map(({ kind }) => kind));

    expect(kinds).toContain('geometry-read');
    expect(kinds).toContain('coordinate-write');
    expect(kinds).not.toContain('root-mount');
    expect(kinds).not.toContain('root-geometry-read');
  });

  it('reports actionable one-based locations and details', () => {
    const [evidence] = analyzeFloatingSource('\n\ndocument.body.append(menu);');

    expect(evidence).toMatchObject({
      kind: 'root-mount',
      line: 3,
      column: 1,
    });
    expect(evidence?.detail.length).toBeGreaterThan(5);
  });
});
