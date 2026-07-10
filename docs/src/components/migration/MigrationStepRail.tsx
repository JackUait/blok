import { MIGRATION_STEPS } from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { cn } from "@/lib/utils";

interface MigrationStepRailProps {
  /** Anchor id of the section currently in view. */
  activeId: string;
  className?: string;
}

type StepState = "done" | "active" | "todo";

const stateOf = (index: number, activeIndex: number): StepState => {
  if (index < activeIndex) {
    return "done";
  }

  return index === activeIndex ? "active" : "todo";
};

const CheckIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/**
 * Sticky progress spine for the five migration steps. Scroll-spy drives which
 * step is active; everything above it reads as done, so the rail doubles as a
 * checklist you can see yourself moving through.
 */
export const MigrationStepRail: React.FC<MigrationStepRailProps> = ({ activeId, className }) => {
  const { t } = useI18n();
  const activeIndex = Math.max(0, MIGRATION_STEPS.findIndex((step) => step.id === activeId));
  const lastIndex = MIGRATION_STEPS.length - 1;
  const progress = lastIndex === 0 ? 0 : (activeIndex / lastIndex) * 100;

  return (
    <nav aria-label={t('migration.stepRailLabel')} className={className}>
      <ol className="relative flex flex-col">
        {/* The spine: a hairline track, filled up to the active dot. */}
        <span aria-hidden className="absolute top-4 bottom-4 left-[13px] w-px bg-border">
          <span
            data-blok-testid="step-rail-progress"
            className="block w-px bg-foreground transition-[height] duration-500 ease-out"
            style={{ height: `${progress}%` }}
          />
        </span>

        {MIGRATION_STEPS.map((step, index) => {
          const state = stateOf(index, activeIndex);

          return (
            <li key={step.id}>
              <a
                href={`#${step.id}`}
                data-state={state}
                aria-current={state === "active" ? "true" : undefined}
                className="group flex items-center gap-3.5 py-2 text-sm"
              >
                <span
                  className={cn(
                    "relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full border bg-background font-mono text-[11px] tabular-nums transition-colors",
                    state === "active" && "border-foreground bg-foreground text-background",
                    state === "done" && "border-foreground/25 text-foreground",
                    state === "todo" && "border-border text-muted-foreground/70 group-hover:border-foreground/30",
                  )}
                >
                  {state === "done" ? <CheckIcon /> : String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "leading-snug transition-colors",
                    state === "active" && "font-semibold text-foreground",
                    state === "done" && "text-foreground/80 group-hover:text-foreground",
                    state === "todo" && "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <Typo>{t(step.titleKey)}</Typo>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
