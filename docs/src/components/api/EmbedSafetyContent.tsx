import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { Prose } from "../common/Prose";

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-base leading-relaxed text-muted-foreground";

// Part names are pinned by api-data.embed-safety.test.ts.
const SECTIONS = ["whatBlokDoes", "frameSrc", "ownPages", "popups", "permissions", "uploads", "frameCheck", "measured"] as const;

export const EmbedSafetyContent: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-12">
      {SECTIONS.map((section) => (
        <div key={section} className="flex flex-col gap-4">
          <h2 className={headingClass}>
            <Typo>{t(`api.embedSafety.${section}.title`)}</Typo>
          </h2>
          <Prose text={t(`api.embedSafety.${section}.body`)} className={proseClass} />
        </div>
      ))}
    </div>
  );
};
