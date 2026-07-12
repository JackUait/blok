import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MigrationHeroVisual } from "./MigrationHeroVisual";

/** "Outgrown Editor.js?" hero. No eyebrow — the h1 leads (repo copy rule). */
export const MigrationHero: React.FC<{ inline?: boolean }> = ({ inline = false }) => {
  const { t } = useI18n();
  return (
    <section className={cn("relative overflow-hidden pb-16", inline ? "pt-10" : "pt-16 sm:pt-24")}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-28 left-1/4 size-[32rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -top-8 right-[-7rem] size-[26rem] rounded-full bg-chart-3/10 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-x-16">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
            {t("migration.persuadeHeroPre")}{" "}
            <span className="text-brand-gradient">{t("migration.persuadeHeroBrand")}</span>
            {t("migration.persuadeHeroSuffix")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            <Typo>{t("migration.persuadeHeroLede")}</Typo>
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3" data-blok-testid="hero-ctas">
            <Button variant="brand" size="lg" asChild>
              <a href="#walls"><Typo>{t("migration.persuadeHeroCtaWalls")}</Typo></a>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a href="#move"><Typo>{t("migration.persuadeHeroCtaMigrate")}</Typo></a>
            </Button>
          </div>
        </div>

        <div className="mt-14 lg:mt-0">
          <MigrationHeroVisual />
        </div>
      </div>
    </section>
  );
};
