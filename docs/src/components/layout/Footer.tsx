// Two kinds of link on this page: the column links stay inside the reader's
// locale tree (../common/Link), while the language switch deliberately crosses
// into the other one and already carries a fully-qualified address, so it uses
// react-router's Link directly — mapping it again would produce `/ru/ru/…`.
import { Link as CrossLocaleLink } from "react-router-dom";
import { Globe } from "lucide-react";
import { useI18n, useLocalePath } from "../../contexts/I18nContext";
import { Link } from "../common/Link";
import { Typo } from "../common/Typo";

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const TelegramIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

export const Footer: React.FC = () => {
  const { t, locale, setLocale, localeNames } = useI18n();
  const localePath = useLocalePath();

  // Airbnb-style column link: dark text, simple underline grown from the left
  // on hover (width can't be transitioned on text-decoration, so it's a
  // background gradient).
  const linkClass =
    "inline-block w-fit bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-px text-[15px] text-foreground/70 transition-[color,background-size] duration-300 ease-out hover:bg-[length:100%_1px] hover:text-foreground motion-reduce:transition-none";

  // Inline links in the bottom bar, separated by middle dots (Airbnb's pattern).
  const inlineLinkClass =
    "underline-offset-4 transition-colors hover:text-foreground hover:underline";

  const otherLocale = locale === "en" ? "ru" : "en";

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.4fr_2fr]">
          <div data-blok-testid="footer-brand">
            <div className="flex items-center gap-2.5">
              <img src="/mascot.png" alt="Blok mascot" className="size-9 object-contain" />
              <span className="font-display text-xl font-extrabold tracking-tight">Blok</span>
            </div>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-muted-foreground">
              <Typo>{t("footer.tagline")}</Typo>
            </p>
          </div>

          <div
            className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3"
            data-blok-testid="footer-links"
          >
            <div className="flex flex-col gap-4">
              <h4 className="text-[15px] font-semibold text-foreground">
                {t("footer.docColumnTitle")}
              </h4>
              <Link to="/docs#quick-start" className={linkClass}>
                {t("footer.quickStart")}
              </Link>
              <Link to="/docs" className={linkClass}>
                {t("footer.apiReference")}
              </Link>
              <Link to="/migration" className={linkClass}>
                {t("footer.migrationGuide")}
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="text-[15px] font-semibold text-foreground">
                {t("footer.resourcesColumnTitle")}
              </h4>
              <a
                href="https://github.com/JackUait/blok"
                className={linkClass}
                target="_blank"
                rel="noopener noreferrer"
                data-blok-testid="github-link"
              >
                {t("footer.github")}
              </a>
              <a
                href="https://www.npmjs.com/package/@bloklabs/core"
                className={linkClass}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("footer.npm")}
              </a>
              <Link to="/demo" className={linkClass}>
                {t("footer.liveDemo")}
              </Link>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="text-[15px] font-semibold text-foreground">
                {t("footer.communityColumnTitle")}
              </h4>
              <a
                href="https://github.com/JackUait/blok/issues"
                className={linkClass}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("footer.issues")}
              </a>
              <a
                href="https://github.com/JackUait/blok/discussions"
                className={linkClass}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("footer.discussions")}
              </a>
              <a
                href="https://github.com/JackUait/blok/blob/main/CONTRIBUTING.md"
                className={linkClass}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("footer.contributing")}
              </a>
            </div>
          </div>
        </div>

        <div
          className="mt-14 flex flex-col gap-4 border-t border-border pt-6 text-[15px] text-muted-foreground md:flex-row md:items-center md:justify-between"
          data-blok-testid="footer-bottom"
        >
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span>
              {t("footer.copyrightYear")}{" "}
              <a
                href="https://t.me/jackuait"
                target="_blank"
                rel="noopener noreferrer"
                className={`font-medium text-foreground ${inlineLinkClass}`}
                data-blok-testid="author-link"
              >
                {t("footer.author")}
              </a>
            </span>
            <span aria-hidden="true" className="text-muted-foreground/50">·</span>
            <span>
              <Typo>{t("footer.licensedUnder")}</Typo>{" "}
              <a
                href="https://www.apache.org/licenses/LICENSE-2.0"
                target="_blank"
                rel="noopener noreferrer"
                className={`font-medium text-foreground ${inlineLinkClass}`}
                data-blok-testid="license-link"
              >
                Apache 2.0
              </a>
            </span>
          </p>

          <div className="flex items-center gap-6">
            {/* A real link, so the other locale tree is reachable by a crawler
                and by anyone middle-clicking it. The click only records the
                preference; the navigation does the switching. */}
            <CrossLocaleLink
              to={localePath(otherLocale)}
              hrefLang={otherLocale}
              onClick={() => setLocale(otherLocale)}
              className={`flex items-center gap-2 font-medium text-foreground ${inlineLinkClass}`}
              aria-label={`${t("languageSelector.label")}: ${localeNames[otherLocale]}`}
            >
              <Globe className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
              {localeNames[otherLocale]}
            </CrossLocaleLink>

            <span className="h-4 w-px bg-border" aria-hidden="true" />

            <div className="flex items-center gap-4">
              <a
                href="https://github.com/JackUait/blok"
                className="text-foreground/70 transition-colors hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.githubAriaLabel")}
              >
                <GitHubIcon />
              </a>
              <a
                href="https://t.me/that_ai_guy"
                className="text-foreground/70 transition-colors hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("footer.telegramAriaLabel")}
              >
                <TelegramIcon />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
