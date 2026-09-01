using System.Globalization;
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
///
/// NUL IS UNREADABLE, AND EXPORT CANNOT BE PROTECTED. yffi builds a
/// <c>CString</c> for every string it hands back and unwraps the result:
/// map keys through <c>YMapEntry::new</c> (yrs release-v0.19.1,
/// yffi/src/lib.rs:216) and string values through yffi/src/lib.rs:2815. A
/// NUL anywhere — a block id, a data or grid-row key, any string value, a
/// contentIds or root-order entry — makes that unwrap panic, and a Rust
/// panic across the FFI boundary ABORTS the process (SIGABRT). It cannot be
/// caught, retried or logged. The write direction is no better: yffi
/// truncates every string at the first NUL, silently.
///
/// So <see cref="Seed"/> REJECTS a NUL anywhere (better a failed seed than a
/// consumer's record shortened and PUT back), and <see cref="Export"/> has no
/// defence at all: by the time a hostile update is in the doc, reading it is
/// fatal. A NUL cannot arrive through Seed, only through an applied update,
/// so the guard belongs at the room's pre-apply boundary — and YDotNet 0.6.0
/// exposes nothing that decodes an update without applying it (no update
/// reader; StateDiffV1/V2 need a doc), so the only reliable place is the
/// client, before the update is produced. YDocConverterHardeningTests carries
/// the skipped canary that reproduces the abort.
/// </summary>
internal static class YDocConverter
{
  /// <summary>
  /// How deep a value inside a block's <c>data</c>/<c>tunes</c> may nest.
  /// The value walks are recursive on both sides (a Y.Map inside a Y.Map has
  /// no iterative shape that is worth the noise), and a StackOverflow cannot
  /// be caught, so the depth is bounded instead. The parent-chain and
  /// contentIds walks are unbounded but ITERATIVE — a document legitimately
  /// nests thousands of blocks deep, and cycles are already broken.
  /// </summary>
  internal const int MaxValueDepth = 256;

  /// <summary>
  /// MaxDepth for every System.Text.Json reader and writer on the collab
  /// path. It must stay comfortably above <see cref="MaxValueDepth"/> plus
  /// the levels the block envelope adds above a data value (block array →
  /// block → data), or a document this converter accepts could not be parsed
  /// from, or written back to, the doc endpoint. The framework default is 64,
  /// which is BELOW the converter's own limit — hence the explicit value.
  /// </summary>
  internal const int JsonMaxDepth = 512;

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

        NoNul(id, "a block id");
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
  /// Applies block-level edit ops (POST /sync/{doc}/edit) in request order;
  /// a later op sees what the earlier ones did.
  ///
  /// TWO PHASES, because yrs has no rollback. Everything that can refuse the
  /// request — the structural checks against a shadow of the doc, and the
  /// input building, which is where the NUL and depth guards fire — happens
  /// BEFORE the write transaction opens. A refused request therefore leaves
  /// the doc byte-for-byte as it was, and the commit the room observes is one
  /// update carrying every op.
  /// </summary>
  internal static void ApplyOps(Doc doc, IReadOnlyList<CollabEditOp> ops)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(ops);

    if (ops.Count == 0)
    {
      return;
    }

    var blockMap = doc.Map(BlocksRoot);
    var rootOrder = doc.Array(OrderRoot);
    var writer = new InputWriter();

    try
    {
      var steps = new EditPlanner(doc, blockMap, rootOrder, writer).Plan(ops);
      using var transaction = doc.WriteTransaction();

      foreach (var step in steps)
      {
        step.Apply(transaction, blockMap, rootOrder);
      }
    }
    finally
    {
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

  /// <summary>
  /// The one gate for the NUL hazard described in the type header. Every
  /// string that reaches <c>Input.String</c> or becomes a Y.Map key passes
  /// through here.
  /// </summary>
  private static string NoNul(string value, string what)
  {
    if (value.Contains('\0', StringComparison.Ordinal))
    {
      throw new InvalidDataException(
          $"collab: {what} contains a NUL character. yrs truncates it on " +
          "write and aborts the process on read, so the document is rejected.");
    }

    return value;
  }

  private static void GuardDepth(int depth, string what)
  {
    if (depth > MaxValueDepth)
    {
      throw new InvalidDataException(
          $"collab: {what} is nested deeper than {MaxValueDepth} levels.");
    }
  }

  /// <summary>
  /// The keys and values a JS <c>Object.entries</c> would yield, which is
  /// what <c>YBlockSerializer.objectToYMap</c> iterates when it is handed a
  /// malformed <c>data</c> or <c>tunes</c>: an array yields index keys, a
  /// string yields one key per UTF-16 code unit, a number or boolean yields
  /// nothing, and null/undefined throws (a TypeError there, an
  /// InvalidDataException here). Mirroring it keeps the lockstep rule intact
  /// — the server accepts exactly what the client would load.
  /// </summary>
  private static JsonObject ObjectEntries(JsonNode? value, string what)
  {
    switch (value)
    {
      case null:
        throw new InvalidDataException($"collab: {what} is null.");

      case JsonObject map:
        return map;

      case JsonArray items:
        var indexed = new JsonObject();

        for (var index = 0; index < items.Count; index++)
        {
          indexed[index.ToString(CultureInfo.InvariantCulture)] =
              items[index]?.DeepClone();
        }

        return indexed;

      case JsonValue scalar when scalar.GetValueKind() == JsonValueKind.String:
        var text = scalar.GetValue<string>();
        var characters = new JsonObject();

        for (var index = 0; index < text.Length; index++)
        {
          characters[index.ToString(CultureInfo.InvariantCulture)] =
              JsonValue.Create(text[index].ToString());
        }

        return characters;

      default:
        // A number or a boolean has no own enumerable properties.
        return [];
    }
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
  /// <summary>
  /// Turns a request into concrete writes, refusing anything the doc does not
  /// agree with BEFORE the transaction opens.
  ///
  /// It keeps its own picture of the doc — ids, each block's parentId, and the
  /// root order — and mutates that picture as it plans, so a later op sees the
  /// effects of an earlier one (insert then update the same block is legal,
  /// remove then re-insert the same id puts it in its new place, not its old).
  ///
  /// PARENTID IS THE MEMBERSHIP ARBITER, exactly as it is on export: a block
  /// belongs where its own parentId says, not where some contentIds array
  /// lists it. That is why a removal walks parentId to find the subtree — a
  /// child the removed parent never listed would otherwise be left with a
  /// dangling parent and resurface as a root orphan on the client's orphan
  /// pass — and why a listed child that names a different parent survives.
  /// </summary>
  private sealed class EditPlanner(
      Doc doc,
      YMap blockMap,
      YArray rootOrder,
      InputWriter writer)
  {
    private readonly Dictionary<string, string?> parents = new(StringComparer.Ordinal);
    private readonly List<string> order = [];

    internal List<EditStep> Plan(IReadOnlyList<CollabEditOp> ops)
    {
      ReadDoc();

      var steps = new List<EditStep>();

      for (var index = 0; index < ops.Count; index++)
      {
        try
        {
          steps.AddRange(PlanOne(ops[index], index));
        }
        catch (InvalidDataException refusal)
        {
          // The converter's own guards — NUL and value depth — speak about a
          // document, not a request. A caller reaching ApplyOps directly still
          // has to learn WHICH op was refused, and the caller is an HTTP
          // handler that answers 422 off this exception type.
          throw new CollabEditException(Where(index, refusal.Message), refusal);
        }
      }

      return steps;
    }

    /// <summary>
    /// The one read pass: every id with its parentId, plus the root order as
    /// stored. Both are needed by position maths, and reading them once keeps
    /// planning O(ops) over a snapshot instead of re-walking the doc per op.
    /// </summary>
    private void ReadDoc()
    {
      using var transaction = doc.ReadTransaction();

      foreach (var (id, value) in blockMap.Iterate(transaction))
      {
        parents[id] = value.Tag == OutputTag.Map
            ? ReadParentId(transaction, value.Map)
            : null;
      }

      var length = rootOrder.Length(transaction);

      for (uint index = 0; index < length; index++)
      {
        var entry = rootOrder.Get(transaction, index);

        if (entry?.Tag == OutputTag.String)
        {
          order.Add(entry.String);
        }
      }
    }

    private static string? ReadParentId(Transaction transaction, YMap block)
    {
      var parentId = block.Get(transaction, "parentId");

      return parentId?.Tag == OutputTag.String ? parentId.String : null;
    }

    private List<EditStep> PlanOne(CollabEditOp op, int index)
    {
      return op switch
      {
        CollabEditOp.Insert insert => PlanInsert(insert, index),
        CollabEditOp.Update update => PlanUpdate(update, index),
        CollabEditOp.Remove remove => PlanRemove(remove, index),
        _ => throw new CollabEditException(Where(index, "the op is not one this server knows.")),
      };
    }

    private List<EditStep> PlanInsert(CollabEditOp.Insert op, int index)
    {
      if (parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(
            Where(index, $"the document already has a block \"{op.Id}\"."));
      }

      if (op.Parent is not null)
      {
        // Screened even though it is only ever COMPARED here: it becomes the
        // block's parentId a few lines down, and "not found" would be a
        // misleading answer for a request that carries a process-killer.
        NoNul(op.Parent, "a parent id");

        if (!parents.ContainsKey(op.Parent))
        {
          throw new CollabEditException(
              Where(index, $"there is no block \"{op.Parent}\" to insert under."));
        }
      }

      if (op.After is not null)
      {
        if (!parents.TryGetValue(op.After, out var afterParent))
        {
          throw new CollabEditException(
              Where(index, $"there is no block \"{op.After}\" to insert after."));
        }

        if (!string.Equals(afterParent, op.Parent, StringComparison.Ordinal))
        {
          throw new CollabEditException(Where(
              index,
              $"block \"{op.After}\" is not a child of " +
              (op.Parent is null ? "the document root" : $"\"{op.Parent}\"") + "."));
        }
      }

      // Built here, not at apply time: composing the block is what runs the
      // NUL and depth guards, and a refusal must happen before any write.
      var block = new JsonObject(op.Block.Select(entry =>
          new KeyValuePair<string, JsonNode?>(entry.Key, entry.Value?.DeepClone())));

      if (op.Parent is not null)
      {
        block["parent"] = op.Parent;
      }

      var input = writer.Block(NoNul(op.Id, "a block id"), block);

      parents[op.Id] = op.Parent;

      var steps = new List<EditStep> { EditStep.PutBlock(op.Id, input) };

      if (op.Parent is null)
      {
        var at = op.After is null ? 0 : order.IndexOf(op.After) + 1;

        order.Insert(at, op.Id);
        steps.Add(EditStep.InsertRootOrder((uint)at, writer.Track(Input.String(op.Id))));
      }
      else
      {
        steps.Add(EditStep.LinkChild(op.Parent, op.Id, op.After));
      }

      return steps;
    }

    private List<EditStep> PlanUpdate(CollabEditOp.Update op, int index)
    {
      if (!parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(
            Where(index, $"there is no block \"{op.Id}\" to update."));
      }

      return [EditStep.ReplaceData(op.Id, writer.DataMap(op.Data))];
    }

    /// <summary>
    /// The subtree by parentId — see the type docstring for why that, and not
    /// contentIds, is what a removal follows.
    /// </summary>
    private List<EditStep> PlanRemove(CollabEditOp.Remove op, int index)
    {
      // A removed id is only ever compared, never written — but a caller
      // sending one is sending a process-killer, and should hear that rather
      // than "no such block".
      NoNul(op.Id, "a block id");

      if (!parents.TryGetValue(op.Id, out var parentOfRemoved))
      {
        throw new CollabEditException(
            Where(index, $"there is no block \"{op.Id}\" to remove."));
      }

      var doomed = new HashSet<string>(StringComparer.Ordinal) { op.Id };
      var pending = new Queue<string>([op.Id]);

      // Iterative: a document may legitimately nest thousands deep, and
      // recursion there is a StackOverflow that cannot be caught.
      while (pending.Count > 0)
      {
        var parent = pending.Dequeue();

        foreach (var (id, parentId) in parents)
        {
          if (string.Equals(parentId, parent, StringComparison.Ordinal) && doomed.Add(id))
          {
            pending.Enqueue(id);
          }
        }
      }

      var steps = new List<EditStep>();

      foreach (var id in doomed)
      {
        parents.Remove(id);
        steps.Add(EditStep.RemoveBlock(id));

        var at = order.IndexOf(id);

        if (at >= 0)
        {
          order.RemoveAt(at);
          steps.Add(EditStep.RemoveRootOrder((uint)at));
        }
      }

      if (parentOfRemoved is not null)
      {
        steps.Add(EditStep.UnlinkChild(parentOfRemoved, op.Id));
      }

      return steps;
    }

    private static string Where(int index, string message)
    {
      return $"collab: op {index}: {message}";
    }
  }

  /// <summary>
  /// One write, already validated and already built. Applying a step never
  /// refuses: everything that could be refused happened while planning, so the
  /// transaction either runs whole or never opens.
  /// </summary>
  private sealed class EditStep
  {
    private readonly Action<Transaction, YMap, YArray> apply;

    private EditStep(Action<Transaction, YMap, YArray> apply)
    {
      this.apply = apply;
    }

    internal void Apply(Transaction transaction, YMap blockMap, YArray rootOrder)
    {
      apply(transaction, blockMap, rootOrder);
    }

    internal static EditStep PutBlock(string id, Input block)
    {
      return new EditStep((transaction, blockMap, _) =>
          blockMap.Insert(transaction, id, block));
    }

    internal static EditStep RemoveBlock(string id)
    {
      return new EditStep((transaction, blockMap, _) =>
          blockMap.Remove(transaction, id));
    }

    internal static EditStep ReplaceData(string id, Input data)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        var block = blockMap.Get(transaction, id);

        block?.Map?.Insert(transaction, "data", data);
      });
    }

    internal static EditStep InsertRootOrder(uint at, Input id)
    {
      return new EditStep((transaction, _, rootOrder) =>
          rootOrder.InsertRange(transaction, at, [id]));
    }

    internal static EditStep RemoveRootOrder(uint at)
    {
      return new EditStep((transaction, _, rootOrder) =>
          rootOrder.RemoveRange(transaction, at, 1));
    }

    /// <summary>
    /// Adds the child to its parent's contentIds. Read at apply time, not
    /// planned: the array is a live shared type, and an earlier step in this
    /// same transaction may have changed its length.
    /// </summary>
    internal static EditStep LinkChild(string parentId, string childId, string? afterId)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        var contentIds = ContentIdsOf(transaction, blockMap, parentId);

        if (contentIds is null)
        {
          return;
        }

        var at = afterId is null ? 0 : IndexOf(transaction, contentIds, afterId) + 1;

        contentIds.InsertRange(transaction, (uint)at, [Input.String(childId)]);
      });
    }

    internal static EditStep UnlinkChild(string parentId, string childId)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        var contentIds = ContentIdsOf(transaction, blockMap, parentId);

        if (contentIds is null)
        {
          return;
        }

        var at = IndexOf(transaction, contentIds, childId);

        if (at >= 0)
        {
          contentIds.RemoveRange(transaction, (uint)at, 1);
        }
      });
    }

    private static YArray? ContentIdsOf(Transaction transaction, YMap blockMap, string id)
    {
      var block = blockMap.Get(transaction, id)?.Map;
      var contentIds = block?.Get(transaction, "contentIds");

      return contentIds?.Tag == OutputTag.Array ? contentIds.Array : null;
    }

    private static int IndexOf(Transaction transaction, YArray contentIds, string id)
    {
      var length = contentIds.Length(transaction);

      for (uint index = 0; index < length; index++)
      {
        var entry = contentIds.Get(transaction, index);

        if (entry?.Tag == OutputTag.String &&
            string.Equals(entry.String, id, StringComparison.Ordinal))
        {
          return (int)index;
        }
      }

      return -1;
    }
  }

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

    /// <summary>A block's <c>data</c> map on its own, for an edit that replaces it.</summary>
    internal Input DataMap(JsonObject data)
    {
      return ObjectToYMap(data, 1);
    }

    internal Input Block(string id, JsonObject block)
    {
      var entries = new Dictionary<string, Input>(StringComparer.Ordinal)
      {
        ["id"] = Track(Input.String(id)),
        ["type"] = Atomic(block["type"], 1),
      };

      entries["data"] = ObjectToYMap(
          NormalizeBlockData(
              block["type"],
              ObjectEntries(block["data"], $"block \"{id}\" data")),
          1);

      if (block.TryGetPropertyValue("tunes", out var tunes))
      {
        entries["tunes"] = ObjectToYMap(
            ObjectEntries(tunes, $"block \"{id}\" tunes"),
            1);
      }

      if (block.TryGetPropertyValue("parent", out var parent))
      {
        entries["parentId"] = Atomic(parent, 1);
      }

      // EAGER, always — even with no children — so one peer is the single
      // creator of the array and concurrent first children merge as inserts.
      entries["contentIds"] = ContentIds(id, block["content"]);

      if (block.TryGetPropertyValue("lastEditedAt", out var lastEditedAt))
      {
        entries["lastEditedAt"] = Atomic(lastEditedAt, 1);
      }

      if (block.TryGetPropertyValue("lastEditedBy", out var lastEditedBy))
      {
        entries["lastEditedBy"] = Atomic(lastEditedBy, 1);
      }

      return Track(Input.Map(entries));
    }

    /// <summary>
    /// <c>Y.Array.from(content ?? [])</c>: absent and null give an empty
    /// array, a string spreads into its characters, and anything else that
    /// is not an array is not iterable — a TypeError on the client, an
    /// InvalidDataException here.
    /// </summary>
    private Input ContentIds(string id, JsonNode? content)
    {
      switch (content)
      {
        case null:
          return Track(Input.Array([]));

        case JsonArray items:
          return Track(Input.Array(items.Select(item => Atomic(item, 1)).ToArray()));

        case JsonValue scalar when scalar.GetValueKind() == JsonValueKind.String:
          return Track(Input.Array(scalar.GetValue<string>()
              .Select(character => Track(Input.String(NoNul(
                  character.ToString(),
                  $"block \"{id}\" content"))))
              .ToArray()));

        default:
          throw new InvalidDataException($"collab: block \"{id}\" has non-iterable content.");
      }
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

    private Input ObjectToYMap(JsonObject value, int depth)
    {
      GuardDepth(depth, "a data value");

      var entries = new Dictionary<string, Input>(StringComparer.Ordinal);

      foreach (var (key, child) in value)
      {
        entries[NoNul(key, "a data key")] = PlainToYValue(child, depth + 1);
      }

      return Track(Input.Map(entries));
    }

    /// <summary>
    /// The grid rule, then the array rule, then nested maps; primitives and
    /// non-convertible arrays stay atomic leaves.
    /// </summary>
    private Input PlainToYValue(JsonNode? value, int depth)
    {
      if (value is JsonArray array && IsConvertibleArray(array))
      {
        GuardDepth(depth, "a data value");

        return array.All(element => element is JsonArray)
          ? PlainToGridMap(array, depth)
          : Track(Input.Array(array
              .Select(element => PlainToYValue(element, depth + 1))
              .ToArray()));
      }

      if (value is JsonObject map)
      {
        return ObjectToYMap(map, depth);
      }

      return Atomic(value, depth);
    }

    private Input PlainToGridMap(JsonArray rows, int depth)
    {
      var rowMap = new Dictionary<string, Input>(StringComparer.Ordinal);
      var order = new List<Input>();

      foreach (var row in rows)
      {
        var key = GenerateRowKey();

        // The row wrapper adds a container level of its own (__rows), so a
        // grid costs two levels per row, matching the read-back walk.
        rowMap[key] = PlainToYValue(row, depth + 2);
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
    private Input Atomic(JsonNode? value, int depth)
    {
      switch (value)
      {
        case null:
          return Track(Input.Null());

        case JsonObject map:
          GuardDepth(depth, "a data value");

          var entries = new Dictionary<string, Input>(StringComparer.Ordinal);

          foreach (var (key, child) in map)
          {
            entries[NoNul(key, "a data key")] = Atomic(child, depth + 1);
          }

          return Track(Input.Object(entries));

        case JsonArray items:
          GuardDepth(depth, "a data value");

          return Track(Input.Collection(items
              .Select(item => Atomic(item, depth + 1))
              .ToArray()));

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
          return Input.String(NoNul(value.GetValue<string>(), "a string value"));

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
        MarkParentChain(id, state, broken);
      }

      return broken;
    }

    /// <summary>
    /// Colour one parentId chain: true = on the current path, false = done.
    /// Meeting a node that is on the path closes a loop; the path from that
    /// node onward IS the cycle, whichever member the walk entered at.
    ///
    /// ITERATIVE on purpose. parentId is single-valued, so a chain is a
    /// straight line with no branching — and a document may legitimately
    /// nest thousands of blocks deep, which as recursion is a StackOverflow
    /// that cannot be caught.
    /// </summary>
    private void MarkParentChain(
        string startId,
        Dictionary<string, bool> state,
        HashSet<string> broken)
    {
      var path = new List<string>();
      var id = startId;

      while (true)
      {
        if (state.TryGetValue(id, out var visiting))
        {
          // Only nodes on THIS path are still true: the unwind below clears
          // every node a finished walk pushed.
          if (visiting)
          {
            BreakCycle(path.Skip(path.IndexOf(id)), broken);
          }

          break;
        }

        if (!allIds.Contains(id))
        {
          break;
        }

        state[id] = true;
        path.Add(id);

        var parentId = RawParentId(id);

        if (parentId is null)
        {
          break;
        }

        id = parentId;
      }

      foreach (var visited in path)
      {
        state[visited] = false;
      }
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
    ///
    /// ITERATIVE, with children pushed in reverse so the stack pops them in
    /// document order: nesting depth is a property of the user's document,
    /// and an uncatchable StackOverflow is not an acceptable answer to it.
    /// </summary>
    private void VisitBlock(
        string startId,
        string? startExpectedParentId,
        Dictionary<string, string?> hierarchy,
        HashSet<string> seen,
        List<string> ordered)
    {
      var pending = new Stack<(string Id, string? ExpectedParentId)>();

      pending.Push((startId, startExpectedParentId));

      while (pending.Count > 0)
      {
        var (id, expectedParentId) = pending.Pop();

        if (seen.Contains(id) || !entries.TryGetValue(id, out var entry))
        {
          continue;
        }

        if (!string.Equals(hierarchy[id], expectedParentId, StringComparison.Ordinal))
        {
          continue;
        }

        seen.Add(id);
        ordered.Add(id);

        var contentIds = entry.ContentIds ?? [];

        for (var index = contentIds.Count - 1; index >= 0; index--)
        {
          if (contentIds[index].Tag == OutputTag.String)
          {
            pending.Push((contentIds[index].String, id));
          }
        }
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
        ["data"] = YMapToObject(data.Map, 1),
      };

      var tunes = entry.Map.Get(transaction, "tunes");

      if (tunes?.Tag == OutputTag.Map && tunes.Map.Length(transaction) > 0)
      {
        block["tunes"] = YMapToObject(tunes.Map, 1);
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
        block["content"] = new JsonArray(entry.ContentIds
            .Select(child => ToPlainOrNull(child, 1))
            .ToArray());
      }

      var lastEditedAt = entry.Map.Get(transaction, "lastEditedAt");

      if (lastEditedAt?.Tag is OutputTag.Double or OutputTag.Long)
      {
        block["lastEditedAt"] = ToPlainOrNull(lastEditedAt, 1);
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

    private JsonObject YMapToObject(YMap map, int depth)
    {
      GuardDepth(depth, "a doc value");

      var result = new JsonObject();
      using var iterator = map.Iterate(transaction);

      foreach (var (key, value) in iterator)
      {
        // JSON.stringify drops undefined-valued keys.
        if (TryToPlain(value, depth + 1, out var plain))
        {
          result[key] = plain;
        }
      }

      return result;
    }

    private JsonArray YArrayToPlain(YArray array, int depth)
    {
      GuardDepth(depth, "a doc value");

      return new JsonArray(ReadArray(array)
          .Select(item => ToPlainOrNull(item, depth + 1))
          .ToArray());
    }

    private JsonNode? ToPlainOrNull(Output value, int depth)
    {
      return TryToPlain(value, depth, out var plain) ? plain : null;
    }

    /// <summary>
    /// Read-back of the write rules. The grid branch comes FIRST — a keyed
    /// grid IS a map, and reading it as an object would leak the row keys.
    /// Returns false for undefined, which JSON has no value for.
    /// </summary>
    private bool TryToPlain(Output value, int depth, out JsonNode? plain)
    {
      plain = null;

      switch (value.Tag)
      {
        case OutputTag.Map when IsGridMap(value.Map):
          plain = GridMapToPlain(value.Map, depth);

          return true;

        case OutputTag.Map:
          plain = YMapToObject(value.Map, depth);

          return true;

        case OutputTag.Array:
          plain = YArrayToPlain(value.Array, depth);

          return true;

        case OutputTag.JsonObject:
          GuardDepth(depth, "a doc value");

          var result = new JsonObject();

          foreach (var (key, child) in value.JsonObject)
          {
            if (TryToPlain(child, depth + 1, out var childPlain))
            {
              result[key] = childPlain;
            }
          }

          plain = result;

          return true;

        case OutputTag.JsonArray:
          GuardDepth(depth, "a doc value");

          plain = new JsonArray(value.JsonArray
              .Select(child => ToPlainOrNull(child, depth + 1))
              .ToArray());

          return true;

        // A shared type no Blok client writes — a foreign peer's Y.Text, say.
        // The JS client renders each as its string form (`JSON.stringify`
        // calls the type's own toJSON), so this does too rather than making
        // the room permanently unreadable. Y.XmlFragment is unreachable: it
        // has no Output accessor in YDotNet 0.6.0, which throws while
        // building the Output, before this switch is entered.
        case OutputTag.Text:
          plain = JsonValue.Create(value.Text.String(transaction));

          return true;

        case OutputTag.XmlText:
          plain = JsonValue.Create(value.XmlText.String(transaction));

          return true;

        case OutputTag.XmlElement:
          plain = JsonValue.Create(value.XmlElement.String(transaction));

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

    private JsonArray GridMapToPlain(YMap grid, int depth)
    {
      GuardDepth(depth, "a doc value");

      var rows = grid.Get(transaction, GridRowsKey)!.Map;
      var result = new JsonArray();

      foreach (var key in GridRowKeys(grid, rows))
      {
        // The keyed wrapper costs the same two levels the write side spends.
        result.Add(ToPlainOrNull(rows.Get(transaction, key)!, depth + 2));
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
