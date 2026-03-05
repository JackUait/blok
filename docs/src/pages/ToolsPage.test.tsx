// docs/src/pages/ToolsPage.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { ToolsPage } from './ToolsPage';
import { TOOL_SECTIONS } from '../components/tools/tools-data';

const renderPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <ToolsPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe('ToolsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the nav', () => {
    renderPage();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
  });

  it('renders the tools sidebar', () => {
    renderPage();
    expect(screen.getByTestId('tools-sidebar')).toBeInTheDocument();
  });

  it('renders the tools main content area', () => {
    renderPage();
    expect(screen.getByTestId('tools-main')).toBeInTheDocument();
  });

  it('renders all tool sections', () => {
    renderPage();
    for (const section of TOOL_SECTIONS) {
      expect(
        screen.getByTestId(`tools-section-${section.id}`)
      ).toBeInTheDocument();
    }
  });

  it('renders a section badge for each tool', () => {
    renderPage();
    const badges = screen.getAllByTestId('tools-section-badge');
    expect(badges.length).toBe(TOOL_SECTIONS.length);
  });

  it('renders sidebar links for all tools', () => {
    renderPage();
    for (const section of TOOL_SECTIONS) {
      expect(
        screen.getByTestId(`tools-sidebar-link-${section.id}`)
      ).toBeInTheDocument();
    }
  });
});
