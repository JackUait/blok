import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { Prose } from "../common/Prose";

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-base leading-relaxed text-muted-foreground";

export const TabSyncContent: React.FC = () => {
  const { t } = useI18n();

  const sections = ["whatItDoes", "documentId", "whatSyncs", "saving", "toggles", "limits"] as const;

  return (
    <div className="flex flex-col gap-12">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-4">
          <h2 className={headingClass}>
            <Typo>{t(`api.tabSync.${section}.title`)}</Typo>
          </h2>
          <Prose text={t(`api.tabSync.${section}.body`)} className={proseClass} />
        </div>
      ))}
    </div>
  );
};
