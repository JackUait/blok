import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileSectionNav } from './MobileSectionNav';
import { I18nProvider } from '../../contexts/I18nContext';
import type { SidebarSection } from './Sidebar';

const MOCK_SECTIONS: SidebarSection[] = [
  {
    title: 'API Modules',
    links: [
      { id: 'caret-api', label: 'Caret' },
      { id: 'events-api', label: 'Events' },
    ],
  },
];

const I18nWrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe('MobileSectionNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the trigger button', () => {
    render(<MobileSectionNav sections={MOCK_SECTIONS} activeSection="caret-api" />, {
      wrapper: I18nWrapper,
    });
    expect(screen.getByTestId('mobile-section-nav-trigger')).toBeInTheDocument();
  });

  it('opens the dropdown when the trigger is clicked', () => {
    render(<MobileSectionNav sections={MOCK_SECTIONS} activeSection="caret-api" />, {
      wrapper: I18nWrapper,
    });
    expect(screen.queryByTestId('mobile-section-nav-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-section-nav-trigger'));
    expect(screen.getByTestId('mobile-section-nav-dropdown')).toBeInTheDocument();
  });

  it('calls onNavigate instead of scrolling when provided', async () => {
    const onNavigate = vi.fn();
    render(
      <MobileSectionNav sections={MOCK_SECTIONS} activeSection="caret-api" onNavigate={onNavigate} />,
      { wrapper: I18nWrapper },
    );
    fireEvent.click(screen.getByTestId('mobile-section-nav-trigger'));
    fireEvent.click(screen.getByTestId('mobile-section-nav-item-events-api'));
    expect(onNavigate).toHaveBeenCalledWith('events-api');
  });
});
