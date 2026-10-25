using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;

namespace Blok.Server.Agent;

/// <summary>Turns the planner's primitive edits into the room's internal edit ops (06 §7.4).</summary>
internal static class RoomEditTranslator
{
  private static readonly string[] StampedKinds = ["created", "updated", "moved"];

  /// <param name="edits">The <c>Edit[]</c> Jint applied.</param>
  /// <param name="after">The document Jint returned after the edits.</param>
  /// <param name="result">The batch's <c>AgentResult</c>.</param>
  internal static IReadOnlyList<CollabEditOp> Translate(JsonArray edits, JsonObject after, JsonObject result)
  {
    var blocks = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var node in after["blocks"] as JsonArray ?? [])
    {
      if (node is JsonObject block && Text(block["id"]) is { } blockId)
      {
        blocks[blockId] = block;
      }
    }

    // Data edits collapse into one Update at the last one, carrying the final data:
    // ReplaceData deletes keys the new data lacks, so a patch alone would lose them.
    var lastDataEdit = new Dictionary<string, int>(StringComparer.Ordinal);

    for (var i = 0; i < edits.Count; i++)
    {
      if (Text(edits[i]?["op"]) is "setData" or "setRichText" && Text(edits[i]?["id"]) is { } edited)
      {
        lastDataEdit[edited] = i;
      }
    }

    var ops = new List<CollabEditOp>();

    for (var i = 0; i < edits.Count; i++)
    {
      var edit = edits[i] as JsonObject ?? throw new InvalidDataException("An agent edit is not an object.");
      var id = Text(edit["id"]);

      switch (Text(edit["op"]))
      {
        case "insert":
          InsertTree(Object(edit["block"]), Text(edit["parentId"]), Text(edit["afterId"]), blocks, ops);
          break;
        case "remove" when id is not null:
          // The JSON applier lifts the children into the slot; Remove alone takes the subtree.
          if (edit["withChildren"]?.GetValueKind() != JsonValueKind.True)
          {
            ops.Add(new CollabEditOp.Lift(id));
          }

          ops.Add(new CollabEditOp.Remove(id));
          break;
        case "move" when id is not null:
          ops.Add(new CollabEditOp.Move(id, Text(edit["afterId"]), Text(edit["parentId"])));
          break;
        case "setData" or "setRichText" when id is not null && lastDataEdit[id] == i && blocks.TryGetValue(id, out var changed):
          ops.Add(new CollabEditOp.Update(id, Object(changed["data"]).DeepClone().AsObject()));
          break;
        case "setTunes" when id is not null && blocks.TryGetValue(id, out var tuned):
          {
            // The final value of each tune the edit named; null where the batch removed it.
            var tunes = new JsonObject();

            foreach (var (name, _) in Object(edit["tunes"]))
            {
              tunes[name] = tuned["tunes"]?[name]?.DeepClone();
            }

            ops.Add(new CollabEditOp.SetTunes(id, tunes));
            break;
          }
        case "replaceType" when id is not null && blocks.TryGetValue(id, out var retyped):
          ops.Add(new CollabEditOp.Retype(
              id,
              Text(retyped["type"]) ?? throw new InvalidDataException($"Block \"{id}\" has no type."),
              Object(retyped["data"]).DeepClone().AsObject()));
          break;
        case "setPageField":
          ops.Add(new CollabEditOp.SetPageField(
              Text(edit["key"]) ?? throw new InvalidDataException("A page field edit has no key."),
              edit["value"]?.DeepClone()));
          break;
      }
    }

    // Every block the JSON applier stamped: created, updated, moved and lifted.
    var changedSet = result["changed"];
    var stamped = StampedKinds
        .SelectMany(kind => changedSet?[kind] as JsonArray ?? [])
        .Select(Text)
        .OfType<string>()
        .Distinct(StringComparer.Ordinal);

    foreach (var stampedId in stamped)
    {
      if (blocks.TryGetValue(stampedId, out var block) &&
          Text(block["lastEditedBy"]) is { } by &&
          block["lastEditedAt"] is JsonValue at && at.GetValueKind() == JsonValueKind.Number)
      {
        ops.Add(new CollabEditOp.SetMetadata(stampedId, at.GetValue<double>(), by, Text(block["lastEditedWith"])));
      }
    }

    return ops;
  }

  private static void InsertTree(
      JsonObject planned,
      string? parentId,
      string? afterId,
      Dictionary<string, JsonObject> blocks,
      List<CollabEditOp> ops)
  {
    var id = Text(planned["id"]) ?? throw new InvalidDataException("A planned block has no id.");
    var block = new JsonObject { ["type"] = planned["type"]?.DeepClone(), ["data"] = Object(planned["data"]).DeepClone() };

    if (planned["tunes"] is JsonObject tunes)
    {
      block["tunes"] = tunes.DeepClone();
    }

    // The creation stamp the JSON applier wrote, so the room saves the same metadata.
    if (blocks.TryGetValue(id, out var drafted))
    {
      if (drafted["createdAt"] is JsonValue createdAt && createdAt.GetValueKind() == JsonValueKind.Number)
      {
        block["createdAt"] = createdAt.DeepClone();
      }

      if (Text(drafted["createdBy"]) is { } createdBy)
      {
        block["createdBy"] = createdBy;

        if (Text(drafted["createdWith"]) is { } createdWith)
        {
          block["createdWith"] = createdWith;
        }
      }
    }

    ops.Add(new CollabEditOp.Insert(id, block, afterId, parentId));

    string? previous = null;

    foreach (var child in planned["children"] as JsonArray ?? [])
    {
      var childBlock = Object(child);

      InsertTree(childBlock, id, previous, blocks, ops);
      previous = Text(childBlock["id"]);
    }
  }

  private static string? Text(JsonNode? node) =>
      node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;

  private static JsonObject Object(JsonNode? node) =>
      node as JsonObject ?? throw new InvalidDataException("An agent edit field is not an object.");
}
