import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionReveal } from './SectionReveal';

describe('SectionReveal', () => {
  it('should render its children', () => {
    render(
      <SectionReveal>
        <p>hello section</p>
      </SectionReveal>,
    );
    expect(screen.getByText('hello section')).toBeInTheDocument();
  });

  it('should render a div by default', () => {
    render(
      <SectionReveal data-blok-testid="reveal">
        <span>content</span>
      </SectionReveal>,
    );
    expect(screen.getByTestId('reveal').tagName).toBe('DIV');
  });

  it('should render the requested element via the `as` prop', () => {
    render(
      <SectionReveal as="nav" data-blok-testid="reveal-nav">
        <span>nav content</span>
      </SectionReveal>,
    );
    expect(screen.getByTestId('reveal-nav').tagName).toBe('NAV');
  });

  it('should forward className and arbitrary DOM props', () => {
    render(
      <SectionReveal
        className="custom-class"
        aria-label="Region"
        data-blok-testid="reveal-props"
      >
        <span>content</span>
      </SectionReveal>,
    );
    const el = screen.getByTestId('reveal-props');
    expect(el).toHaveClass('custom-class');
    expect(el).toHaveAttribute('aria-label', 'Region');
  });
});
