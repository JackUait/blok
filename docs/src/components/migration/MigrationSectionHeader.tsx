import { Typo } from "../common/Typo";

interface MigrationSectionHeaderProps {
  /** 1-based step number, rendered as a hanging mono ordinal ("02"). */
  step: number;
  title: string;
  description: string;
}

/**
 * Chapter header for a migration step. The ordinal only shows below `lg`,
 * where the step rail is hidden — on desktop the rail already numbers the
 * step, and a second figure in the gutter just crowds it.
 */
export const MigrationSectionHeader: React.FC<MigrationSectionHeaderProps> = ({
  step,
  title,
  description,
}) => (
  <header className="mb-8">
    <span
      aria-hidden
      className="mb-2 block font-mono text-xs font-semibold tabular-nums text-muted-foreground/70 lg:hidden"
    >
      {String(step).padStart(2, "0")}
    </span>
    <h2 className="font-display text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
      <Typo>{title}</Typo>
    </h2>
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
      <Typo>{description}</Typo>
    </p>
  </header>
);
