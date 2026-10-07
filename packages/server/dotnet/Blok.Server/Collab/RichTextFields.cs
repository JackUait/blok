namespace Blok.Server.Collab;

/// <summary>
/// Which top-level (block type, data key) pairs hold rich text, and so are
/// stored as a formatted <see cref="Yjs.YXmlText"/>.
///
/// LOCKSTEP: the built-ins equal <c>CURRENT_RICH_TEXT_FIELDS</c>
/// (src/shared/rich-text/fields.ts); both sides are pinned to
/// test/unit/server-conformance/fixtures/rich-text-fields.json. A host adds
/// its custom tools' <c>richTextFields</c> through
/// <c>BlokServerOptions.RichTextFields</c>, and must list exactly what its
/// client tools declare: a field one side treats as rich and the other does
/// not is written in two shapes.
/// </summary>
internal sealed class RichTextFields
{
  private static readonly Dictionary<string, string[]> BuiltIns = new(StringComparer.Ordinal)
  {
    ["paragraph"] = ["text"],
    ["header"] = ["text"],
    ["quote"] = ["text"],
    ["toggle"] = ["text"],
    ["list"] = ["text"],
  };

  private readonly Dictionary<string, HashSet<string>> table;

  private RichTextFields(Dictionary<string, HashSet<string>> table)
  {
    this.table = table;
  }

  internal static RichTextFields BuiltIn { get; } = With(null);

  /// <summary>Type → its rich keys, built-ins included.</summary>
  internal IReadOnlyDictionary<string, IReadOnlyList<string>> Table =>
      table.ToDictionary(
          entry => entry.Key,
          entry => (IReadOnlyList<string>)entry.Value.Order(StringComparer.Ordinal).ToArray(),
          StringComparer.Ordinal);

  /// <summary>The built-ins plus <paramref name="custom"/>.</summary>
  /// <exception cref="ArgumentException">A name is empty or holds a NUL, or a list is null.</exception>
  internal static RichTextFields With(IEnumerable<KeyValuePair<string, IList<string>>>? custom)
  {
    var table = BuiltIns.ToDictionary(
        entry => entry.Key,
        entry => new HashSet<string>(entry.Value, StringComparer.Ordinal),
        StringComparer.Ordinal);

    foreach (var (type, fields) in custom ?? [])
    {
      Check(type, "block type");

      if (fields is null)
      {
        throw new ArgumentException($"rich text fields: block type \"{type}\" has a null field list.");
      }

      if (!table.TryGetValue(type, out var keys))
      {
        keys = new HashSet<string>(StringComparer.Ordinal);
        table[type] = keys;
      }

      foreach (var field in fields)
      {
        keys.Add(Check(field, $"field of \"{type}\""));
      }
    }

    return new RichTextFields(table);
  }

  internal bool IsRich(string? type, string key)
  {
    return type is not null && table.TryGetValue(type, out var keys) && keys.Contains(key);
  }

  private static string Check(string? name, string what)
  {
    if (string.IsNullOrEmpty(name) || name.Contains('\0', StringComparison.Ordinal))
    {
      throw new ArgumentException($"rich text fields: a {what} name is empty or holds a NUL.");
    }

    return name;
  }
}
