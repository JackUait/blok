// src/components/utils/emoji/emoji-data.ts

import type { EmojiLocaleData } from './emoji-locale';

interface EmojiMartData {
  categories: Array<{ id: string; emojis: string[] }>;
  emojis: Record<string, {
    id: string;
    name: string;
    keywords: string[];
    skins: Array<{ native: string; unified: string }>;
    version: number;
  }>;
}

export interface ProcessedEmoji {
  native: string;
  skins: string[];
  id: string;
  name: string;
  keywords: string[];
  category: string;
}

export const CURATED_CALLOUT_EMOJIS: string[] = [
  '💡', '👉', '☝️', '✅', '⚠️', '🔑', '🔥', '📌', '✂️', '❓',
  '🚫', '⏰', '♻️', '🔒', '📖', '👣', '➡️', '📢', '🛠️', '⚙️',
];

// `pending` lets concurrent callers (many callouts rendering, prefetch racing
// open) share one import and one processing pass.
const cache: { data: ProcessedEmoji[] | null; pending: Promise<ProcessedEmoji[]> | null } = { data: null, pending: null };

function processCategory(category: { id: string; emojis: string[] }, emojis: EmojiMartData['emojis']): ProcessedEmoji[] {
  const result: ProcessedEmoji[] = [];

  for (const emojiId of category.emojis) {
    const emoji = emojis[emojiId];

    if (emoji === undefined) {
      continue;
    }

    const firstSkin = emoji.skins[0];

    if (firstSkin === undefined) {
      continue;
    }

    result.push({
      native: firstSkin.native,
      skins: emoji.skins.map(s => s.native),
      id: emoji.id,
      name: emoji.name,
      keywords: emoji.keywords,
      category: category.id,
    });
  }

  return result;
}

export async function loadEmojiData(): Promise<ProcessedEmoji[]> {
  if (cache.data !== null) {
    return cache.data;
  }

  // Cleared on failure so a later call retries.
  cache.pending ??= importEmojiData().finally(() => {
    cache.pending = null;
  });

  return cache.pending;
}

async function importEmojiData(): Promise<ProcessedEmoji[]> {
  const raw = await import('@emoji-mart/data') as unknown as { default: EmojiMartData } | EmojiMartData;
  const data: EmojiMartData = 'default' in raw && raw.default !== undefined
    ? raw.default
    : (raw as unknown as EmojiMartData);

  const processed = data.categories.flatMap(category => processCategory(category, data.emojis));

  cache.data = processed;
  return processed;
}

export function searchEmojis(emojis: ProcessedEmoji[], query: string, localeData?: EmojiLocaleData | null): ProcessedEmoji[] {
  const lower = query.toLowerCase();
  return emojis.filter(emoji => {
    // English match (always available from emoji-mart)
    if (emoji.name.toLowerCase().includes(lower) || emoji.keywords.some(k => k.includes(lower))) {
      return true;
    }

    // Translated match (when locale data is loaded)
    const entry = localeData?.[emoji.native];

    if (entry !== undefined) {
      return entry.n.toLowerCase().includes(lower) ||
        (entry.k !== undefined && entry.k.some(k => k.toLowerCase().includes(lower)));
    }

    return false;
  });
}

export function groupEmojisByCategory(emojis: ProcessedEmoji[]): Map<string, ProcessedEmoji[]> {
  const groups = new Map<string, ProcessedEmoji[]>();
  for (const emoji of emojis) {
    const group = groups.get(emoji.category) ?? [];
    group.push(emoji);
    groups.set(emoji.category, group);
  }
  return groups;
}
