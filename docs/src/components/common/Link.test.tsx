import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Link } from './Link';

const renderAt = (pathname: string, to: string) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Link to={to}>label</Link>
    </MemoryRouter>,
  );

const href = () => screen.getByRole('link', { name: 'label' }).getAttribute('href');

describe('Link', () => {
  it('leaves an address alone in the default locale tree', () => {
    renderAt('/docs/table', '/docs/selection-api');
    expect(href()).toBe('/docs/selection-api');
  });

  it('maps an address into the locale tree the reader is in', () => {
    renderAt('/ru/docs/table', '/docs/selection-api');
    expect(href()).toBe('/ru/docs/selection-api');
  });

  it('carries the hash across with the address', () => {
    renderAt('/ru', '/docs#quick-start');
    expect(href()).toBe('/ru/docs#quick-start');
  });

  it('maps the site root onto the locale root, with no trailing slash', () => {
    renderAt('/ru/changelog', '/');
    expect(href()).toBe('/ru');
  });

  // The language switch hands over a fully-qualified address; re-prefixing it
  // would produce `/ru/ru/docs/table` and strand the reader.
  it('leaves an address that already names a locale tree untouched', () => {
    renderAt('/ru/docs/table', '/ru/docs/table');
    expect(href()).toBe('/ru/docs/table');
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
});
