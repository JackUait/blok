import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Link } from './Link';

const renderAt = (pathname: string, to: string) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Link to={to}>label</Link>
    </MemoryRouter>,
  );

const href = () => screen.getByRole('link', { name: 'label' }).getAttribute('href');

describe('Link', () => {
  // The build emits directory indexes, so GitHub Pages 301s `/docs/table` onto
  // `/docs/table/`. Every href below is asserted in the served form to keep an
  // internal link off that redirect.
  it('renders a served address in the default locale tree', () => {
    renderAt('/docs/table', '/docs/selection-api');
    expect(href()).toBe('/docs/selection-api/');
  });

  it('maps an address into the locale tree the reader is in', () => {
    renderAt('/ru/docs/table', '/docs/selection-api');
    expect(href()).toBe('/ru/docs/selection-api/');
  });

  // The slash belongs on the path, never after the fragment.
  it('carries the hash across with the address', () => {
    renderAt('/ru', '/docs#quick-start');
    expect(href()).toBe('/ru/docs/#quick-start');
  });

  it('maps the site root onto the locale tree root', () => {
    renderAt('/ru/changelog', '/');
    expect(href()).toBe('/ru/');
  });

  // The language switch hands over a fully-qualified address; re-prefixing it
  // would produce `/ru/ru/docs/table` and strand the reader. It still picks up
  // the served form.
  it('does not re-prefix an address that already names a locale tree', () => {
    renderAt('/ru/docs/table', '/ru/docs/table');
    expect(href()).toBe('/ru/docs/table/');
  });

  // Not site-absolute, so there is no locale segment to insert: react-router
  // resolves these itself and the result must come through unmangled.
  it('leaves a bare fragment to the router to resolve', () => {
    renderAt('/ru/docs/table', '#features');
    expect(href()).toBe('/ru/docs/table#features');
  });

  it('leaves a protocol-relative address untouched', () => {
    renderAt('/ru/docs/table', '//example.com/x');
    expect(href()).toBe('//example.com/x');
  });

  it('leaves an external address untouched', () => {
    renderAt('/ru/docs/table', 'https://github.com/JackUait/blok');
    expect(href()).toBe('https://github.com/JackUait/blok');
  });
});
