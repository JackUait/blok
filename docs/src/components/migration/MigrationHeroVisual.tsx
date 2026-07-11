import { useI18n } from "../../contexts/I18nContext";

/** A static mock of a Blok page showing what Editor.js structurally can't do:
 *  a nested toggle, a two-column block, and a database row. */
export const MigrationHeroVisual: React.FC = () => {
  const { t } = useI18n();
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 text-xs text-foreground shadow-card"
      data-blok-testid="migration-hero-visual"
      aria-hidden
    >
      <div className="px-2 py-1 text-sm font-bold">
        🗂️ {t("migration.heroVisualPageTitle")}{" "}
        <span className="text-xs font-normal text-muted-foreground">· {t("migration.heroVisualPageTag")}</span>
      </div>
      <div className="px-2 py-1">{t("migration.heroVisualLine")}</div>
      <div className="ml-4 border-l-2 border-primary pl-3">
        <div className="py-1">▸ {t("migration.heroVisualToggle")}</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-dashed border-border p-2">▤ {t("migration.heroVisualColA")}</div>
          <div className="rounded-lg border border-dashed border-border p-2">▤ {t("migration.heroVisualColB")}</div>
        </div>
      </div>
      <div className="px-2 py-1 opacity-70">▦ {t("migration.heroVisualDatabase")}</div>
    </div>
  );
};
