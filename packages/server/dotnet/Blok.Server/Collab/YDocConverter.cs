using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using YDotNet.Document;
using YDotNet.Document.Cells;
using YDotNet.Document.Transactions;
using JsonArray = System.Text.Json.Nodes.JsonArray;
using JsonObject = System.Text.Json.Nodes.JsonObject;
using YArray = YDotNet.Document.Types.Arrays.Array;
using YMap = YDotNet.Document.Types.Maps.Map;

namespace Blok.Server.Collab;

/// <summary>
/// Blok doc schema v2 ⇄ OutputData block arrays, mirroring the client
/// law-for-law: <c>YBlockSerializer</c> (value rules) and
/// <c>DocumentStore.fromJSON/toJSON</c> (hierarchy laws) in
/// src/components/modules/yjs/.
///
/// LOCKSTEP MECHANISM. This file is never the source of truth for the
/// format — the client is. The contract between the two is the fixture set
/// under test/unit/server-conformance/fixtures/collab/, generated ONLY by
/// scripts/generate-collab-fixtures.mjs from the real client code. The JS
/// suite pins the client against those fixtures; YDocConverterConformanceTests
/// pins this converter against the same files in three directions (seed from
/// input.json, read the client's update.b64, round-trip through StateDiffV1).
/// A unilateral change on either side goes red in that side's CI. When the
/// client format changes on purpose: regenerate the fixtures, then bring the
/// mirrored law here up to date in the same change.
///
/// Numbers are written as doubles only: yrs encodes an integral double as a
/// lib0 varint, which the JS client reads as a number, while a long becomes a
/// lib0 BigInt that JS reads as a BigInt and cannot JSON.stringify.
/// </summary>
internal static class YDocConverter
{
  private const string BlocksRoot = "blocks";
  private const string OrderRoot = "root";
  private const string GridRowsKey = "__rows";
  private const string GridOrderKey = "__rowKeys";
  private const int RowKeyLength = 10;
  private const double MaxSafeInteger = 9007199254740992d;

  // nanoid's default alphabet; keys are random so two peers never collide.
  private const string RowKeyAlphabet =
      "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

  /// <summary>
  /// Replaces the doc's blocks with <paramref name="blocks"/> the way
  /// <c>DocumentStore.fromJSON</c> does: every block with a string id gets a
  /// map entry, and every block WITHOUT a <c>parent</c> key goes into the
  /// root order, in input order.
  /// </summary>
  internal static void Seed(Doc doc, JsonArray blocks)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(blocks);

    var blockMap = doc.Map(BlocksRoot);
    var rootOrder = doc.Array(OrderRoot);
    var writer = new InputWriter();

    try
    {
      using var transaction = doc.WriteTransaction();
      var length = rootOrder.Length(transaction);

      if (length > 0)
      {
        rootOrder.RemoveRange(transaction, 0, length);
      }

      blockMap.RemoveAll(transaction);

      var topLevelIds = new List<Input>();

      foreach (var node in blocks)
      {
        // fromJSON reads `block.id` off every entry: null throws there,
        // a primitive yields undefined and is skipped.
        if (node is null)
        {
          throw new InvalidDataException("collab: a block entry is null.");
        }

        if (node is not JsonObject block || !TryGetString(block, "id", out var id))
        {
          continue;
        }

        blockMap.Insert(transaction, id, writer.Block(id, block));

        if (!block.ContainsKey("parent"))
        {
          topLevelIds.Add(writer.Track(Input.String(id)));
        }
      }

      if (topLevelIds.Count > 0)
      {
        rootOrder.InsertRange(transaction, 0, topLevelIds.ToArray());
      }
    }
    finally
    {
      // Composite inputs copy their children's native structs, not the
      // children's memory, so every input lives until the commit.
      writer.Dispose();
    }
  }

  /// <summary>
  /// Serializes the doc in derived flat order the way
  /// <c>DocumentStore.toJSON</c> does. The hierarchy view is computed once
  /// and used for both the order and the emitted parent/content, so a
  /// position never contradicts a parent link.
  /// </summary>
  internal static JsonArray Export(Doc doc)
  {
    ArgumentNullException.ThrowIfNull(doc);

    var blockMap = doc.Map(BlocksRoot);
    var rootOrder = doc.Array(OrderRoot);
    using var transaction = doc.ReadTransaction();
    var reader = new DocReader(transaction, blockMap, rootOrder);

    return reader.Export();
  }

  private static bool TryGetString(JsonObject block, string key, out string value)
  {
    if (block.TryGetPropertyValue(key, out var node) &&
        node is JsonValue jsonValue &&
        jsonValue.GetValueKind() == JsonValueKind.String)
    {
      value = jsonValue.GetValue<string>();

      return true;
    }

    value = "";

    return false;
  }

  private static JsonValue? NumberNode(double value)
  {
    if (!double.IsFinite(value))
    {
      // JSON.stringify writes NaN and ±Infinity as null.
      return null;
    }

    return double.IsInteger(value) && Math.Abs(value) <= MaxSafeInteger
      ? JsonValue.Create((long)value)
      : JsonValue.Create(value);
  }

  /// <summary>
  /// JSON → Yjs inputs, mirroring <c>YBlockSerializer.outputDataToYBlock</c>
  /// and <c>plainToYValue</c>. Tracks every input it creates for disposal.
  /// </summary>
  private sealed class InputWriter : IDisposable
  {
    private readonly List<Input> inputs = [];

    public void Dispose()
    {
      foreach (var input in inputs)
      {
        input.Dispose();
      }

      inputs.Clear();
    }

    internal Input Track(Input input)
    {
      inputs.Add(input);

      return input;
    }

    internal Input Block(string id, JsonObject block)
    {
      var entries = new Dictionary<string, Input>(StringComparer.Ordinal)
      {
        ["id"] = Track(Input.String(id)),
        ["type"] = Atomic(block["type"]),
      };

      if (block["data"] is not JsonObject data)
      {
        throw new InvalidDataException($"collab: block \"{id}\" has no data object.");
      }

      entries["data"] = ObjectToYMap(NormalizeBlockData(block["type"], data));

      if (block.TryGetPropertyValue("tunes", out var tunes))
      {
        if (tunes is not JsonObject tunesObject)
        {
          throw new InvalidDataException($"collab: block \"{id}\" has non-object tunes.");
        }

        entries["tunes"] = ObjectToYMap(tunesObject);
      }

      if (block.TryGetPropertyValue("parent", out var parent))
      {
        entries["parentId"] = Atomic(parent);
      }

      // EAGER, always — even with no children — so one peer is the single
      // creator of the array and concurrent first children merge as inserts.
      entries["contentIds"] = ContentIds(id, block["content"]);

      if (block.TryGetPropertyValue("lastEditedAt", out var lastEditedAt))
      {
        entries["lastEditedAt"] = Atomic(lastEditedAt);
      }

      if (block.TryGetPropertyValue("lastEditedBy", out var lastEditedBy))
      {
        entries["lastEditedBy"] = Atomic(lastEditedBy);
      }

      return Track(Input.Map(entries));
    }

    private Input ContentIds(string id, JsonNode? content)
    {
      if (content is null)
      {
        return Track(Input.Array([]));
      }

      if (content is not JsonArray items)
      {
        throw new InvalidDataException($"collab: block \"{id}\" has non-array content.");
      }

      return Track(Input.Array(items.Select(Atomic).ToArray()));
    }

    /// <summary>
    /// Empty paragraph data becomes { text: "" }; nothing else changes.
    /// </summary>
    private static JsonObject NormalizeBlockData(JsonNode? type, JsonObject data)
    {
      var isParagraph = type is JsonValue value &&
          value.GetValueKind() == JsonValueKind.String &&
          value.GetValue<string>() == "paragraph";

      if (isParagraph && data.Count == 0)
      {
        return new JsonObject { ["text"] = "" };
      }

      return data;
    }

    private Input ObjectToYMap(JsonObject value)
    {
      var entries = new Dictionary<string, Input>(StringComparer.Ordinal);

      foreach (var (key, child) in value)
      {
        entries[key] = PlainToYValue(child);
      }

      return Track(Input.Map(entries));
    }

    /// <summary>
    /// The grid rule, then the array rule, then nested maps; primitives and
    /// non-convertible arrays stay atomic leaves.
    /// </summary>
    private Input PlainToYValue(JsonNode? value)
    {
      if (value is JsonArray array && IsConvertibleArray(array))
      {
        return array.All(element => element is JsonArray)
          ? PlainToGridMap(array)
          : Track(Input.Array(array.Select(PlainToYValue).ToArray()));
      }

      if (value is JsonObject map)
      {
        return ObjectToYMap(map);
      }

      return Atomic(value);
    }

    private Input PlainToGridMap(JsonArray rows)
    {
      var rowMap = new Dictionary<string, Input>(StringComparer.Ordinal);
      var order = new List<Input>();

      foreach (var row in rows)
      {
        var key = GenerateRowKey();

        rowMap[key] = PlainToYValue(row);
        order.Add(Track(Input.String(key)));
      }

      return Track(Input.Map(new Dictionary<string, Input>(StringComparer.Ordinal)
      {
        [GridRowsKey] = Track(Input.Map(rowMap)),
        [GridOrderKey] = Track(Input.Array(order.ToArray())),
      }));
    }

    /// <summary>
    /// A plain (non-shared) value: what a bare <c>ymap.set(key, value)</c>
    /// stores. Nested objects and arrays stay plain all the way down.
    /// </summary>
    private Input Atomic(JsonNode? value)
    {
      switch (value)
      {
        case null:
          return Track(Input.Null());

        case JsonObject map:
          var entries = new Dictionary<string, Input>(StringComparer.Ordinal);

          foreach (var (key, child) in map)
          {
            entries[key] = Atomic(child);
          }

          return Track(Input.Object(entries));

        case JsonArray items:
          return Track(Input.Collection(items.Select(Atomic).ToArray()));

        case JsonValue scalar:
          return Track(Scalar(scalar));

        default:
          throw new InvalidDataException("collab: unsupported JSON node.");
      }
    }

    private static Input Scalar(JsonValue value)
    {
      switch (value.GetValueKind())
      {
        case JsonValueKind.String:
          return Input.String(value.GetValue<string>());

        case JsonValueKind.True:
          return Input.Boolean(true);

        case JsonValueKind.False:
          return Input.Boolean(false);

        case JsonValueKind.Number:
          return Input.Double(ToDouble(value));

        default:
          return Input.Null();
      }
    }

    private static double ToDouble(JsonValue value)
    {
      if (value.TryGetValue<JsonElement>(out var element))
      {
        return element.GetDouble();
      }

      if (value.TryGetValue<double>(out var asDouble))
      {
        return asDouble;
      }

      if (value.TryGetValue<long>(out var asLong))
      {
        return asLong;
      }

      if (value.TryGetValue<int>(out var asInt))
      {
        return asInt;
      }

      return (double)value.GetValue<decimal>();
    }

    private static bool IsConvertibleArray(JsonArray array)
    {
      return array.Count > 0 &&
          array.All(element => element is JsonObject or JsonArray);
    }

    private static string GenerateRowKey()
    {
      return new string(RandomNumberGenerator.GetItems<char>(RowKeyAlphabet, RowKeyLength));
    }
  }

  /// <summary>
  /// One block's map entry as read inside the export transaction.
  /// </summary>
  private sealed record BlockEntry(
      YMap Map,
      string? RawParentId,
      IReadOnlyList<Output>? ContentIds);

  /// <summary>
  /// Doc → JSON, mirroring <c>DocumentStore.toJSON</c> and
  /// <c>YBlockSerializer.yBlockToOutputData/yValueToPlain</c>. All reads
  /// happen inside the one read transaction that created it.
  /// </summary>
  private sealed class DocReader
  {
    private readonly Transaction transaction;
    private readonly YArray rootOrder;

    /// <summary>Every key of the blocks map, map-valued or not.</summary>
    private readonly HashSet<string> allIds = new(StringComparer.Ordinal);

    /// <summary>Map-valued entries only; the others are never emitted.</summary>
    private readonly Dictionary<string, BlockEntry> entries = new(StringComparer.Ordinal);

    internal DocReader(Transaction transaction, YMap blockMap, YArray rootOrder)
    {
      this.transaction = transaction;
      this.rootOrder = rootOrder;

      using var iterator = blockMap.Iterate(transaction);

      foreach (var (id, value) in iterator)
      {
        allIds.Add(id);

        if (value.Tag == OutputTag.Map)
        {
          entries[id] = ReadEntry(id, value.Map);
        }
      }
    }

    internal JsonArray Export()
    {
      var hierarchy = HierarchyView();
      var exported = new JsonArray();

      foreach (var id in DeriveOrderedIds(hierarchy))
      {
        exported.Add(ProjectHierarchy(id, YBlockToOutputData(entries[id]), hierarchy));
      }

      return exported;
    }

    private BlockEntry ReadEntry(string id, YMap map)
    {
      var parentId = map.Get(transaction, "parentId");
      // A self-parent is never a real link.
      var rawParentId = parentId?.Tag == OutputTag.String && parentId.String != id
        ? parentId.String
        : null;
      var contentIds = map.Get(transaction, "contentIds");

      return new BlockEntry(
          map,
          rawParentId,
          contentIds?.Tag == OutputTag.Array ? ReadArray(contentIds.Array) : null);
    }

    private List<Output> ReadArray(YArray array)
    {
      using var iterator = array.Iterate(transaction);

      return iterator.ToList();
    }

    /// <summary>
    /// Effective parent of every id: its parentId, except where a cycle
    /// broke the link (null). Non-map entries and dangling parents keep
    /// their value as-is — dangling is the orphan tolerance a not-yet-
    /// arrived peer depends on.
    /// </summary>
    private Dictionary<string, string?> HierarchyView()
    {
      var broken = BrokenCycleMembers();
      var hierarchy = new Dictionary<string, string?>(StringComparer.Ordinal);

      foreach (var id in allIds)
      {
        hierarchy[id] = broken.Contains(id) ? null : RawParentId(id);
      }

      return hierarchy;
    }

    private string? RawParentId(string id)
    {
      return entries.TryGetValue(id, out var entry) ? entry.RawParentId : null;
    }

    private HashSet<string> BrokenCycleMembers()
    {
      var broken = new HashSet<string>(StringComparer.Ordinal);
      var state = new Dictionary<string, bool>(StringComparer.Ordinal);

      foreach (var id in allIds)
      {
        MarkParentChain(id, [], state, broken);
      }

      return broken;
    }

    /// <summary>
    /// Colour one parentId chain: true = on the current path, false = done.
    /// Meeting a node that is on the path closes a loop; the path from that
    /// node onward IS the cycle, whichever member the walk entered at.
    /// </summary>
    private void MarkParentChain(
        string id,
        List<string> path,
        Dictionary<string, bool> state,
        HashSet<string> broken)
    {
      if (state.TryGetValue(id, out var visiting))
      {
        if (visiting)
        {
          BreakCycle(path.Skip(path.IndexOf(id)), broken);
        }

        return;
      }

      if (!allIds.Contains(id))
      {
        return;
      }

      state[id] = true;
      path.Add(id);

      var parentId = RawParentId(id);

      if (parentId is not null)
      {
        MarkParentChain(parentId, path, state, broken);
      }

      path.RemoveAt(path.Count - 1);
      state[id] = false;
    }

    /// <summary>
    /// The lexicographically smallest member (UTF-16 code units, like the
    /// JS `&lt;`) keeps its parent; every other member's link is broken.
    /// </summary>
    private static void BreakCycle(IEnumerable<string> members, HashSet<string> broken)
    {
      var cycle = members.ToList();
      var keeper = cycle.Aggregate(
          (smallest, id) => string.CompareOrdinal(id, smallest) < 0 ? id : smallest);

      foreach (var member in cycle)
      {
        if (member != keeper)
        {
          broken.Add(member);
        }
      }
    }

    /// <summary>
    /// DFS from the root order, then the orphan tail in two sorted passes:
    /// tops of unreached subtrees (no parent, or a parent with no entry)
    /// first, then anything still unreached. Each pass takes a fresh sorted
    /// snapshot; the first pass is what makes the order round-trip.
    /// </summary>
    private List<string> DeriveOrderedIds(Dictionary<string, string?> hierarchy)
    {
      var ordered = new List<string>();
      var seen = new HashSet<string>(StringComparer.Ordinal);

      foreach (var entry in ReadArray(rootOrder))
      {
        VisitBlock(entry, null, hierarchy, seen, ordered);
      }

      foreach (var id in Unreached(seen))
      {
        var parentId = hierarchy[id];

        if (parentId is null || !allIds.Contains(parentId))
        {
          VisitBlock(id, parentId, hierarchy, seen, ordered);
        }
      }

      foreach (var id in Unreached(seen))
      {
        VisitBlock(id, hierarchy[id], hierarchy, seen, ordered);
      }

      return ordered;
    }

    private List<string> Unreached(HashSet<string> seen)
    {
      return allIds
          .Where(id => !seen.Contains(id))
          .Order(StringComparer.Ordinal)
          .ToList();
    }

    private void VisitBlock(
        Output entry,
        string? expectedParentId,
        Dictionary<string, string?> hierarchy,
        HashSet<string> seen,
        List<string> ordered)
    {
      if (entry.Tag == OutputTag.String)
      {
        VisitBlock(entry.String, expectedParentId, hierarchy, seen, ordered);
      }
    }

    /// <summary>
    /// Emit the id once, only when a map entry exists and its effective
    /// parent is the one whose order array is being walked — a disagreeing
    /// occurrence is skipped WITHOUT being marked seen, so a later agreeing
    /// slot can still claim it.
    /// </summary>
    private void VisitBlock(
        string id,
        string? expectedParentId,
        Dictionary<string, string?> hierarchy,
        HashSet<string> seen,
        List<string> ordered)
    {
      if (seen.Contains(id) || !entries.TryGetValue(id, out var entry))
      {
        return;
      }

      if (!string.Equals(hierarchy[id], expectedParentId, StringComparison.Ordinal))
      {
        return;
      }

      seen.Add(id);
      ordered.Add(id);

      foreach (var childId in entry.ContentIds ?? [])
      {
        VisitBlock(childId, id, hierarchy, seen, ordered);
      }
    }

    private JsonObject YBlockToOutputData(BlockEntry entry)
    {
      var id = entry.Map.Get(transaction, "id");
      var type = entry.Map.Get(transaction, "type");
      var data = entry.Map.Get(transaction, "data");

      if (id?.Tag != OutputTag.String)
      {
        throw new InvalidDataException("collab: block id must be a string.");
      }

      if (type?.Tag != OutputTag.String)
      {
        throw new InvalidDataException("collab: block type must be a string.");
      }

      if (data?.Tag != OutputTag.Map)
      {
        throw new InvalidDataException("collab: block data must be a Y.Map.");
      }

      var block = new JsonObject
      {
        ["id"] = id.String,
        ["type"] = type.String,
        ["data"] = YMapToObject(data.Map),
      };

      var tunes = entry.Map.Get(transaction, "tunes");

      if (tunes?.Tag == OutputTag.Map && tunes.Map.Length(transaction) > 0)
      {
        block["tunes"] = YMapToObject(tunes.Map);
      }

      // Any string parentId, self-parent included — the projection re-decides
      // against the hierarchy view, exactly like the client serializer.
      var parentId = entry.Map.Get(transaction, "parentId");

      if (parentId?.Tag == OutputTag.String)
      {
        block["parent"] = parentId.String;
      }

      if (entry.ContentIds is { Count: > 0 })
      {
        block["content"] = new JsonArray(entry.ContentIds.Select(ToPlainOrNull).ToArray());
      }

      var lastEditedAt = entry.Map.Get(transaction, "lastEditedAt");

      if (lastEditedAt?.Tag is OutputTag.Double or OutputTag.Long)
      {
        block["lastEditedAt"] = ToPlainOrNull(lastEditedAt);
      }

      var lastEditedBy = entry.Map.Get(transaction, "lastEditedBy");

      if (lastEditedBy?.Tag == OutputTag.String)
      {
        block["lastEditedBy"] = lastEditedBy.String;
      }

      return block;
    }

    /// <summary>
    /// Report the effective parent and keep only the children that name
    /// THIS block as their parent. Ids with no map entry (and non-string
    /// entries) stay; nothing is deduplicated.
    /// </summary>
    private static JsonObject ProjectHierarchy(
        string id,
        JsonObject block,
        Dictionary<string, string?> hierarchy)
    {
      var parentId = hierarchy[id];

      if (parentId is null)
      {
        block.Remove("parent");
      }
      else
      {
        block["parent"] = parentId;
      }

      var owned = (block["content"] as JsonArray ?? [])
          .Where(child =>
              child is not JsonValue value ||
              value.GetValueKind() != JsonValueKind.String ||
              !hierarchy.TryGetValue(value.GetValue<string>(), out var childParent) ||
              string.Equals(childParent, id, StringComparison.Ordinal))
          .Select(child => child?.DeepClone())
          .ToArray();

      if (owned.Length > 0)
      {
        block["content"] = new JsonArray(owned);
      }
      else
      {
        block.Remove("content");
      }

      return block;
    }

    private JsonObject YMapToObject(YMap map)
    {
      var result = new JsonObject();
      using var iterator = map.Iterate(transaction);

      foreach (var (key, value) in iterator)
      {
        // JSON.stringify drops undefined-valued keys.
        if (TryToPlain(value, out var plain))
        {
          result[key] = plain;
        }
      }

      return result;
    }

    private JsonArray YArrayToPlain(YArray array)
    {
      return new JsonArray(ReadArray(array).Select(ToPlainOrNull).ToArray());
    }

    private JsonNode? ToPlainOrNull(Output value)
    {
      return TryToPlain(value, out var plain) ? plain : null;
    }

    /// <summary>
    /// Read-back of the write rules. The grid branch comes FIRST — a keyed
    /// grid IS a map, and reading it as an object would leak the row keys.
    /// Returns false for undefined, which JSON has no value for.
    /// </summary>
    private bool TryToPlain(Output value, out JsonNode? plain)
    {
      plain = null;

      switch (value.Tag)
      {
        case OutputTag.Map when IsGridMap(value.Map):
          plain = GridMapToPlain(value.Map);

          return true;

        case OutputTag.Map:
          plain = YMapToObject(value.Map);

          return true;

        case OutputTag.Array:
          plain = YArrayToPlain(value.Array);

          return true;

        case OutputTag.JsonObject:
          var result = new JsonObject();

          foreach (var (key, child) in value.JsonObject)
          {
            if (TryToPlain(child, out var childPlain))
            {
              result[key] = childPlain;
            }
          }

          plain = result;

          return true;

        case OutputTag.JsonArray:
          plain = new JsonArray(value.JsonArray.Select(ToPlainOrNull).ToArray());

          return true;

        case OutputTag.String:
          plain = JsonValue.Create(value.String);

          return true;

        case OutputTag.Boolean:
          plain = JsonValue.Create(value.Boolean);

          return true;

        case OutputTag.Double:
          plain = NumberNode(value.Double);

          return true;

        case OutputTag.Long:
          plain = JsonValue.Create(value.Long);

          return true;

        case OutputTag.Null:
          return true;

        case OutputTag.Undefined:
          return false;

        default:
          throw new InvalidDataException(
              $"collab: unsupported shared type {value.Tag} in block data.");
      }
    }

    /// <summary>
    /// Both container keys must be present with the right shape, so a
    /// tool's plain object can never be mistaken for a grid.
    /// </summary>
    private bool IsGridMap(YMap map)
    {
      return map.Get(transaction, GridRowsKey)?.Tag == OutputTag.Map &&
          map.Get(transaction, GridOrderKey)?.Tag == OutputTag.Array;
    }

    private JsonArray GridMapToPlain(YMap grid)
    {
      var rows = grid.Get(transaction, GridRowsKey)!.Map;
      var result = new JsonArray();

      foreach (var key in GridRowKeys(grid, rows))
      {
        result.Add(ToPlainOrNull(rows.Get(transaction, key)!));
      }

      return result;
    }

    /// <summary>
    /// Row keys in display order, normalized: first occurrence wins, keys
    /// with no row container are dropped, containers absent from the order
    /// are appended sorted by key.
    /// </summary>
    private List<string> GridRowKeys(YMap grid, YMap rows)
    {
      var seen = new HashSet<string>(StringComparer.Ordinal);
      var keys = new List<string>();

      foreach (var entry in ReadArray(grid.Get(transaction, GridOrderKey)!.Array))
      {
        if (entry.Tag != OutputTag.String)
        {
          continue;
        }

        var key = entry.String;

        if (seen.Contains(key) || rows.Get(transaction, key) is null)
        {
          continue;
        }

        seen.Add(key);
        keys.Add(key);
      }

      List<string> rowKeys;

      using (var iterator = rows.Iterate(transaction))
      {
        rowKeys = iterator.Select(pair => pair.Key).ToList();
      }

      keys.AddRange(rowKeys.Where(key => !seen.Contains(key)).Order(StringComparer.Ordinal));

      return keys;
    }
  }
}
