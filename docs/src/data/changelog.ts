import type { Release } from '@/types/changelog';

/**
 * CHANGELOG data
 *
 * This data is now parsed from the root CHANGELOG.md file at build time.
 * The CHANGELOG.md file is the source of truth for all version history.
 *
 * To update the changelog:
 * 1. Edit /CHANGELOG.md following the conventional changelog format
 * 2. Run the tests to ensure the parser handles your changes correctly
 *
 * The parser extracts:
 * - Version numbers and release dates from headers
 * - Categories from emoji-prefixed headers (✨ Features, 🐛 Bug Fixes, etc.)
 * - Individual changes from bullet items
 * - Automatically strips PR/commit links for cleaner display
 */

// Import and parse the CHANGELOG.md at build time
// The vite config serves the parent directory, so we can fetch this at runtime
export const CHANGELOG_DATA: Release[] = [];

// This is a placeholder - actual data is loaded via loadChangelog()
// in the ChangelogPage component
//
// For static build purposes, we could pre-generate this data,
// but for now we load it dynamically.
