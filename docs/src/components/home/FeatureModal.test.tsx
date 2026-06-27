import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureModal, type FeatureDetail } from './FeatureModal';
import { I18nProvider } from '../../contexts/I18nContext';

const mockFeature: FeatureDetail = {
  icon: <span>icon</span>,
  title: 'Clean JSON Output',
  description: 'Content is structured as typed JSON blocks, not raw HTML.',
  learnMore: 'Learn more about Clean JSON Output',
  accent: 'coral',
  details: {
    summary: 'Output is clean JSON, not HTML.',
    benefits: ['Easy to parse', 'Framework agnostic', 'Version control friendly'],
    codeExample: 'const data = await editor.save();',
    apiLink: '/docs#core-save',
  },
};

const visualNode = <div data-blok-testid="mock-viz">live diorama</div>;

const renderModal = (
  feature: FeatureDetail | null = mockFeature,
  onClose = vi.fn(),
  visual: React.ReactNode = visualNode,
) =>
  render(
    <I18nProvider>
      <FeatureModal feature={feature} visual={visual} onClose={onClose} />
    </I18nProvider>
  );

describe('FeatureModal', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render nothing when feature is null', () => {
    const { container } = renderModal(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render the dialog when feature is provided', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should render the feature title', () => {
    renderModal();
    expect(screen.getByText('Clean JSON Output')).toBeInTheDocument();
  });

  it('should render the feature summary', () => {
    renderModal();
    expect(screen.getByText('Output is clean JSON, not HTML.')).toBeInTheDocument();
  });

  it('should render the tile visual as the panel hero', () => {
    renderModal();
    // The clicked tile's own live diorama is carried into the panel so it stays
    // on-brand instead of dropping the user onto a plain dialog.
    expect(screen.getByTestId('mock-viz')).toBeInTheDocument();
  });

  it('should render the benefits heading in sentence case', () => {
    renderModal();
    expect(screen.getByText('Key benefits')).toBeInTheDocument();
  });

  it('should render each benefit', () => {
    renderModal();
    expect(screen.getByText('Easy to parse')).toBeInTheDocument();
    expect(screen.getByText('Framework agnostic')).toBeInTheDocument();
    expect(screen.getByText('Version control friendly')).toBeInTheDocument();
  });

  it('should render the code example without a redundant "Example" heading', () => {
    renderModal();
    expect(
      screen.getByText((content) => content.includes('editor.save()'))
    ).toBeInTheDocument();
    // The code block self-labels its language, so the extra heading is gone.
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('should not render a code block when codeExample is absent', () => {
    const featureWithoutCode: FeatureDetail = {
      ...mockFeature,
      details: { summary: 'Summary', benefits: ['Benefit'] },
    };
    renderModal(featureWithoutCode);
    expect(
      screen.queryByText((content) => content.includes('editor.save()'))
    ).not.toBeInTheDocument();
  });

  it('should render the docs link when apiLink is provided', () => {
    renderModal();
    const link = screen.getByText('View documentation →');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs#core-save');
  });

  it('should render the close button with accessible aria-label', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
  });

  it('should call onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should NOT call onClose when clicking inside panel content', () => {
    const onClose = vi.fn();
    renderModal(mockFeature, onClose);
    fireEvent.click(screen.getByText('Output is clean JSON, not HTML.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should have aria-modal="true" on the dialog', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('should focus the close button without scrolling the page on open', () => {
    // The panel mounts transformed off-screen; an unscoped focus() would scroll
    // the overlay to reveal the button, causing a visible jump on open.
    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus');
    renderModal();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it('should render a drag handle for the mobile bottom-sheet drawer', () => {
    renderModal();
    const grabber = screen.getByTestId('sheet-grabber');
    expect(grabber).toBeInTheDocument();
    // Purely decorative affordance — must not be announced to screen readers.
    expect(grabber).toHaveAttribute('aria-hidden', 'true');
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <FeatureModal feature={mockFeature} visual={visualNode} onClose={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  });
});
