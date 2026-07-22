import { Link } from "react-router-dom";
import { useMemo } from "react";
// Inlined at build time so the changelog prose lands in the prerendered HTML.
import CHANGELOG_MARKDOWN from "../../../CHANGELOG.md?raw";
import { Nav } from "../components/layout/Nav";
import { Footer } from "../components/layout/Footer";
import { parseChangelog } from "../utils/changelog-parser";
import type { Release } from "@/types/changelog";
import { NAV_LINKS } from "../utils/constants";
import { useI18n } from "../contexts/I18nContext";
import { Typo } from "../components/common/Typo";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { trackEvent, ANALYTICS_EVENTS } from "@/lib/analytics";

// Category icons as SVG components - refined strokes
const Icons = {
  added: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  changed: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6" />
    </svg>
  ),
  fix: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  deprecated: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
    </svg>
  ),
  removed: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  security: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  sparkles: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4zM5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2zM19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
    </svg>
  ),
  external: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  ),
  clock: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
};

const IconFor = ({ name }: { name: keyof typeof Icons }) => {
  const IconComponent = Icons[name];
  if (!IconComponent) {
    return null;
  }
  return <IconComponent />;
};

const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  ru: "ru-RU",
};

const formatDate = (dateString: string, locale: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(LOCALE_MAP[locale] ?? "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Format a changelog description with proper styling for:
 * - **bold** text (feature names)
 * - `code` backticks
 * - — em-dashes (visual separators)
 */
const formatDescription = (text: string): React.ReactNode => {
  // Split by em-dash to separate title from description
  const parts = text.split(/\s*—\s*/);
  const hasEmDash = parts.length > 1;

  const formatPart = (part: string, key: number): React.ReactNode => {
    // Match **bold** and `code` patterns
    const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)/g;
    const matches = Array.from(part.matchAll(regex));

    if (matches.length === 0) {
      return part;
    }

    const tokens: React.ReactNode[] = [];
    const buildToken = (matched: string, matchIndex: number): React.ReactNode => {
      const isBold = matched.startsWith("**") && matched.endsWith("**");
      const isCode = matched.startsWith("`") && matched.endsWith("`");

      if (isBold) {
        return (
          <strong key={`${key}-${matchIndex}`} className="font-semibold text-foreground">
            {matched.slice(2, -2)}
          </strong>
        );
      }

      if (isCode) {
        return (
          <code
            key={`${key}-${matchIndex}`}
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {matched.slice(1, -1)}
          </code>
        );
      }

      return matched;
    };

    matches.reduce((lastIndex, match) => {
      const matchIndex = match.index ?? 0;
      const matched = match[0];

      if (matchIndex > lastIndex) {
        tokens.push(part.slice(lastIndex, matchIndex));
      }

      tokens.push(buildToken(matched, matchIndex));

      return matchIndex + matched.length;
    }, 0);

    // Add remaining text after last match
    const lastMatch = matches[matches.length - 1];
    const lastMatchEnd = (lastMatch.index ?? 0) + lastMatch[0].length;

    if (lastMatchEnd < part.length) {
      tokens.push(part.slice(lastMatchEnd));
    }

    return tokens;
  };

  if (hasEmDash) {
    return (
      <>
        <span className="font-medium text-foreground">{formatPart(parts[0], 0)}</span>
        <span className="text-muted-foreground"> — </span>
        <span className="text-muted-foreground">{formatPart(parts.slice(1).join(" — "), 1)}</span>
      </>
    );
  }

  return formatPart(text, 0);
};

interface ChangelogContentProps {
  /** When embedded inline (homepage tab strip), tighten the header top spacing. */
  inline?: boolean;
}

const ChangelogContent: React.FC<ChangelogContentProps> = ({ inline = false }) => {
  const { t, locale } = useI18n();
  const headerClass = cn(
    'mx-auto max-w-3xl px-6 pb-24 text-center',
    inline ? 'pt-10' : 'pt-16 sm:pt-24',
  );
  // Parsed from the build-time import, not fetched: prerendering runs no
  // effects, so a runtime fetch would freeze this route's HTML at its loading
  // state and ship the site's largest prose asset to crawlers as "Loading…".
  const releases: Release[] = useMemo(() => parseChangelog(CHANGELOG_MARKDOWN), []);

  const badgeVariantFor = (
    category: string,
  ): "default" | "secondary" | "outline" | "muted" => {
    switch (category) {
      case "added":
        return "default";
      case "fix":
      case "security":
        return "secondary";
      case "removed":
      case "deprecated":
        return "muted";
      default:
        return "outline";
    }
  };

  const visibleReleases = releases.filter((release) =>
    release.changes.some((c) => c.description.trim().length > 0),
  );

  return (
    <>
      <div className={headerClass}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-bold tracking-wide text-primary uppercase">
          <span className="size-3.5 [&>svg]:size-full" aria-hidden="true">
            <Icons.clock />
          </span>
          <Typo>{t('changelog.badge')}</Typo>
        </span>
        <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          {t('changelog.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          <Typo>{t('changelog.description')}</Typo>
        </p>
      </div>

      <div className="mx-auto max-w-3xl px-6 pb-24">
        <ol className="relative space-y-12 border-l border-border pl-8 sm:pl-10">
            {visibleReleases.map((release) => (
              <li key={release.version} className="relative">
                <span
                  className={cn(
                    "absolute -left-[2.1rem] top-1.5 size-3 rounded-full ring-4 ring-background sm:-left-[2.6rem]",
                    release.highlight ? "bg-primary" : "bg-border",
                  )}
                  aria-hidden="true"
                />

                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {release.releaseUrl ? (
                    <a
                      href={release.releaseUrl}
                      className="font-display text-2xl font-extrabold tracking-tight text-foreground transition-colors hover:text-primary"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        trackEvent(ANALYTICS_EVENTS.changelogVersionOpen, {
                          version: release.version,
                          release_type: release.releaseType,
                        })
                      }
                    >
                      v{release.version}
                    </a>
                  ) : (
                    <span className="font-display text-2xl font-extrabold tracking-tight text-foreground">
                      v{release.version}
                    </span>
                  )}
                  <Badge variant="outline" className="uppercase">
                    {t(`changelog.releaseType.${release.releaseType}`) || release.releaseType}
                  </Badge>
                  <span className="text-sm font-medium text-muted-foreground">
                    {formatDate(release.date, locale)}
                  </span>
                </div>

                <div
                  className={cn(
                    "rounded-2xl border bg-card p-6 shadow-card sm:p-7",
                    release.highlight ? "border-primary/30" : "border-border",
                  )}
                >
                  {release.highlight && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-secondary/60 p-4">
                      <span className="mt-0.5 size-4 shrink-0 text-primary [&>svg]:size-full" aria-hidden="true">
                        <Icons.sparkles />
                      </span>
                      <p className="text-sm leading-relaxed text-foreground">
                        {formatDescription(release.highlight)}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col gap-px">
                    {release.changes
                      .filter((change) => change.description.trim().length > 0)
                      .map((change, index) => (
                        <div key={index}>
                          {index > 0 && <Separator className="my-4" />}
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                            <Badge
                              variant={badgeVariantFor(change.category)}
                              className="uppercase [&>span]:size-3"
                            >
                              <span className="[&>svg]:size-full" aria-hidden="true">
                                <IconFor name={change.category as keyof typeof Icons} />
                              </span>
                              {t(`changelog.category.${change.category}`) || change.category}
                            </Badge>
                            <span className="text-sm leading-relaxed text-muted-foreground">
                              {formatDescription(change.description)}
                              {change.link && (
                                <Link
                                  to={change.link}
                                  className="ml-1.5 inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                                >
                                  <Typo>{t('changelog.viewDocs')}</Typo>
                                  <span className="size-3 [&>svg]:size-full" aria-hidden="true">
                                    <Icons.external />
                                  </span>
                                </Link>
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
    </>
  );
};

const ChangelogPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main className="min-h-screen bg-background pt-16">
      <ChangelogContent />
    </main>
    <Footer />
  </>
);

export { ChangelogContent };
export default ChangelogPage;
