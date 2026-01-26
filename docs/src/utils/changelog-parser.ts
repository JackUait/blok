/**
 * CHANGELOG.md Parser
 *
 * Parses the project's CHANGELOG.md file and converts it to the format
 * expected by the ChangelogPage component.
 *
 * CHANGELOG.md format:
 * ## [version](compare-url) (date)
 * ### Emoji Category ([#pr](url)) ([commit](url))
 * - description ([#pr](url)) ([commit](url))
 */

import type { Change, Release } from "@/types/changelog";

// Emoji to category mapping - matches CHANGELOG.md conventions
const EMOJI_TO_CATEGORY: Record<string, Change["category"]> = {
  "✨": "added",
  "🐛": "fixed",
  "🔧": "changed", // CI/CD or infrastructure changes
  "♻️": "changed", // Refactoring
  "🧹": "changed", // Chores
  "🧪": "changed", // Tests
  "⚠️": "deprecated",
  "🗑️": "removed",
  "🔒": "security",
  "➕": "added",
  "🔄": "changed",
  "⚡": "changed", // Performance
  "📝": "changed", // Documentation
  "🎨": "changed", // Styling
  "✅": "changed", // Tests
};

// Fallback text to category mapping for headers without emojis
const TEXT_TO_CATEGORY: Record<string, Change["category"]> = {
  features: "added",
  "bug fixes": "fixed",
  fixes: "fixed",
  chores: "changed",
  refactoring: "changed",
  "ci/cd": "changed",
  tests: "changed",
  deprecated: "deprecated",
  removed: "removed",
  security: "security",
};

const GITHUB_RELEASES_URL = "https://github.com/JackUait/blok/releases";

interface ReleaseHeader {
  version: string;
  date: string;
  compareUrl?: string;
}

interface ParsedCategory {
  name: string;
  category: Change["category"];
  changes: Change[];
}

/**
 * Extract the version from a version string like "0.5.0" or "0.4.1-beta.5"
 */
const parseVersion = (versionString: string): string => {
  // Remove 'v' prefix if present and any brackets
  return versionString.replace(/^v/, "").trim();
};

/**
 * Determine release type from version number
 */
const getReleaseType = (version: string): Release["releaseType"] => {
  // Match semantic versioning including pre-release tags
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!match) {
    return "minor";
  }

  const [, major, minor, patch] = match;

  // While in 0.x.x, minor version bumps are "breaking" (treated as major/minor)
  // and patch versions are actual patches
  if (major === "0" && patch !== "0") {
    return "patch";
  }

  if (major === "0") {
    return minor === "0" ? "major" : "minor";
  }

  // For 1.x.x and above, use standard semver
  if (patch !== "0") {
    return "patch";
  }
  if (minor !== "0") {
    return "minor";
  }
  return "major";
};

/**
 * Parse a version header line like:
 * ## [0.5.0](url) (2026-01-23)
 */
const parseReleaseHeader = (line: string): ReleaseHeader | null => {
  // Match: ## [version](url) (date)
  const match = line.match(/^##\s+\[([^\]]+)\]\(([^)]+)\)\s+\(([^)]+)\)/);
  if (!match) {
    return null;
  }

  const [, version, compareUrl, date] = match;
  return {
    version: parseVersion(version),
    compareUrl,
    date,
  };
};

/**
 * Parse category header line like:
 * ### ✨ Features
 * or
 * ### 🐛 Bug Fixes
 * or
 * ### ✨ Features ([#33](url)) ([commit](url))
 */
const parseCategoryHeader = (line: string): ParsedCategory | null => {
  // Remove the ### prefix
  const content = line.replace(/^###\s+/, "").trim();

  // Extract emoji if present
  const emojiMatch = content.match(/^(\p{Emoji}+)\s+/u);
  const emoji = emojiMatch ? emojiMatch[1] : "";

  // Remove emoji to get the category name
  const rawCategoryName = emoji ? content.replace(emoji, "").trim() : content;

  // Clean up any parenthetical links at the end (like PR/commit links)
  const categoryName = rawCategoryName.replace(/\s*\([^)]+\)\s*/g, "").trim();

  // Determine the category type - use emoji if available, otherwise fall back to text
  const category =
    emoji && EMOJI_TO_CATEGORY[emoji]
      ? EMOJI_TO_CATEGORY[emoji]
      : getCategoryFromText(categoryName);

  return {
    name: categoryName,
    category,
    changes: [],
  };
};

/**
 * Determine category type from text (fallback when no emoji is present)
 */
const getCategoryFromText = (categoryName: string): Change["category"] => {
  const lowerName = categoryName.toLowerCase();
  const matchingEntry = Object.entries(TEXT_TO_CATEGORY).find(([key]) =>
    lowerName.includes(key),
  );
  return matchingEntry?.[1] ?? "changed";
};

/**
 * Parse a change item line like:
 * - implement undo/redo ([#33](url)) ([commit](url))
 *
 * The CHANGELOG uses a format where markdown links are wrapped in literal parentheses:
 * ([#33](url)) or ([hash](url))
 */
const parseChangeItem = (line: string): string => {
  // Remove the bullet point
  const withBulletRemoved = line.replace(/^-\s*/, "").trim();

  // Remove markdown links wrapped in literal parentheses
  // Pattern: ([text](url)) - outer parens are literal, inner is markdown link
  // Step 1: Remove ( [text](url) ) patterns
  return withBulletRemoved.replace(/\s?\(\[[^\]]*\]\([^)]*\)\)/g, "").trim();
};

/**
 * Parse the entire CHANGELOG.md content
 */
export const parseChangelog = (markdown: string): Release[] => {
  const lines = markdown.split("\n");
  const pendingReleases: Array<
    ReleaseHeader & { categories: ParsedCategory[] }
  > = [];

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith(">")) {
      continue;
    }

    // Check for release header
    if (line.startsWith("## [")) {
      handleReleaseHeader(line, pendingReleases);
      continue;
    }

    const currentRelease = pendingReleases.at(-1);
    if (!currentRelease) {
      continue;
    }

    // Check for category header
    if (line.startsWith("### ")) {
      handleCategoryHeader(line, currentRelease);
      continue;
    }

    // Check for change item (inside a category)
    if (line.trim().startsWith("- ") && currentRelease.categories.length > 0) {
      handleChangeItem(line, currentRelease);
    }
  }

  // Convert all pending releases to final format
  return pendingReleases.map(convertReleaseToFormat);
};

/**
 * Handle a release header line by parsing and adding to pending releases
 */
const handleReleaseHeader = (
  line: string,
  pendingReleases: Array<ReleaseHeader & { categories: ParsedCategory[] }>,
): void => {
  const header = parseReleaseHeader(line);
  if (header) {
    pendingReleases.push({ ...header, categories: [] });
  }
};

/**
 * Handle a category header line by parsing and adding to current release
 */
const handleCategoryHeader = (
  line: string,
  currentRelease: ReleaseHeader & { categories: ParsedCategory[] },
): void => {
  const category = parseCategoryHeader(line);
  if (category) {
    currentRelease.categories.push(category);
  }
};

/**
 * Handle a change item line by parsing and adding to current category
 */
const handleChangeItem = (
  line: string,
  currentRelease: ReleaseHeader & { categories: ParsedCategory[] },
): void => {
  const description = parseChangeItem(line);
  if (!description) {
    return;
  }

  const currentCategory =
    currentRelease.categories[currentRelease.categories.length - 1];
  currentCategory.changes.push({
    category: currentCategory.category,
    description,
  });
};

/**
 * Convert parsed release data to the Release format
 */
const convertReleaseToFormat = (
  data: ReleaseHeader & { categories: ParsedCategory[] },
): Release => {
  const { version, date, categories } = data;

  // Flatten all changes from all categories
  const changes: Change[] = categories.flatMap((cat) => cat.changes);

  // Determine release type
  const releaseType = getReleaseType(version);

  // Generate release URL from version
  const releaseUrl = `${GITHUB_RELEASES_URL}/tag/v${version}`;

  // Generate highlight from first few changes if notable
  const highlight = getHighlight(changes, releaseType);

  return {
    version,
    date,
    releaseType,
    releaseUrl,
    highlight,
    changes,
  };
};

/**
 * Get highlight description from changes if applicable
 */
const getHighlight = (
  changes: Change[],
  releaseType: Release["releaseType"],
): string | undefined => {
  const hasSignificantChanges = changes.some(
    (c) => c.category === "added" || c.category === "changed",
  );

  if (!hasSignificantChanges || releaseType === "patch") {
    return undefined;
  }

  // Pick first "added" or "changed" item as highlight
  const highlightChange = changes.find(
    (c) => c.category === "added" || c.category === "changed",
  );
  return highlightChange?.description;
};

/**
 * Parse CHANGELOG.md and return releases
 * This function uses fetch to load the CHANGELOG.md content at runtime
 *
 * Note: In production, consider building the changelog into the bundle
 */
export const loadChangelog = async (): Promise<Release[]> => {
  try {
    const response = await fetch("/CHANGELOG.md");
    if (!response.ok) {
      throw new Error(`Failed to load CHANGELOG.md: ${response.statusText}`);
    }
    const changelogContent = await response.text();
    return parseChangelog(changelogContent);
  } catch (error) {
    console.error("Error loading changelog:", error);
    return [];
  }
};
