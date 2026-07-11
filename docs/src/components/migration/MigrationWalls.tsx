import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { MIGRATION_WALLS } from "./migration-data";
import { cn } from "@/lib/utils";

/** The gains section: each Editor.js ceiling paired with how Blok clears it.
 *  No eyebrow/kicker — the heading stands alone (repo copy rule). */
export const MigrationWalls: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n();
  return (
    <section id="walls" className={cn("scroll-mt-28", className)}>
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
        <Typo>{t("migration.wallsHeading")}</Typo>
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
        <Typo>{t("migration.wallsIntro")}</Typo>
      </p>

      <div className="mt-10 divide-y divide-border border-y border-border">
        {MIGRATION_WALLS.map((wall) => (
          <div
            key={wall.id}
            className="grid items-center gap-4 py-6 sm:grid-cols-[1fr_auto_1fr]"
            data-blok-testid={`wall-${wall.id}`}
          >
            {/* The old world — deliberately dimmed */}
            <div className="opacity-70">
              <span className="text-[0.7rem] font-bold uppercase tracking-wider text-destructive">
                {t("migration.wallOldLabel")}
              </span>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                <Typo>{t(wall.oldTitleKey)}</Typo>
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                <Typo>{t(wall.oldDescKey)}</Typo>
              </p>
            </div>

            <span aria-hidden className="hidden text-xl text-primary sm:block">→</span>

            <div>
              <span className="text-[0.7rem] font-bold uppercase tracking-wider text-primary">
                {t("migration.wallNewLabel")}
              </span>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                <Typo>{t(wall.newTitleKey)}</Typo>
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                <Typo>{t(wall.newDescKey)}</Typo>
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
