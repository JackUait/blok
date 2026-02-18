import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { Nav } from "../components/layout/Nav";
import { Footer } from "../components/layout/Footer";
import { parseChangelog } from "../utils/changelog-parser";
import type { Release } from "@/types/changelog";
import "../../assets/changelog.css";
import { NAV_LINKS } from "../utils/constants";

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

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
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
          <strong key={`${key}-${matchIndex}`} className="changelog-bold">
            {matched.slice(2, -2)}
          </strong>
        );
      }

      if (isCode) {
        return (
          <code key={`${key}-${matchIndex}`} className="changelog-code">
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
        <span className="changelog-title">{formatPart(parts[0], 0)}</span>
        <span className="changelog-separator"> — </span>
        <span className="changelog-detail">{formatPart(parts.slice(1).join(" — "), 1)}</span>
      </>
    );
  }

  return formatPart(text, 0);
};

const ChangelogPage: React.FC = () => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadChangelog = async () => {
      try {
        const response = await fetch("/CHANGELOG.md");
        if (!response.ok) {
          throw new Error(
            `Failed to load CHANGELOG.md: ${response.statusText}`,
          );
        }
        const changelogContent = await response.text();
        const parsed = parseChangelog(changelogContent);
        setReleases(parsed);
      } catch (err) {
        console.error("Error loading changelog:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void loadChangelog();
  }, []);

  if (loading) {
    return (
      <>
        <Nav links={NAV_LINKS} />
        <main className="changelog-main">
          <div className="changelog-hero">
            <div className="changelog-hero-badge">
              <Icons.clock />
              Version History
            </div>
            <h1 className="changelog-hero-title">Changelog</h1>
            <p className="changelog-hero-description">Loading...</p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Nav links={NAV_LINKS} />
        <main className="changelog-main">
          <div className="changelog-hero">
            <h1 className="changelog-hero-title">Changelog</h1>
            <p className="changelog-hero-description">
              Error loading changelog: {error}
            </p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="changelog-main">
        {/* Floating gradient orbs for ambient effect */}
        <div className="changelog-gradient-1" aria-hidden="true" />
        <div className="changelog-gradient-2" aria-hidden="true" />

        <div className="changelog-hero">
          <h1 className="changelog-hero-title">Changelog</h1>
          <p className="changelog-hero-description">
            Track every improvement, fix, and feature as Blok evolves
          </p>
        </div>

        <div className="changelog-timeline">
          {releases.filter((release) => release.changes.some((c) => c.description.trim().length > 0)).map((release) => (
            <article
              key={release.version}
              className={`changelog-release ${release.releaseType} ${release.highlight ? "highlight" : ""}`}
            >
              <div className="changelog-version">
                {release.releaseUrl ? (
                  <a
                    href={release.releaseUrl}
                    className="changelog-version-number"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    v{release.version}
                  </a>
                ) : (
                  <span className="changelog-version-number">
                    v{release.version}
                  </span>
                )}
                <span className="changelog-version-type">
                  {release.releaseType}
                </span>
                <span className="changelog-version-date">
                  {formatDate(release.date)}
                </span>
              </div>

              <div className="changelog-release-card">
                {release.highlight && (
                  <div className="changelog-release-highlight">
                    <p>
                      <Icons.sparkles />
                      {formatDescription(release.highlight)}
                    </p>
                  </div>
                )}

                <div className="changelog-changes">
                  {release.changes.filter((change) => change.description.trim().length > 0).map((change, index) => (
                    <div key={index} className="changelog-change">
                      <span
                        className={`changelog-change-badge ${change.category}`}
                      >
                        <IconFor name={change.category as keyof typeof Icons} />
                        {change.category}
                      </span>
                      <span className="changelog-change-description">
                        {formatDescription(change.description)}
                        {change.link && (
                          <Link
                            to={change.link}
                            className="changelog-change-link"
                          >
                            View docs
                            <Icons.external />
                          </Link>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
};

export default ChangelogPage;
