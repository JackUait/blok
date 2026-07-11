import { Link } from "react-router-dom";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { MIGRATION_MOVE_STEPS, CODEMOD_APPLY_COMMAND } from "./migration-data";
import { cn } from "@/lib/utils";

/** The calm close: one command, three steps, and a link to the full reference. */
export const MigrationMove: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n();
  return (
    <section id="move" className={cn("scroll-mt-28 text-center", className)}>
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
        <Typo>{t("migration.moveHeading")}</Typo>
      </h2>

      <pre className="mx-auto mt-6 inline-block overflow-x-auto rounded-xl bg-neutral-900 px-6 py-4 font-mono text-sm text-neutral-100">
        <code>{CODEMOD_APPLY_COMMAND}</code>
      </pre>

      <ol className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
        {MIGRATION_MOVE_STEPS.map((key, i) => (
          <li key={key}>
            <span className="font-semibold text-foreground">{i + 1}.</span> <Typo>{t(key)}</Typo>
          </li>
        ))}
      </ol>

      <Link
        to="/migration/reference"
        className="mt-8 inline-block text-sm font-semibold text-primary hover:underline"
      >
        <Typo>{t("migration.moveReferenceLink")}</Typo> →
      </Link>
    </section>
  );
};
