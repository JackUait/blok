using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>
/// What a changed database or database row changed inside its data: the
/// row's property values, the database's schema entries and views. Keys and
/// ids only, in document order; values compare as the changes diff does.
/// Go and Rust read the same fixture (collab-history/property-changes.json).
/// </summary>
internal static class CollabDatabaseChanges
{
  /// <summary>
  /// The extra row fields for one changed block: <c>properties</c> for a
  /// database row, <c>schema</c> and <c>views</c> for a database. Each is
  /// left out when empty, so other blocks get an empty object.
  /// </summary>
  public static JsonObject Describe(string? type, JsonObject? before, JsonObject? after)
  {
    var fields = new JsonObject();

    if (before is null || after is null)
    {
      return fields;
    }

    if (type == "database-row")
    {
      var properties = Properties(Data(before)?["properties"] as JsonObject, Data(after)?["properties"] as JsonObject);

      if (properties.Count > 0)
      {
        fields["properties"] = properties;
      }
    }
    else if (type == "database")
    {
      var schema = Entries(Data(before)?["schema"] as JsonArray, Data(after)?["schema"] as JsonArray, withName: true);
      var views = Entries(Data(before)?["views"] as JsonArray, Data(after)?["views"] as JsonArray, withName: false);

      if (schema.Count > 0)
      {
        fields["schema"] = schema;
      }

      if (views.Count > 0)
      {
        fields["views"] = views;
      }
    }

    return fields;
  }

  private static JsonObject? Data(JsonObject block) => block["data"] as JsonObject;

  /// <summary>After's keys in order, then the keys only before had.</summary>
  private static JsonArray Properties(JsonObject? before, JsonObject? after)
  {
    var changes = new JsonArray();
    var keys = new List<string>();

    keys.AddRange((after ?? []).Select(member => member.Key));
    keys.AddRange((before ?? []).Select(member => member.Key).Where(key => after is null || !after.ContainsKey(key)));

    foreach (var key in keys)
    {
      var had = before is not null && before.TryGetPropertyValue(key, out _);
      var has = after is not null && after.TryGetPropertyValue(key, out _);

      if (had && has && JsonNode.DeepEquals(before![key], after![key]))
      {
        continue;
      }

      var entry = new JsonObject { ["id"] = key };

      if (had)
      {
        entry["before"] = before![key]?.DeepClone();
      }

      if (has)
      {
        entry["after"] = after![key]?.DeepClone();
      }

      changes.Add(entry);
    }

    return changes;
  }

  /// <summary>Entries keyed by a string id, the first of a repeated id kept; after's order, then the deleted ones.</summary>
  private static JsonArray Entries(JsonArray? before, JsonArray? after, bool withName)
  {
    var old = ById(before);
    var now = ById(after);
    var changes = new JsonArray();

    void Add(string id, JsonObject named, string action)
    {
      var entry = new JsonObject { ["id"] = id };

      if (withName && named["name"] is JsonValue name && name.TryGetValue<string>(out var text))
      {
        entry["name"] = text;
      }

      entry["action"] = action;
      changes.Add(entry);
    }

    foreach (var (id, entry) in now)
    {
      var previous = old.Find(item => item.Id == id).Entry;

      if (previous is null)
      {
        Add(id, entry, "created");
      }
      else if (!JsonNode.DeepEquals(previous, entry))
      {
        Add(id, entry, "updated");
      }
    }

    foreach (var (id, entry) in old)
    {
      if (!now.Exists(item => item.Id == id))
      {
        Add(id, entry, "deleted");
      }
    }

    return changes;
  }

  private static List<(string Id, JsonObject Entry)> ById(JsonArray? entries)
  {
    var list = new List<(string Id, JsonObject Entry)>();

    foreach (var item in entries ?? [])
    {
      if (item is JsonObject entry &&
          entry["id"] is JsonValue value &&
          value.TryGetValue<string>(out var id) &&
          !list.Exists(seen => seen.Id == id))
      {
        list.Add((id, entry));
      }
    }

    return list;
  }
}
