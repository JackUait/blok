import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    // HomePage renders Hero component with specific text content
    const heading = screen.getByRole('heading', { name: /block-based editors/i });
    expect(heading).toBeInTheDocument();
  });

  it('should render ApiPage for /docs path', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <App />
      </MemoryRouter>
    );

    // ApiPage has a sidebar with data-blok-testid
    const apiSidebar = screen.getByTestId('api-sidebar');
    expect(apiSidebar).toBeInTheDocument();
  });

  it('should render without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // App should render children - verify by checking HomePage content is present
    const heading = screen.getByRole('heading', { name: /block-based editors/i });
    expect(heading).toBeInTheDocument();
  });
});
