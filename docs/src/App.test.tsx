import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

describe('App', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock scrollIntoView for testing
    scrollIntoViewMock = vi.fn();
    global.Element.prototype.scrollIntoView = scrollIntoViewMock;
    // Mock window.scrollTo
    global.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render HomePage for root path', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    const hero = document.querySelector('[data-hero-content]');
    expect(hero).toBeInTheDocument();
  });

  it('should render ApiPage for /docs path', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <App />
      </MemoryRouter>
    );

    const apiDocs = document.querySelector('.api-docs');
    expect(apiDocs).toBeInTheDocument();
  });

  it('should render ApiPage for /docs path with hash', () => {
    // Create a target element with the hash id before rendering
    const targetElement = document.createElement('div');
    targetElement.id = 'blocks-api';
    document.body.appendChild(targetElement);

    render(
      <MemoryRouter initialEntries={['/docs#blocks-api']}>
        <App />
      </MemoryRouter>
    );

    // Verify ApiPage is rendered
    const apiDocs = document.querySelector('.api-docs');
    expect(apiDocs).toBeInTheDocument();

    // After the fix, scrollIntoView should be called
    // This will fail initially, then pass after we implement the fix
    expect(scrollIntoViewMock).toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(targetElement);
  });

  it('should render without crashing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // App should render children (HomePage, etc.)
    expect(container.firstChild).toBeInTheDocument();
  });
});
