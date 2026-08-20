import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { renderInline } from "./inline-code";

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-base leading-relaxed text-muted-foreground";

/**
 * The audit-optics threat-model disclosure for the dev override seam every
 * published `@bloklabs/core` entry ships with. Design:
 * docs/plans/2026-08-19-blok-version-override-extension-design.md (gitignored,
 * local to the blok repo).
 */
export const DevOverrideSeamContent: React.FC = () => {
  const { t } = useI18n();

  const sections = ["whatItIs", "whySafe", "optOut"] as const;

  return (
    <div className="flex flex-col gap-12">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-4">
          <h2 className={headingClass}>
            <Typo>{t(`api.devOverrideSeam.${section}.title`)}</Typo>
          </h2>
          <p className={proseClass}>
            {renderInline(t(`api.devOverrideSeam.${section}.body`))}
          </p>
        </div>
      ))}
    </div>
  );
};
