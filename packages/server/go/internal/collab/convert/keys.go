package convert

// diffableTextKeys are the top-level data keys stored as a diffed Y.Text.
// They must equal the client's isDiffableTextKey and C# DiffableTextKeys;
// converter-keys.json pins all three.
var diffableTextKeys = []string{"text", "code", "caption", "title", "alt", "artist"}

// orderedIDArrayKeys are the nested data keys always stored as a Y.Array, so
// two peers adding ids to one list keep both (EAGER_ARRAY_KEYS in the client).
var orderedIDArrayKeys = []string{"blocks", "filters", "sorts", "calculations", "hiddenGroups", "collapsedGroups", "filterRules", "colorRules", "tableProperties", "buttonActions", "pageLayoutPlacements", "pageLayoutSections"}
