// src/tools/callout/emoji-picker/emoji-data.ts

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

const cache: { data: ProcessedEmoji[] | null } = { data: null };

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

  const raw = await import('@emoji-mart/data') as unknown as { default: EmojiMartData } | EmojiMartData;
  const data: EmojiMartData = 'default' in raw && raw.default !== undefined
    ? raw.default
    : (raw as unknown as EmojiMartData);

  const processed = data.categories.flatMap(category => processCategory(category, data.emojis));

  cache.data = processed;
  return processed;
}

export function searchEmojis(emojis: ProcessedEmoji[], query: string): ProcessedEmoji[] {
  const lower = query.toLowerCase();
  return emojis.filter(
    emoji =>
      emoji.name.toLowerCase().includes(lower) ||
      emoji.keywords.some(k => k.includes(lower))
  );
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
