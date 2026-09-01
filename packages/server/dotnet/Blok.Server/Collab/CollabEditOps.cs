using System.Text.Json;
using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>A rejected edit request; the message names the failing op index.</summary>
internal sealed class CollabEditException(
    string message,
    Exception? inner = null) : Exception(message, inner);

/// <summary>
/// One block-level operation from POST /sync/{doc}/edit. Parsed and
/// NUL-screened by <see cref="CollabEditOps.Parse"/>; validated against the
/// doc and applied by <see cref="ICollabDocConverter.ApplyOps"/>.
/// </summary>
internal abstract record CollabEditOp
{
  private CollabEditOp()
  {
  }

  /// <summary>
  /// A new block, placed after <paramref name="After"/> (null = first) among
  /// the children of <paramref name="Parent"/> (null = the root order).
  /// <paramref name="Block"/> is an OutputData block WITHOUT its hierarchy
  /// keys: the op carries the position, so <c>parent</c> and <c>content</c>
  /// inside it are refused rather than silently ignored.
  /// </summary>
  internal sealed record Insert(
      string Id,
      JsonObject Block,
      string? After,
      string? Parent) : CollabEditOp;

  /// <summary>Replaces the block's <c>data</c> map wholesale (last writer wins).</summary>
  internal sealed record Update(string Id, JsonObject Data) : CollabEditOp;

  /// <summary>Removes the block and everything parented to it.</summary>
  internal sealed record Remove(string Id) : CollabEditOp;
}

/// <summary>
/// The edit request wire: <c>{ "ops": [ … ] }</c>, at least one op, every op
/// a closed schema so a typo cannot be silently dropped.
///
/// This is also the NUL gate for the endpoint. A NUL read back through yffi
/// PANICS and ABORTS THE PROCESS (see <see cref="YDocConverter"/>), so EVERY
/// string in the request — ids, block type, data and tunes keys and values at
/// any depth — is screened here, before anything reaches the doc. The
/// converter's own NoNul stays as the second gate for the seed path.
/// </summary>
internal static class CollabEditOps
{
  /// <summary>
  /// The same reader bounds the doc endpoint uses: the framework default
  /// MaxDepth of 64 is BELOW what the converter accepts, and a duplicate
  /// property is rejected rather than resolved silently.
  /// </summary>
  private static readonly JsonDocumentOptions ReaderOptions = new()
  {
    MaxDepth = YDocConverter.JsonMaxDepth,
    AllowDuplicateProperties = false,
  };

  internal static IReadOnlyList<CollabEditOp> Parse(byte[] body)
  {
    ArgumentNullException.ThrowIfNull(body);

    JsonNode? root;

    try
    {
      root = JsonNode.Parse(body, documentOptions: ReaderOptions);
    }
    catch (JsonException error)
    {
      throw new CollabEditException(
          "collab: the request body is not valid JSON.",
          error);
    }

    if (root is not JsonObject request ||
        request["ops"] is not JsonArray requested ||
        requested.Count == 0)
    {
      throw new CollabEditException(
          "collab: the request body must be an object with a non-empty \"ops\" array.");
    }

    var ops = new List<CollabEditOp>(requested.Count);

    for (var index = 0; index < requested.Count; index++)
    {
      ops.Add(ParseOp(requested[index], index));
    }

    return ops;
  }

  private static CollabEditOp ParseOp(JsonNode? node, int index)
  {
    if (node is not JsonObject op)
    {
      throw Refused(index, "an op must be a JSON object");
    }

    GuardNoNul(op, index);

    switch (RequiredString(op, "op", index))
    {
      case "insert":
        AllowedMembers(op, index, "op", "id", "block", "after", "parent");

        return new CollabEditOp.Insert(
            RequiredString(op, "id", index),
            Block(op, index),
            OptionalString(op, "after", index),
            OptionalString(op, "parent", index));

      case "update":
        AllowedMembers(op, index, "op", "id", "data");

        return new CollabEditOp.Update(
            RequiredString(op, "id", index),
            RequiredObject(op, "data", index));

      case "remove":
        AllowedMembers(op, index, "op", "id");

        return new CollabEditOp.Remove(RequiredString(op, "id", index));

      default:
        throw Refused(index, "\"op\" must be \"insert\", \"update\" or \"remove\"");
    }
  }

  /// <summary>
  /// The block an insert carries: everything <c>YDocConverter</c> writes for
  /// a block EXCEPT its place in the tree, which the op owns.
  /// </summary>
  private static JsonObject Block(JsonObject op, int index)
  {
    var id = RequiredString(op, "id", index);
    var block = RequiredObject(op, "block", index);
    AllowedMembers(
        block,
        index,
        "id",
        "type",
        "data",
        "tunes",
        "lastEditedAt",
        "lastEditedBy");

    if (block.ContainsKey("id") && RequiredString(block, "id", index) != id)
    {
      throw Refused(index, "the block's \"id\" disagrees with the op's");
    }

    RequiredString(block, "type", index);
    RequiredObject(block, "data", index);

    if (block.ContainsKey("tunes"))
    {
      RequiredObject(block, "tunes", index);
    }

    if (block["lastEditedAt"] is { } lastEditedAt &&
        lastEditedAt.GetValueKind() != JsonValueKind.Number)
    {
      throw Refused(index, "the block's \"lastEditedAt\" must be a number");
    }

    if (block.ContainsKey("lastEditedBy"))
    {
      RequiredString(block, "lastEditedBy", index);
    }

    return block;
  }

  private static void AllowedMembers(JsonObject value, int index, params string[] allowed)
  {
    foreach (var (key, _) in value)
    {
      if (!allowed.Contains(key, StringComparer.Ordinal))
      {
        throw Refused(index, $"\"{key}\" is not part of this op");
      }
    }
  }

  private static string RequiredString(JsonObject value, string key, int index)
  {
    if (value[key] is JsonValue text &&
        text.GetValueKind() == JsonValueKind.String &&
        text.GetValue<string>() is { Length: > 0 } result)
    {
      return result;
    }

    throw Refused(index, $"\"{key}\" must be a non-empty string");
  }

  /// <summary>Absent and null both mean "not given"; anything else must be a string.</summary>
  private static string? OptionalString(JsonObject value, string key, int index)
  {
    return value[key] is null ? null : RequiredString(value, key, index);
  }

  private static JsonObject RequiredObject(JsonObject value, string key, int index)
  {
    return value[key] as JsonObject ??
        throw Refused(index, $"\"{key}\" must be a JSON object");
  }

  /// <summary>
  /// Recursive on purpose: the reader's MaxDepth already bounds the tree, so
  /// this walk cannot outrun the stack.
  /// </summary>
  private static void GuardNoNul(JsonNode? node, int index)
  {
    switch (node)
    {
      case JsonObject map:
        foreach (var (key, child) in map)
        {
          NoNul(key, index);
          GuardNoNul(child, index);
        }

        break;

      case JsonArray items:
        foreach (var item in items)
        {
          GuardNoNul(item, index);
        }

        break;

      case JsonValue value when value.GetValueKind() == JsonValueKind.String:
        NoNul(value.GetValue<string>(), index);

        break;

      default:
        break;
    }
  }

  private static void NoNul(string value, int index)
  {
    if (value.Contains('\0', StringComparison.Ordinal))
    {
      throw Refused(
          index,
          "a string contains a NUL character, which yrs truncates on write " +
          "and aborts the process on read");
    }
  }

  private static CollabEditException Refused(int index, string reason)
  {
    return new CollabEditException($"collab: op {index}: {reason}.");
  }
}
