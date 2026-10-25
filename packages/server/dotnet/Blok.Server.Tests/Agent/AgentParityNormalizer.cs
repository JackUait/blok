using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// C# twin of test/unit/agent/parity/normalize.ts. Pinned by
/// test/fixtures/agent-commands/normalizer-cases.json: change both together.
/// </summary>
internal static class AgentParityNormalizer
{
  /// <summary>Tool fields the editor fills on load and headless appliers do not (normalize.ts TOOL_MINTED).</summary>
  private static readonly Dictionary<string, Dictionary<string, JsonNode?>> LoadDefaults = new(StringComparer.Ordinal)
  {
    ["quote"] = new(StringComparer.Ordinal) { ["size"] = JsonValue.Create("default") },
    ["callout"] = new(StringComparer.Ordinal) { ["textColor"] = null, ["backgroundColor"] = null },
  };

  private static readonly JsonNode EmptyAutomations = JsonNode.Parse("""{"version":1,"definitions":[]}""")!;

  internal static JsonObject Normalize(JsonObject document, ISet<string> keepIds)
  {
    var blocks = CanonicalDatabases(document["blocks"]!.AsArray().Select(b => b!.DeepClone().AsObject()).ToList());
    var byId = new Dictionary<string, int>(StringComparer.Ordinal);

    for (var i = 0; i < blocks.Count; i++)
    {
      if (IdOf(blocks[i]) is { } id)
      {
        byId[id] = i;
      }
    }

    var ordered = new List<(JsonObject Block, string Label)>();
    var visited = new HashSet<int>();

    void Walk(int index, string label)
    {
      if (!visited.Add(index))
      {
        return;
      }

      var block = blocks[index];
      ordered.Add((block, label));

      var listed = (block["content"] as JsonArray ?? [])
          .Select(id => id is JsonValue v && v.TryGetValue<string>(out var text) && byId.TryGetValue(text, out var child) ? child : -1)
          .Where(child => child >= 0)
          .ToList();
      var own = IdOf(block);
      var children = listed.Count > 0
          ? listed
          : Enumerable.Range(0, blocks.Count).Where(i => own is not null && ParentOf(blocks[i]) == own).ToList();

      for (var i = 0; i < children.Count; i++)
      {
        Walk(children[i], $"{label}.{i}");
      }
    }

    var roots = Enumerable.Range(0, blocks.Count).Where(i => blocks[i]["parent"] is null).ToList();

    for (var i = 0; i < roots.Count; i++)
    {
      Walk(roots[i], $"b{i}");
    }

    var nextRoot = roots.Count;

    // Orphans (a missing parent) still count, after the rooted tree.
    for (var i = 0; i < blocks.Count; i++)
    {
      if (!visited.Contains(i))
      {
        Walk(i, $"b{nextRoot}");
        nextRoot++;
      }
    }

    var names = new Dictionary<string, string>(StringComparer.Ordinal);

    foreach (var (block, label) in ordered)
    {
      if (IdOf(block) is { } id && !keepIds.Contains(id))
      {
        names[id] = label;
      }
    }

    var output = new JsonArray();

    foreach (var (block, _) in ordered)
    {
      output.Add(Clean(block, names));
    }

    var result = new JsonObject { ["blocks"] = output };

    // Flat page fields, as OutputData saves them (01 D-1).
    foreach (var key in new[] { "title", "icon" })
    {
      if (document.TryGetPropertyValue(key, out var value) && value is not null)
      {
        result[key] = value.DeepClone();
      }
    }

    return result;
  }

  internal static string Stable(JsonNode? node)
  {
    return node switch
    {
      JsonObject obj => "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal)
          .Select(p => $"{JsonSerializer.Serialize(p.Key)}:{Stable(p.Value)}")) + "}",
      JsonArray array => "[" + string.Join(",", array.Select(Stable)) + "]",
      null => "null",
      _ => node.ToJsonString(),
    };
  }

  /// <summary>
  /// Twin of normalize.ts canonicalDatabases (05 §3.2.1, 06 C17): database ids
  /// become <c>dbid&lt;n&gt;</c> in first-appearance order (each property, then its
  /// options, then views); positions become their code-unit rank among siblings.
  /// </summary>
  private static List<JsonObject> CanonicalDatabases(List<JsonObject> blocks)
  {
    var labels = new Dictionary<string, string>(StringComparer.Ordinal);
    var ranks = new Dictionary<JsonObject, string>(ReferenceEqualityComparer.Instance);

    void Label(JsonNode? id)
    {
      if (id is JsonValue v && v.TryGetValue<string>(out var text) && !labels.ContainsKey(text))
      {
        labels[text] = $"dbid{labels.Count + 1}";
      }
    }

    static List<JsonObject> Records(JsonNode? node) => (node as JsonArray)?.OfType<JsonObject>().ToList() ?? [];

    void Rank(List<JsonObject> siblings)
    {
      var keys = siblings
          .Select(s => s["position"] is JsonValue v && v.TryGetValue<string>(out var p) ? p : null)
          .OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();

      foreach (var sibling in siblings)
      {
        if (sibling["position"] is JsonValue v && v.TryGetValue<string>(out var p))
        {
          ranks[sibling] = $"pos:{keys.IndexOf(p)}";
        }
      }
    }

    foreach (var data in blocks.Where(b => TypeOf(b) == "database").Select(b => b["data"] as JsonObject).OfType<JsonObject>())
    {
      var schema = Records(data["schema"]);

      foreach (var property in schema)
      {
        Label(property["id"]);
        Records(property["config"]?["options"]).ForEach(option => Label(option["id"]));
      }

      Records(data["views"]).ForEach(view => Label(view["id"]));
      Rank(schema);
      Rank(Records(data["views"]));
      schema.ForEach(property => Rank(Records(property["config"]?["options"])));
    }

    var rows = blocks.Where(b => TypeOf(b) == "database-row").ToList();

    // Templates are their own ordered list beside the rows.
    foreach (var group in rows.GroupBy(r => (ParentOf(r) ?? string.Empty, r["data"]?["template"] is JsonValue t && t.TryGetValue<bool>(out var isTemplate) && isTemplate)))
    {
      Rank(group.Select(r => r["data"] as JsonObject).OfType<JsonObject>().ToList());
    }

    return blocks.Select(block =>
    {
      if ((TypeOf(block) is "database" or "database-row") && block["data"] is JsonObject data)
      {
        var relabelled = Relabel(data, labels, ranks)!.AsObject();

        // The editor saves an empty automations slot on every database (src/tools/database/index.ts:888).
        if (TypeOf(block) == "database" && JsonNode.DeepEquals(relabelled["automations"], EmptyAutomations))
        {
          relabelled.Remove("automations");
        }

        block["data"] = relabelled;
      }

      return block;
    }).ToList();
  }

  private static string? TypeOf(JsonObject block) =>
      block["type"] is JsonValue v && v.TryGetValue<string>(out var type) ? type : null;

  private static JsonNode? Relabel(JsonNode? node, Dictionary<string, string> labels, Dictionary<JsonObject, string> ranks)
  {
    switch (node)
    {
      case JsonValue value when value.TryGetValue<string>(out var text):
        if (labels.TryGetValue(text, out var label))
        {
          return JsonValue.Create(label);
        }

        return text.EndsWith("-filters", StringComparison.Ordinal) && labels.TryGetValue(text[..^"-filters".Length], out var view)
            ? JsonValue.Create($"{view}-filters")
            : value.DeepClone();
      case JsonArray array:
        return new JsonArray(array.Select(item => Relabel(item, labels, ranks)).ToArray());
      case JsonObject obj:
        var copy = new JsonObject();
        var rank = ranks.GetValueOrDefault(obj);

        foreach (var (key, value) in obj)
        {
          copy[labels.GetValueOrDefault(key, key)] = key == "position" && rank is not null
              ? JsonValue.Create(rank)
              : Relabel(value, labels, ranks);
        }

        return copy;
      default:
        return node?.DeepClone();
    }
  }

  private static string? IdOf(JsonObject block) =>
      block["id"] is JsonValue v && v.TryGetValue<string>(out var id) ? id : null;

  private static string? ParentOf(JsonObject block) =>
      block["parent"] is JsonValue v && v.TryGetValue<string>(out var id) ? id : null;

  private static JsonObject Clean(JsonObject block, Dictionary<string, string> names)
  {
    var copy = block.DeepClone().AsObject();
    var type = copy["type"]?.GetValue<string>();
    string Rename(string id) => names.GetValueOrDefault(id, id);

    // Clocks differ per runner: compare that a stamp is there, not its value. Same as normalize.ts.
    foreach (var stamp in (string[])["lastEditedAt", "createdAt"])
    {
      if (copy.ContainsKey(stamp))
      {
        copy[stamp] = 0;
      }
    }

    // Only structural references are renamed; payload strings stay as written.
    if (IdOf(copy) is { } own)
    {
      copy["id"] = Rename(own);
    }

    if (ParentOf(copy) is { } parent)
    {
      copy["parent"] = Rename(parent);
    }

    if (copy["content"] is JsonArray content)
    {
      copy["content"] = new JsonArray(content
          .Select(id => id is JsonValue v && v.TryGetValue<string>(out var text) ? JsonValue.Create(Rename(text)) : id?.DeepClone())
          .ToArray());
    }

    if (copy["data"] is JsonObject data)
    {
      copy["data"] = CleanData(type, data, Rename);
    }

    return copy;
  }

  private static JsonObject CleanData(string? type, JsonObject data, Func<string, string> rename)
  {
    if (type is not null && LoadDefaults.TryGetValue(type, out var defaults))
    {
      foreach (var (key, value) in defaults)
      {
        if (data.TryGetPropertyValue(key, out var actual) && JsonNode.DeepEquals(actual, value))
        {
          data.Remove(key);
        }
      }
    }

    if (type == "table" && data["content"] is JsonArray rows)
    {
      foreach (var cell in rows.OfType<JsonArray>().SelectMany(r => r).OfType<JsonObject>())
      {
        // Random until the table ships ToolRuntime.normalize (06 C17).
        cell.Remove("id");
        cell.Remove("rowId");

        if (cell["blocks"] is JsonArray cellBlocks)
        {
          cell["blocks"] = new JsonArray(cellBlocks
              .Select(id => id is JsonValue v && v.TryGetValue<string>(out var text) ? JsonValue.Create(rename(text)) : id?.DeepClone())
              .ToArray());
        }
      }
    }

    foreach (var key in data.Select(p => p.Key).ToList())
    {
      if (RichTextFields.BuiltIn.IsRich(type, key) && data[key] is JsonArray array)
      {
        data[key] = Canonical(array);
      }
    }

    return data;
  }

  /// <summary>
  /// Canonical segments for a rich field. HTML strings stay: the C# runners emit
  /// segments, and HTML parsing is the TS canonicalizer's job (06 C16).
  /// </summary>
  private static JsonNode Canonical(JsonArray array)
  {
    return JsJson.Parse(array.ToJsonString()) is AnyArray segments && RichText.IsRichText(segments)
        ? RichText.ToJson(RichText.Canonicalize(segments))
        : array.DeepClone();
  }
}
