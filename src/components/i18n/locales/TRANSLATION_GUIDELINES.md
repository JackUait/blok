# Translation Guidelines

This document provides guidelines for creating and maintaining translations for the Blok editor. Follow these principles to ensure consistent, high-quality translations across all supported languages.

## Core Principles

1. **Use UX-friendly, natural translations** suitable for real product interfaces
2. **Prioritize clarity, brevity, and common UI patterns** over literal translation
3. **Avoid slang, transliteration, and technical jargon**
4. **Adapt wording to context** (buttons, tooltips, hints, mobile vs desktop)
5. **Prefer action-oriented, user-centric phrasing**

## Technical Requirements

### File Format

- Each locale has a directory named with its ISO 639-1 code (e.g., `en/`, `fr/`, `de/`)
- Translations are stored in `messages.json` as a flat key-value object
- Keys use dot notation for namespacing (e.g., `ui.popover.search`)
- All keys from `en/messages.json` must be present in every locale

### Key Naming

Keys follow this structure:
- `ui.*` - General UI elements (popovers, toolbars, menus)
- `toolNames.*` - Names of tools shown in the toolbox
- `tools.*` - Tool-specific strings (e.g., `tools.link.addLink`)
- `blockTunes.*` - Block menu actions (e.g., delete, duplicate)
- `accessibility.*` - Screen reader announcements and ARIA labels

### Placeholders

Some strings contain placeholders in `{curlyBraces}` format. These must be preserved exactly as-is:
```json
"accessibility.dragAnnouncements.dropPosition": "Will drop at position {position} of {total}"
```

## Translation Context

### Tool Names (`toolNames.*`)

These appear in the toolbox/slash menu. Keep them short (1-2 words):
- Good: "Text", "Heading", "Bulleted list"
- Avoid: "Text paragraph block", "Header element"

### UI Actions (`ui.*`)

These are tooltips and button labels. Be concise and action-oriented:
- Good: "Drag to move", "Click to add below"
- Avoid: "You can drag this to move it", "Click here to add a new block below"

### Accessibility (`accessibility.*`)

Screen reader text should be descriptive but not verbose:
- Good: "Drag to move block or click for menu"
- Avoid: "This is a drag handle that you can use to move the block"

### Error Messages (`tools.stub.*`)

Be clear and helpful without being alarming:
- Good: "This block cannot be displayed"
- Avoid: "ERROR: Block rendering failed!"

## Examples

### Good Translations

| Key | English | French (Good) |
|-----|---------|---------------|
| `ui.popover.search` | Search | Rechercher |
| `toolNames.bulletedList` | Bulleted list | Liste à puces |
| `blockTunes.delete` | Delete | Supprimer |

### What to Avoid

| Issue | Bad Example | Better |
|-------|-------------|--------|
| Too literal | "Liste avec des points" | "Liste à puces" |
| Too verbose | "Cliquez ici pour rechercher" | "Rechercher" |
| Technical jargon | "Supprimer le bloc DOM" | "Supprimer" |
| Transliteration | "Serch" (phonetic) | "Buscar" (Spanish) |

## RTL Languages

Arabic, Hebrew, Persian, Urdu, and other RTL languages are supported. The editor handles text direction automatically based on locale configuration. Ensure translations read naturally in RTL flow.

## Grammar & Style

- **Consistent grammatical person** - Use imperative mood for actions ("Delete" not "Deletes" or "To delete")
- **Capitalization conventions** - Follow language-specific rules (German capitalizes nouns, English title-cases UI labels)
- **Formal/informal register** - Choose formal (vous/Sie/usted) or informal (tu/du/tú) consistently within each language

## Practical Considerations

- **Text expansion** - Translations can be 30-50% longer than English; maintain brevity to avoid UI overflow
- **Keyboard shortcuts** - Adapt platform-specific mentions ("Option-click" vs "Alt-click") for locale conventions
- **Native punctuation** - Use language-appropriate punctuation (French uses non-breaking spaces before `:` and `;`, Chinese uses `「」` quotation marks, etc.)

## Quality Assurance

- **Test in context** - UI strings may look correct in isolation but awkward when displayed in the actual interface
- **Gender/number agreement** - Ensure surrounding text handles grammatical variations when placeholders insert dynamic values
- **Reference established terminology** - Check how major apps (Google Docs, Notion, Microsoft Word) translate similar concepts in each language

## Validation

Run the translation checker to verify completeness:
```bash
node scripts/i18n/check-translations.mjs
```

This will report any missing or extra keys compared to the English source.
