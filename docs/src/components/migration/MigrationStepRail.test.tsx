import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MigrationStepRail } from './MigrationStepRail';
import { MIGRATION_STEPS } from './migration-data';
import { I18nProvider } from '../../contexts/I18nContext';
import enJson from '../../i18n/en.json';

const m = enJson.migration;

const renderRail = (activeId?: string) =>
  render(
    <I18nProvider>
      <MigrationStepRail activeId={activeId ?? MIGRATION_STEPS[0].id} />
    </I18nProvider>
  );

describe('MigrationStepRail', () => {
  it('should render a nav labelled as migration steps', () => {
    renderRail();

    expect(screen.getByRole('navigation', { name: m.stepRailLabel })).toBeInTheDocument();
  });

  it('should render one anchor link per migration step', () => {
    renderRail();

    const nav = screen.getByRole('navigation', { name: m.stepRailLabel });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(MIGRATION_STEPS.length);
    MIGRATION_STEPS.forEach((step, index) => {
      expect(links[index]).toHaveAttribute('href', `#${step.id}`);
    });
  });

  it('should mark the active step with aria-current', () => {
    renderRail(MIGRATION_STEPS[2].id);

    const nav = screen.getByRole('navigation', { name: m.stepRailLabel });
    const links = within(nav).getAllByRole('link');
    expect(links[2]).toHaveAttribute('aria-current', 'true');
    expect(links[0]).not.toHaveAttribute('aria-current');
  });

  it('should render step titles from i18n', () => {
    renderRail();

    expect(screen.getByText(m.sectionCodemodTitle)).toBeInTheDocument();
    expect(screen.getByText(m.sectionVerifyTitle)).toBeInTheDocument();
  });

  it('should mark steps before the active one as done and later ones as todo', () => {
    renderRail(MIGRATION_STEPS[2].id);

    const nav = screen.getByRole('navigation', { name: m.stepRailLabel });
    const links = within(nav).getAllByRole('link');
    expect(links[0]).toHaveAttribute('data-state', 'done');
    expect(links[1]).toHaveAttribute('data-state', 'done');
    expect(links[2]).toHaveAttribute('data-state', 'active');
    expect(links[3]).toHaveAttribute('data-state', 'todo');
    expect(links[4]).toHaveAttribute('data-state', 'todo');
  });

  it('should fill the progress spine in proportion to the active step', () => {
    renderRail(MIGRATION_STEPS[2].id);

    const progress = screen.getByTestId('step-rail-progress');
    expect(progress).toHaveStyle({ height: '50%' });
  });

  it('should leave the progress spine empty on the first step', () => {
    renderRail(MIGRATION_STEPS[0].id);

    expect(screen.getByTestId('step-rail-progress')).toHaveStyle({ height: '0%' });
  });
});
