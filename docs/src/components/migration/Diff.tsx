import { useI18n } from "../../contexts/I18nContext";

interface DiffProps {
  removed: string;
  added: string;
}

/**
 * A before/after pair. The palette has no green, so the added line earns its
 * emphasis from weight and full-contrast ink rather than a foreign hue.
 */
export const Diff: React.FC<DiffProps> = ({ removed, added }) => {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-start gap-2.5 rounded-lg bg-destructive/[0.06] px-2.5 py-1.5">
        <span className="select-none font-mono text-sm leading-5 font-bold text-destructive/70" aria-label={t('migration.removed')}>−</span>
        <code className="min-w-0 break-all font-mono text-xs leading-5 text-muted-foreground line-through decoration-destructive/40">{removed}</code>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5">
        <span className="select-none font-mono text-sm leading-5 font-bold text-foreground/50" aria-label={t('migration.added')}>+</span>
        <code className="min-w-0 break-all font-mono text-xs leading-5 font-medium text-foreground">{added}</code>
      </div>
    </div>
  );
};
