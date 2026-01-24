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

import type { Change, Release } from '@/types/changelog';

// Emoji to category mapping - matches CHANGELOG.md conventions
const EMOJI_TO_CATEGORY: Record<string, Change['category']> = {
  '✨': 'added',
  '🐛': 'fixed',
  '🔧': 'changed', // CI/CD or infrastructure changes
  '♻️': 'changed', // Refactoring
  '🧹': 'changed', // Chores
  '🧪': 'changed', // Tests
  '⚠️': 'deprecated',
  '🗑️': 'removed',
  '🔒': 'security',
  '➕': 'added',
  '🔄': 'changed',
  '⚡': 'changed', // Performance
  '📝': 'changed', // Documentation
  '🎨': 'changed', // Styling
  '✅': 'changed', // Tests
};

// Fallback text to category mapping for headers without emojis
const TEXT_TO_CATEGORY: Record<string, Change['category']> = {
  'features': 'added',
  'bug fixes': 'fixed',
  'fixes': 'fixed',
  'chores': 'changed',
  'refactoring': 'changed',
  'ci/cd': 'changed',
  'tests': 'changed',
  'deprecated': 'deprecated',
  'removed': 'removed',
  'security': 'security',
};

const GITHUB_RELEASES_URL = 'https://github.com/JackUait/blok/releases';

interface ReleaseHeader {
  version: string;
  date: string;
  compareUrl?: string;
}

interface ParsedCategory {
  name: string;
  category: Change['category'];
  changes: Change[];
}

/**
 * Extract the version from a version string like "0.5.0" or "0.4.1-beta.5"
 */
function parseVersion(versionString: string): string {
  // Remove 'v' prefix if present and any brackets
  return versionString.replace(/^v/, '').trim();
}

/**
 * Determine release type from version number
 */
function getReleaseType(version: string): Release['releaseType'] {
  // Match semantic versioning including pre-release tags
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!match) return 'minor';

  const [, major, minor, patch] = match;

  if (major === '0') {
    // While in 0.x.x, minor version bumps are "breaking" (treated as major/minor)
    // and patch versions are actual patches
    if (patch !== '0') return 'patch';
    return minor === '0' ? 'major' : 'minor';
  }

  // For 1.x.x and above, use standard semver
  if (patch !== '0') return 'patch';
  if (minor !== '0') return 'minor';
  return 'major';
}

/**
 * Parse a version header line like:
 * ## [0.5.0](url) (2026-01-23)
 */
function parseReleaseHeader(line: string): ReleaseHeader | null {
  // Match: ## [version](url) (date)
  const match = line.match(/^##\s+\[([^\]]+)\]\(([^)]+)\)\s+\(([^)]+)\)/);
  if (!match) return null;

  const [, version, compareUrl, date] = match;
  return {
    version: parseVersion(version),
    compareUrl,
    date,
  };
}

/**
 * Parse category header line like:
 * ### ✨ Features
 * or
 * ### 🐛 Bug Fixes
 * or
 * ### ✨ Features ([#33](url)) ([commit](url))
 */
function parseCategoryHeader(line: string): ParsedCategory | null {
  // Remove the ### prefix
  const content = line.replace(/^###\s+/, '').trim();

  // Extract emoji if present
  const emojiMatch = content.match(/^(\p{Emoji}+)\s+/u);
  const emoji = emojiMatch ? emojiMatch[1] : '';

  // Remove emoji to get the category name
  let categoryName = emoji ? content.replace(emoji, '').trim() : content;

  // Clean up any parenthetical links at the end (like PR/commit links)
  categoryName = categoryName.replace(/\s*\([^)]+\)\s*/g, '').trim();

  // Determine the category type
  let category: Change['category'] = 'changed';
  if (emoji && EMOJI_TO_CATEGORY[emoji]) {
    category = EMOJI_TO_CATEGORY[emoji];
  } else {
    const lowerName = categoryName.toLowerCase();
    for (const [key, value] of Object.entries(TEXT_TO_CATEGORY)) {
      if (lowerName.includes(key)) {
        category = value;
        break;
      }
    }
  }

  return {
    name: categoryName,
    category,
    changes: [],
  };
}

/**
 * Parse a change item line like:
 * - implement undo/redo ([#33](url)) ([commit](url))
 *
 * The CHANGELOG uses a format where markdown links are wrapped in literal parentheses:
 * ([#33](url)) or ([hash](url))
 */
function parseChangeItem(line: string): string {
  // Remove the bullet point
  let description = line.replace(/^-\s*/, '').trim();

  // Remove markdown links wrapped in literal parentheses
  // Pattern: ([text](url)) - outer parens are literal, inner is markdown link
  // Step 1: Remove ( [text](url) ) patterns
  description = description.replace(/\s?\(\[[^\]]*\]\([^)]*\)\)/g, '').trim();

  return description;
}

/**
 * Parse the entire CHANGELOG.md content
 */
export function parseChangelog(markdown: string): Release[] {
  const lines = markdown.split('\n');
  const releases: Release[] = [];

  let currentRelease: (ReleaseHeader & { categories: ParsedCategory[] }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('>')) {
      continue;
    }

    // Check for release header
    if (line.startsWith('## [')) {
      // Save previous release if exists
      if (currentRelease) {
        releases.push(convertReleaseToFormat(currentRelease));
      }

      const header = parseReleaseHeader(line);
      if (header) {
        currentRelease = { ...header, categories: [] };
      }
      continue;
    }

    // Check for category header (inside a release)
    if (line.startsWith('### ') && currentRelease) {
      const category = parseCategoryHeader(line);
      if (category) {
        currentRelease.categories.push(category);
      }
      continue;
    }

    // Check for change item (inside a category)
    if (line.trim().startsWith('- ') && currentRelease && currentRelease.categories.length > 0) {
      const description = parseChangeItem(line);
      if (description) {
        const currentCategory = currentRelease.categories[currentRelease.categories.length - 1];
        currentCategory.changes.push({
          category: currentCategory.category,
          description,
        });
      }
    }
  }

  // Don't forget the last release
  if (currentRelease) {
    releases.push(convertReleaseToFormat(currentRelease));
  }

  return releases;
}

/**
 * Convert parsed release data to the Release format
 */
function convertReleaseToFormat(
  data: ReleaseHeader & { categories: ParsedCategory[] }
): Release {
  const { version, date, compareUrl, categories } = data;

  // Flatten all changes from all categories
  const changes: Change[] = categories.flatMap((cat) => cat.changes);

  // Determine release type
  const releaseType = getReleaseType(version);

  // Generate release URL from version
  const releaseUrl = compareUrl
    ? `${GITHUB_RELEASES_URL}/tag/v${version}`
    : `${GITHUB_RELEASES_URL}/tag/v${version}`;

  // Generate highlight from first few changes if notable
  let highlight: string | undefined;
  const hasSignificantChanges = changes.some(
    (c) => c.category === 'added' || c.category === 'changed'
  );
  if (hasSignificantChanges && releaseType !== 'patch') {
    // Pick first "added" or "changed" item as highlight
    const highlightChange = changes.find((c) => c.category === 'added' || c.category === 'changed');
    if (highlightChange) {
      highlight = highlightChange.description;
    }
  }

  return {
    version,
    date,
    releaseType,
    releaseUrl,
    highlight,
    changes,
  };
}

/**
 * Parse CHANGELOG.md and return releases
 * This function uses fetch to load the CHANGELOG.md content at runtime
 *
 * Note: In production, consider building the changelog into the bundle
 */
export async function loadChangelog(): Promise<Release[]> {
  try {
    const response = await fetch('/CHANGELOG.md');
    if (!response.ok) {
      throw new Error(`Failed to load CHANGELOG.md: ${response.statusText}`);
    }
    const changelogContent = await response.text();
    return parseChangelog(changelogContent);
  } catch (error) {
    console.error('Error loading changelog:', error);
    return [];
  }
}
