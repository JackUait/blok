/// The top-level data keys stored as a diffed Y.Text. They must equal the
/// client's isDiffableTextKey and C# DiffableTextKeys; converter-keys.json
/// pins all of them.
pub const DIFFABLE_TEXT_KEYS: &[&str] = &["text", "code", "caption", "title", "alt", "artist"];

/// The nested data keys always stored as a Y.Array, so two peers adding ids
/// to one list keep both (EAGER_ARRAY_KEYS in the client).
pub const ORDERED_ID_ARRAY_KEYS: &[&str] = &[
    "blocks",
    "filters",
    "sorts",
    "calculations",
    "hiddenGroups",
    "collapsedGroups",
    "filterRules",
    "colorRules",
    "tableProperties",
    "buttonActions",
    "pageLayoutPlacements",
    "pageLayoutSections",
];
