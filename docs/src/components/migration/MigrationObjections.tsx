import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { MIGRATION_OBJECTIONS } from "./migration-data";
import { cn } from "@/lib/utils";

/** "You keep almost all of your Editor.js code" — the switching-cost objection,
 *  answered before the reader asks. Checklist + the one-line alias swap. */
export const MigrationObjections: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n();
  return (
    <section className={cn("scroll-mt-28", className)}>
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
        <Typo>{t("migration.objectionHeading")}</Typo>
      </h2>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <ul className="divide-y divide-border border-y border-border">
          {MIGRATION_OBJECTIONS.map((key) => (
            <li key={key} className="flex gap-3 py-3 text-sm leading-relaxed text-foreground">
              <span aria-hidden className="font-bold text-primary">✓</span>
              <span><Typo>{t(key)}</Typo></span>
            </li>
          ))}
        </ul>

        <div>
          <pre className="overflow-x-auto rounded-xl bg-neutral-900 p-4 font-mono text-xs leading-relaxed text-neutral-100">
            <code>{t("migration.aliasNoteCode")}</code>
          </pre>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <Typo>{t("migration.objectionAliasCaption")}</Typo>
          </p>
        </div>
      </div>
    </section>
  );
};
