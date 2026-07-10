import { MIGRATION_STEPS } from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { cn } from "@/lib/utils";

interface MigrationStepRailProps {
  /** Anchor id of the section currently in view. */
  activeId: string;
  className?: string;
}

/** Sticky numbered rail listing the five migration steps, scroll-spy driven. */
export const MigrationStepRail: React.FC<MigrationStepRailProps> = ({ activeId, className }) => {
  const { t } = useI18n();

  return (
    <nav aria-label={t('migration.stepRailLabel')} className={className}>
      <ol className="flex flex-col gap-1">
        {MIGRATION_STEPS.map((step, index) => {
          const isActive = step.id === activeId;

          return (
            <li key={step.id}>
              <a
                href={`#${step.id}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex items-baseline gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-secondary font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    isActive ? "text-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span><Typo>{t(step.titleKey)}</Typo></span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
