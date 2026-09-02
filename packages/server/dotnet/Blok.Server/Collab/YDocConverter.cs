using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;

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
/// input.json, read the client's update.b64, round-trip through a state diff).
/// A unilateral change on either side goes red in that side's CI. When the
/// client format changes on purpose: regenerate the fixtures, then bring the
/// mirrored law here up to date in the same change.
///
/// Numbers are written as doubles only: an integral double encodes as a lib0
/// varint, which the JS client reads as a number, while a bigint becomes a
/// lib0 BigInt that JS reads as a BigInt and cannot JSON.stringify.
///
/// NUL IS ORDINARY DATA IN THE DOCUMENT, AND REFUSED AT THE JSON SEAM. The
/// engine stores and exports a NUL intact wherever one arrives through an
/// applied update, and the room does not drop such an update (Locked Decision
/// 9: the sender's state vector already covers it, so refusing it would only
/// make every following SyncStep2 resend it forever). The JSON seed and edit
/// paths are the other direction — a consumer's record, PUT back to the
/// consumer — and the endpoint contract has never accepted a NUL there. So
/// <see cref="Seed"/> and the edit ops REJECT one anywhere, while
/// <see cref="Export"/> carries whatever the document holds.
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
  ///
  /// Accounting shared with the client: <c>data</c> is level 1, only
  /// containers count, so the scalar inside the deepest allowed map is read.
  /// Seed refuses a deeper record; Export reads a deeper container as null.
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
  internal static void Seed(YDoc doc, JsonArray blocks)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(blocks);

    var blockMap = doc.GetMap(BlocksRoot);
    var rootOrder = doc.GetArray(OrderRoot);
    var prepared = new List<(string Id, YMap Block)>();
    var topLevelIds = new List<object?>();

    // Composed BEFORE the transaction opens, because composing is where the
    // NUL and depth guards fire: a refused document leaves the doc as it was.
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
      prepared.Add((id, InputWriter.Block(id, block)));

      if (!block.ContainsKey("parent"))
      {
        topLevelIds.Add(id);
      }
    }

    doc.Transact(transaction =>
    {
      var length = rootOrder.Count;

      if (length > 0)
      {
        rootOrder.Delete(transaction, 0, length);
      }

      blockMap.Clear(transaction);

      foreach (var (id, block) in prepared)
      {
        blockMap.Set(transaction, id, block);
      }

      if (topLevelIds.Count > 0)
      {
        rootOrder.Insert(transaction, 0, topLevelIds);
      }
    });
  }

  /// <summary>
  /// Applies block-level edit ops (POST /sync/{doc}/edit) in request order;
  /// a later op sees what the earlier ones did.
  ///
  /// TWO PHASES. Everything that can refuse the request — the structural
  /// checks against a shadow of the doc, and the value building, which is
  /// where the NUL and depth guards fire — happens BEFORE the transaction
  /// opens. A refused request therefore leaves the doc byte-for-byte as it
  /// was, and the commit the room observes is one update carrying every op.
  /// </summary>
  internal static void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(ops);

    if (ops.Count == 0)
    {
      return;
    }

    var blockMap = doc.GetMap(BlocksRoot);
    var rootOrder = doc.GetArray(OrderRoot);
    var steps = new EditPlanner(blockMap, rootOrder).Plan(ops);

    try
    {
      doc.Transact(transaction =>
      {
        foreach (var step in steps)
        {
          step.Apply(transaction, blockMap, rootOrder);
        }
      });
    }
    catch (Exception unplanned)
    {
      // A step is not supposed to be able to fail — everything it assumes is
      // refused while planning. If one ever does, the transaction emits
      // NOTHING (the engine runs cleanup only after the body returns) and yet
      // the writes it already made STAY in the store: their clocks are inside
      // the next transaction's before-state, so no later incremental update
      // ever carries them and the frame log never records them. The document
      // is then ahead of both the members and the blob until a full state is
      // encoded. So the honest report is a server error, NOT the refusal
      // shape, which would promise the caller nothing was written.
      throw new InvalidOperationException(
          "collab: an edit failed while it was being written, and the document may " +
          "hold part of it. Reload the document from the record.",
          unplanned);
    }
  }

  /// <summary>
  /// Serializes the doc in derived flat order the way
  /// <c>DocumentStore.toJSON</c> does. The hierarchy view is computed once
  /// and used for both the order and the emitted parent/content, so a
  /// position never contradicts a parent link. A block a peer wrote in a
  /// shape no Blok client makes is skipped and reported through
  /// <paramref name="warn"/> — see <see cref="DocReader.ReadBlock"/>.
  /// </summary>
  internal static JsonArray Export(YDoc doc, Action<string>? warn = null)
  {
    ArgumentNullException.ThrowIfNull(doc);

    return new DocReader(doc.GetMap(BlocksRoot), doc.GetArray(OrderRoot), warn).Export();
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
  /// The one gate for the NUL rule described in the type header. Every string
  /// the JSON seam turns into a document value or a Y.Map key passes here.
  /// </summary>
  private static string NoNul(string value, string what)
  {
    if (value.Contains('\0', StringComparison.Ordinal))
    {
      throw new InvalidDataException(
          $"collab: {what} contains a NUL character, which this endpoint does not accept.");
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
  private sealed class EditPlanner(YMap blockMap, YArray rootOrder)
  {
    private readonly Dictionary<string, string?> parents = new(StringComparer.Ordinal);

    /// <summary>
    /// Ids in the blocks map that are NOT maps. A peer can write anything
    /// there through an ordinary update, and a step that reads one as a map
    /// throws mid-transaction — the one way this design could write something
    /// partial, since a throw does not undo what the transaction has written.
    /// </summary>
    private readonly HashSet<string> notBlocks = new(StringComparer.Ordinal);

    /// <summary>
    /// Children by parent id, built once. A removal walks a subtree, and
    /// rescanning every block per step made one small request cost
    /// O(subtree x document) — 37 seconds on a 20,000-block document, all of
    /// it inside the room's single lane, with every member frozen behind it.
    /// </summary>
    private readonly Dictionary<string, List<string>> children = new(StringComparer.Ordinal);

    /// <summary>
    /// The root order as stored, INCLUDING slots that hold something other
    /// than an id — see ReadDoc. A null is a slot this planner will not name
    /// but must still count.
    /// </summary>
    private readonly List<string?> order = [];

    /// <summary>
    /// Which blocks LIST an id in their contentIds, which is not the same
    /// question as who its parent is: a block may list a child that names
    /// somebody else, and on removal that entry has to go too or it survives
    /// as a reference to a block that no longer exists. Kept current by the
    /// inserts and removals of this request, like the rest of the picture.
    /// </summary>
    private readonly Dictionary<string, List<string>> listedBy = new(StringComparer.Ordinal);

    /// <summary>
    /// Each block's contentIds (string entries), null where the block has no
    /// array at all — a peer can write one that way. A child is placed
    /// against this picture before the transaction opens, so "after" is
    /// refused unless the parent actually lists it.
    /// </summary>
    private readonly Dictionary<string, List<string>?> contents = new(StringComparer.Ordinal);

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
    /// The one read pass: every id with its parentId and what it lists, plus
    /// the root order as stored. Reading them once keeps planning O(ops) over
    /// a snapshot instead of re-walking the doc per op.
    /// </summary>
    private void ReadDoc()
    {
      foreach (var id in blockMap.Keys.ToArray())
      {
        if (Value(blockMap, id) is not YMap block)
        {
          notBlocks.Add(id);
          parents[id] = null;

          continue;
        }

        var parentId = ReadParentId(block);

        parents[id] = parentId;
        Index(id, parentId);

        var listed = ReadContentIds(block);

        contents[id] = listed;

        foreach (var childId in listed ?? [])
        {
          ListedBy(childId).Add(id);
        }
      }

      foreach (var entry in rootOrder.Enumerate())
      {
        // EVERY slot, including one holding something that is not an id: the
        // shadow's indices are applied to the real array, so skipping a slot
        // here shifts every later removal onto its neighbour.
        order.Add(entry as string);
      }
    }

    private List<string> ListedBy(string childId)
    {
      if (!listedBy.TryGetValue(childId, out var holders))
      {
        holders = [];
        listedBy[childId] = holders;
      }

      return holders;
    }

    /// <summary>The string entries of a block's contentIds; null when it has no array.</summary>
    private static List<string>? ReadContentIds(YMap block)
    {
      if (Value(block, "contentIds") is not YArray contentIds)
      {
        return null;
      }

      var ids = new List<string>();

      foreach (var entry in contentIds.Enumerate())
      {
        if (entry is string childId)
        {
          ids.Add(childId);
        }
      }

      return ids;
    }

    /// <summary>Adds one child to its parent's bucket.</summary>
    private void Index(string id, string? parentId)
    {
      if (parentId is null)
      {
        return;
      }

      if (!children.TryGetValue(parentId, out var bucket))
      {
        bucket = [];
        children[parentId] = bucket;
      }

      bucket.Add(id);
    }

    private static string? ReadParentId(YMap block)
    {
      return Value(block, "parentId") as string;
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
        // misleading answer for a request the seam refuses outright.
        NoNul(op.Parent, "a parent id");

        if (!parents.ContainsKey(op.Parent))
        {
          throw new CollabEditException(
              Where(index, $"there is no block \"{op.Parent}\" to insert under."));
        }
      }

      if (op.After is not null)
      {
        NoNul(op.After, "a block id");

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

      List<string>? siblings = null;

      if (op.Parent is not null)
      {
        RefuseUnlessBlockMap(op.Parent, index);

        if (!contents.TryGetValue(op.Parent, out siblings) || siblings is null)
        {
          throw new CollabEditException(Where(
              index,
              $"block \"{op.Parent}\" has no children list, so nothing can be placed under it."));
        }

        if (op.After is not null && !siblings.Contains(op.After))
        {
          throw new CollabEditException(Where(
              index,
              $"block \"{op.After}\" is not in the document order, so nothing can be " +
              "placed after it."));
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

      var composed = InputWriter.Block(NoNul(op.Id, "a block id"), block);

      parents[op.Id] = op.Parent;
      Index(op.Id, op.Parent);
      contents[op.Id] = [];

      if (op.Parent is not null)
      {
        ListedBy(op.Id).Add(op.Parent);
      }

      var steps = new List<EditStep> { EditStep.PutBlock(op.Id, composed) };

      if (op.Parent is null)
      {
        var found = op.After is null ? -1 : order.IndexOf(op.After);

        if (op.After is not null && found < 0)
        {
          // A root block by its parentId that the root order does not list.
          // Silently inserting at the front would put the block somewhere the
          // caller did not ask for.
          throw new CollabEditException(Where(
              index,
              $"block \"{op.After}\" is not in the document order, so nothing can be " +
              "placed after it."));
        }

        var at = found + 1;

        order.Insert(at, op.Id);
        steps.Add(EditStep.InsertRootOrder(at, op.Id));
      }
      else if (siblings is not null)
      {
        siblings.Insert(op.After is null ? 0 : siblings.IndexOf(op.After) + 1, op.Id);
        steps.Add(EditStep.LinkChild(op.Parent, op.Id, op.After));
      }

      return steps;
    }

    private List<EditStep> PlanUpdate(CollabEditOp.Update op, int index)
    {
      NoNul(op.Id, "a block id");

      if (!parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(
            Where(index, $"there is no block \"{op.Id}\" to update."));
      }

      RefuseUnlessBlockMap(op.Id, index);

      return [EditStep.ReplaceData(op.Id, InputWriter.DataMap(op.Data))];
    }

    /// <summary>
    /// The subtree by parentId — see the type docstring for why that, and not
    /// contentIds, is what a removal follows.
    /// </summary>
    private List<EditStep> PlanRemove(CollabEditOp.Remove op, int index)
    {
      // A removed id is only ever compared, never written — but the NUL screen
      // covers every id the request carries, so the caller hears about the NUL
      // rather than "no such block".
      NoNul(op.Id, "a block id");

      if (!parents.TryGetValue(op.Id, out var parentOfRemoved))
      {
        throw new CollabEditException(
            Where(index, $"there is no block \"{op.Id}\" to remove."));
      }

      var doomed = new HashSet<string>(StringComparer.Ordinal) { op.Id };
      var pending = new Queue<string>([op.Id]);

      // Iterative: a document may legitimately nest thousands deep, and
      // recursion there is a StackOverflow that cannot be caught. The child
      // index makes it linear in the SUBTREE rather than the document.
      while (pending.Count > 0)
      {
        if (!children.TryGetValue(pending.Dequeue(), out var bucket))
        {
          continue;
        }

        foreach (var id in bucket)
        {
          if (doomed.Add(id))
          {
            pending.Enqueue(id);
          }
        }
      }

      var steps = new List<EditStep>();

      foreach (var id in doomed)
      {
        // Out of its parent's bucket too, or a later removal of that parent
        // would doom whatever is re-inserted under this id.
        if (parents[id] is { } parentId && children.TryGetValue(parentId, out var siblings))
        {
          siblings.Remove(id);
        }

        parents.Remove(id);
        children.Remove(id);
        steps.Add(EditStep.RemoveBlock(id));

        // What it listed no longer has it as a holder.
        if (contents.Remove(id, out var listed))
        {
          foreach (var childId in listed ?? [])
          {
            if (listedBy.TryGetValue(childId, out var holdersOfChild))
            {
              holdersOfChild.Remove(id);
            }
          }
        }

        // Every occurrence: a duplicate entry left behind is a permanent
        // dangling id in the order.
        for (var at = order.LastIndexOf(id); at >= 0; at = order.LastIndexOf(id))
        {
          order.RemoveAt(at);
          steps.Add(EditStep.RemoveRootOrder(at));
        }

        // Unlink from wherever the doc lists it, not just from its parent: a
        // block may list a child that names somebody else as its parent, and
        // that entry would otherwise survive as a reference to a deleted
        // block — exported to the consumer as a child that no longer exists.
        if (listedBy.Remove(id, out var holders))
        {
          foreach (var holder in holders)
          {
            if (!doomed.Contains(holder))
            {
              contents.GetValueOrDefault(holder)?.Remove(id);
              steps.Add(EditStep.UnlinkChild(holder, id));
            }
          }
        }
      }

      return steps;
    }

    /// <summary>
    /// Refuses an op whose target is in the blocks map but is not a block.
    ///
    /// A peer can write anything into that map through an ordinary update, and
    /// the room applies remote updates without inspecting their shape. Steps
    /// read their targets as maps, and a step that throws mid-transaction is
    /// the one way this design can write something partial: the throw emits no
    /// update and does not undo what it wrote, so the members see NOTHING
    /// while the document holds half an edit no incremental update will ever
    /// carry. Everything a step assumes has to be refused here instead.
    /// </summary>
    private void RefuseUnlessBlockMap(string id, int index)
    {
      if (notBlocks.Contains(id))
      {
        throw new CollabEditException(
            Where(index, $"\"{id}\" is in the document but is not a block."));
      }
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
    private readonly Action<YTransaction, YMap, YArray> apply;

    private EditStep(Action<YTransaction, YMap, YArray> apply)
    {
      this.apply = apply;
    }

    internal void Apply(YTransaction transaction, YMap blockMap, YArray rootOrder)
    {
      apply(transaction, blockMap, rootOrder);
    }

    internal static EditStep PutBlock(string id, YMap block)
    {
      return new EditStep((transaction, blockMap, _) =>
          blockMap.Set(transaction, id, block));
    }

    internal static EditStep RemoveBlock(string id)
    {
      return new EditStep((transaction, blockMap, _) =>
          blockMap.Remove(transaction, id));
    }

    internal static EditStep ReplaceData(string id, YMap data)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        if (Value(blockMap, id) is YMap block)
        {
          block.Set(transaction, "data", data);
        }
      });
    }

    internal static EditStep InsertRootOrder(int at, string id)
    {
      return new EditStep((transaction, _, rootOrder) =>
          rootOrder.Insert(transaction, at, [id]));
    }

    internal static EditStep RemoveRootOrder(int at)
    {
      return new EditStep((transaction, _, rootOrder) =>
          rootOrder.Delete(transaction, at, 1));
    }

    /// <summary>
    /// Adds the child to its parent's contentIds. The index is read at apply
    /// time, not planned: the array is a live shared type, and an earlier
    /// step in this same transaction may have changed its length. That the
    /// array exists and lists <paramref name="afterId"/> was checked while
    /// planning.
    /// </summary>
    internal static EditStep LinkChild(string parentId, string childId, string? afterId)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        var contentIds = ContentIdsOf(blockMap, parentId) ??
            throw new InvalidOperationException(
                $"collab: block \"{parentId}\" has no children list to place \"{childId}\" in.");
        var at = afterId is null ? 0 : IndexOf(contentIds, afterId) + 1;

        contentIds.Insert(transaction, at, [childId]);
      });
    }

    internal static EditStep UnlinkChild(string parentId, string childId)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        var contentIds = ContentIdsOf(blockMap, parentId);

        if (contentIds is null)
        {
          return;
        }

        var at = IndexOf(contentIds, childId);

        if (at >= 0)
        {
          contentIds.Delete(transaction, at, 1);
        }
      });
    }

    private static YArray? ContentIdsOf(YMap blockMap, string id)
    {
      return Value(blockMap, id) is YMap block
        ? Value(block, "contentIds") as YArray
        : null;
    }

    private static int IndexOf(YArray contentIds, string id)
    {
      var index = 0;

      foreach (var entry in contentIds.Enumerate())
      {
        if (entry is string current && string.Equals(current, id, StringComparison.Ordinal))
        {
          return index;
        }

        index++;
      }

      return -1;
    }
  }

  /// <summary>
  /// JSON → engine values, mirroring <c>YBlockSerializer.outputDataToYBlock</c>
  /// and <c>plainToYValue</c>. A shared value is a PRELIM type, seeded at
  /// construction and integrated when the item holding it is; a plain value is
  /// an <see cref="AnyObject"/> / <see cref="AnyArray"/> tree of CLR scalars.
  /// </summary>
  private static class InputWriter
  {
    /// <summary>A block's <c>data</c> map on its own, for an edit that replaces it.</summary>
    internal static YMap DataMap(JsonObject data)
    {
      return ObjectToYMap(data, 1);
    }

    internal static YMap Block(string id, JsonObject block)
    {
      var entries = new List<KeyValuePair<string, object?>>
      {
        Pair("id", id),
        Pair("type", Atomic(block["type"], 1)),
        Pair(
            "data",
            ObjectToYMap(
                NormalizeBlockData(
                    block["type"],
                    ObjectEntries(block["data"], $"block \"{id}\" data")),
                1)),
      };

      if (block.TryGetPropertyValue("tunes", out var tunes))
      {
        entries.Add(Pair(
            "tunes",
            ObjectToYMap(ObjectEntries(tunes, $"block \"{id}\" tunes"), 1)));
      }

      if (block.TryGetPropertyValue("parent", out var parent))
      {
        entries.Add(Pair("parentId", Atomic(parent, 1)));
      }

      // EAGER, always — even with no children — so one peer is the single
      // creator of the array and concurrent first children merge as inserts.
      entries.Add(Pair("contentIds", ContentIds(id, block["content"])));

      if (block.TryGetPropertyValue("lastEditedAt", out var lastEditedAt))
      {
        entries.Add(Pair("lastEditedAt", Atomic(lastEditedAt, 1)));
      }

      if (block.TryGetPropertyValue("lastEditedBy", out var lastEditedBy))
      {
        entries.Add(Pair("lastEditedBy", Atomic(lastEditedBy, 1)));
      }

      return new YMap(entries);
    }

    /// <summary>
    /// <c>Y.Array.from(content ?? [])</c>: absent and null give an empty
    /// array, a string spreads into its characters, and anything else that
    /// is not an array is not iterable — a TypeError on the client, an
    /// InvalidDataException here.
    /// </summary>
    private static YArray ContentIds(string id, JsonNode? content)
    {
      switch (content)
      {
        case null:
          return new YArray([]);

        case JsonArray items:
          return new YArray(items.Select(item => Atomic(item, 1)));

        case JsonValue scalar when scalar.GetValueKind() == JsonValueKind.String:
          return new YArray(scalar.GetValue<string>()
              .Select(character => (object?)NoNul(
                  character.ToString(),
                  $"block \"{id}\" content")));

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

    private static YMap ObjectToYMap(JsonObject value, int depth)
    {
      GuardDepth(depth, "a data value");

      var entries = new List<KeyValuePair<string, object?>>();

      foreach (var (key, child) in value)
      {
        entries.Add(Pair(NoNul(key, "a data key"), PlainToYValue(child, depth + 1)));
      }

      return new YMap(entries);
    }

    /// <summary>
    /// The grid rule, then the array rule, then nested maps; primitives and
    /// non-convertible arrays stay atomic leaves.
    /// </summary>
    private static object? PlainToYValue(JsonNode? value, int depth)
    {
      if (value is JsonArray array && IsConvertibleArray(array))
      {
        GuardDepth(depth, "a data value");

        return array.All(element => element is JsonArray)
          ? PlainToGridMap(array, depth)
          : new YArray(array.Select(element => PlainToYValue(element, depth + 1)));
      }

      if (value is JsonObject map)
      {
        return ObjectToYMap(map, depth);
      }

      return Atomic(value, depth);
    }

    private static YMap PlainToGridMap(JsonArray rows, int depth)
    {
      var rowEntries = new List<KeyValuePair<string, object?>>();
      var order = new List<object?>();

      foreach (var row in rows)
      {
        var key = GenerateRowKey();

        // The row wrapper adds a container level of its own (__rows), so a
        // grid costs two levels per row, matching the read-back walk.
        rowEntries.Add(Pair(key, PlainToYValue(row, depth + 2)));
        order.Add(key);
      }

      return new YMap(
      [
        Pair(GridRowsKey, new YMap(rowEntries)),
        Pair(GridOrderKey, new YArray(order)),
      ]);
    }

    /// <summary>
    /// A plain (non-shared) value: what a bare <c>ymap.set(key, value)</c>
    /// stores. Nested objects and arrays stay plain all the way down.
    /// </summary>
    private static object? Atomic(JsonNode? value, int depth)
    {
      switch (value)
      {
        case null:
          return null;

        case JsonObject map:
          GuardDepth(depth, "a data value");

          var entries = new AnyObject();

          foreach (var (key, child) in map)
          {
            entries.Add(NoNul(key, "a data key"), Atomic(child, depth + 1));
          }

          return entries;

        case JsonArray items:
          GuardDepth(depth, "a data value");

          var collection = new AnyArray();

          foreach (var item in items)
          {
            collection.Add(Atomic(item, depth + 1));
          }

          return collection;

        case JsonValue scalar:
          return Scalar(scalar);

        default:
          throw new InvalidDataException("collab: unsupported JSON node.");
      }
    }

    private static object? Scalar(JsonValue value)
    {
      switch (value.GetValueKind())
      {
        case JsonValueKind.String:
          return NoNul(value.GetValue<string>(), "a string value");

        case JsonValueKind.True:
          return true;

        case JsonValueKind.False:
          return false;

        case JsonValueKind.Number:
          return ToDouble(value);

        default:
          return null;
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

    private static KeyValuePair<string, object?> Pair(string key, object? value)
    {
      return new KeyValuePair<string, object?>(key, value);
    }
  }

  /// <summary>The value under a key, or null when the map has no live entry for it.</summary>
  private static object? Value(YMap map, string key)
  {
    return map.TryGet(key, out var value) ? value : null;
  }

  /// <summary>
  /// One block's map entry as read while the export walks the doc.
  /// </summary>
  private sealed record BlockEntry(
      YMap Map,
      string? RawParentId,
      IReadOnlyList<object?>? ContentIds);

  /// <summary>
  /// Doc → JSON, mirroring <c>DocumentStore.toJSON</c> and
  /// <c>YBlockSerializer.yBlockToOutputData/yValueToPlain</c>.
  /// </summary>
  private sealed class DocReader
  {
    private readonly YArray rootOrder;
    private readonly Action<string>? warn;

    /// <summary>Keys from the block down to the value being read, for the error that names them.</summary>
    private readonly List<string> path = [];

    /// <summary>Every key of the blocks map, map-valued or not.</summary>
    private readonly HashSet<string> allIds = new(StringComparer.Ordinal);

    /// <summary>Map-valued entries only; the others are never emitted.</summary>
    private readonly Dictionary<string, BlockEntry> entries = new(StringComparer.Ordinal);

    internal DocReader(YMap blockMap, YArray rootOrder, Action<string>? warn)
    {
      this.rootOrder = rootOrder;
      this.warn = warn;

      foreach (var id in blockMap.Keys.ToArray())
      {
        allIds.Add(id);

        if (Value(blockMap, id) is YMap block)
        {
          entries[id] = ReadEntry(id, block);
        }
      }
    }

    internal JsonArray Export()
    {
      var hierarchy = HierarchyView();
      var exported = new JsonArray();

      foreach (var id in DeriveOrderedIds(hierarchy))
      {
        if (ReadBlock(id, entries[id]) is { } block)
        {
          exported.Add(ProjectHierarchy(id, block, hierarchy));
        }
      }

      return exported;
    }

    /// <summary>
    /// LOCKSTEP RULE, shared with the client's toJSON: a block whose id or
    /// type is not a string, or whose data is not a map, is skipped with a
    /// warning naming its key; a container nested past MaxValueDepth reads
    /// as null. The order was derived before any block was read, so a skip
    /// costs one block, never its children. Whatever a reader still refuses
    /// names the block and the key path.
    /// </summary>
    private JsonObject? ReadBlock(string key, BlockEntry entry)
    {
      path.Clear();

      try
      {
        return YBlockToOutputData(key, entry);
      }
      catch (Exception error) when (error is InvalidDataException or JsonException)
      {
        var where = path.Count == 0 ? "its fields" : string.Join('.', path);

        throw new InvalidDataException(
            $"collab: block \"{key}\" at {where}: {error.Message}",
            error);
      }
    }

    private JsonObject? Skip(string key, string reason)
    {
      warn?.Invoke($"collab: block \"{key}\" was skipped on export: {reason}.");

      return null;
    }

    private void Enter(string key)
    {
      path.Add(key);
    }

    private void Enter(int index)
    {
      path.Add(index.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>Never reached when the read threw, so the path still names where.</summary>
    private void Leave()
    {
      path.RemoveAt(path.Count - 1);
    }

    private static BlockEntry ReadEntry(string id, YMap map)
    {
      // A self-parent is never a real link.
      var rawParentId = Value(map, "parentId") is string parentId && parentId != id
        ? parentId
        : null;

      return new BlockEntry(
          map,
          rawParentId,
          Value(map, "contentIds") is YArray contentIds ? [.. contentIds.Enumerate()] : null);
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

      foreach (var entry in rootOrder.Enumerate())
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
        object? entry,
        string? expectedParentId,
        Dictionary<string, string?> hierarchy,
        HashSet<string> seen,
        List<string> ordered)
    {
      if (entry is string id)
      {
        VisitBlock(id, expectedParentId, hierarchy, seen, ordered);
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
          if (contentIds[index] is string childId)
          {
            pending.Push((childId, id));
          }
        }
      }
    }

    private JsonObject? YBlockToOutputData(string key, BlockEntry entry)
    {
      if (Value(entry.Map, "id") is not string id)
      {
        return Skip(key, "its id is not a string");
      }

      if (Value(entry.Map, "type") is not string type)
      {
        return Skip(key, "its type is not a string");
      }

      if (Value(entry.Map, "data") is not YMap data)
      {
        return Skip(key, "its data is not a map");
      }

      Enter("data");

      var block = new JsonObject
      {
        ["id"] = id,
        ["type"] = type,
        ["data"] = YMapToObject(data, 1),
      };

      Leave();

      if (Value(entry.Map, "tunes") is YMap { Count: > 0 } tunes)
      {
        Enter("tunes");
        block["tunes"] = YMapToObject(tunes, 1);
        Leave();
      }

      // Any string parentId, self-parent included — the projection re-decides
      // against the hierarchy view, exactly like the client serializer.
      if (Value(entry.Map, "parentId") is string parentId)
      {
        block["parent"] = parentId;
      }

      if (entry.ContentIds is { Count: > 0 })
      {
        Enter("content");
        block["content"] = ToPlainArray(entry.ContentIds, 1);
        Leave();
      }

      var lastEditedAt = Value(entry.Map, "lastEditedAt");

      if (lastEditedAt is double or BigInteger)
      {
        Enter("lastEditedAt");
        block["lastEditedAt"] = ToPlainOrNull(lastEditedAt, 1);
        Leave();
      }

      if (Value(entry.Map, "lastEditedBy") is string lastEditedBy)
      {
        block["lastEditedBy"] = lastEditedBy;
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
      var result = new JsonObject();

      foreach (var key in map.Keys.ToArray())
      {
        Enter(key);

        // JSON.stringify drops undefined-valued keys.
        if (TryToPlain(Value(map, key), depth + 1, out var plain))
        {
          result[key] = plain;
        }

        Leave();
      }

      return result;
    }

    /// <summary>Every element at <paramref name="depth"/>, its index on the path.</summary>
    private JsonArray ToPlainArray(IReadOnlyList<object?> items, int depth)
    {
      var result = new JsonArray();

      for (var index = 0; index < items.Count; index++)
      {
        Enter(index);
        result.Add(ToPlainOrNull(items[index], depth));
        Leave();
      }

      return result;
    }

    private JsonNode? ToPlainOrNull(object? value, int depth)
    {
      return TryToPlain(value, depth, out var plain) ? plain : null;
    }

    /// <summary>
    /// Read-back of the write rules. The grid branch comes FIRST — a keyed
    /// grid IS a map, and reading it as an object would leak the row keys.
    /// Returns false for undefined, which JSON has no value for.
    /// </summary>
    private bool TryToPlain(object? value, int depth, out JsonNode? plain)
    {
      plain = null;

      if (depth > MaxValueDepth && value is YMap or YArray or AnyObject or AnyArray)
      {
        // The lockstep null; scalars are never depth-gated.
        return true;
      }

      switch (value)
      {
        case null:
          return true;

        case YMap grid when IsGridMap(grid):
          plain = GridMapToPlain(grid, depth);

          return true;

        case YMap map:
          plain = YMapToObject(map, depth);

          return true;

        case YArray array:
          plain = ToPlainArray([.. array.Enumerate()], depth + 1);

          return true;

        case AnyObject any:
          var result = new JsonObject();

          foreach (var (key, child) in any)
          {
            Enter(key);

            if (TryToPlain(child, depth + 1, out var childPlain))
            {
              result[key] = childPlain;
            }

            Leave();
          }

          plain = result;

          return true;

        case AnyArray items:
          plain = ToPlainArray(items, depth + 1);

          return true;

        // A shared type no Blok client writes — a foreign peer's Y.Text, say.
        // The JS client renders each as its string form (`JSON.stringify`
        // calls the type's own toJSON), so this does too rather than making
        // the room permanently unreadable.
        case YText text:
          plain = JsonValue.Create(text.ToString());

          return true;

        case YXmlText xmlText:
          plain = JsonValue.Create(xmlText.ToString());

          return true;

        // The XML CONTAINERS are placeholders in this engine and hold no
        // markup to render (Locked Decision 8), so they read as the empty
        // string. YDotNet threw on a Y.XmlFragment here, which made a room
        // holding one permanently unexportable.
        case YXmlElement or YXmlFragment or YXmlHook:
          plain = JsonValue.Create("");

          return true;

        case string text:
          plain = JsonValue.Create(text);

          return true;

        case bool flag:
          plain = JsonValue.Create(flag);

          return true;

        case double number:
          plain = NumberNode(number);

          return true;

        case BigInteger big:
          plain = JsonValue.Create(ToLong(big));

          return true;

        // JSON.stringify writes a Uint8Array as an index-keyed object, and
        // the client hands the consumer exactly that.
        case byte[] bytes:
          plain = BytesToObject(bytes);

          return true;

        case YUndefined:
          return false;

        default:
          throw new InvalidDataException(
              $"collab: unsupported value {value.GetType().Name} in block data.");
      }
    }

    private static JsonObject BytesToObject(byte[] bytes)
    {
      var result = new JsonObject();

      for (var index = 0; index < bytes.Length; index++)
      {
        result[index.ToString(CultureInfo.InvariantCulture)] = bytes[index];
      }

      return result;
    }

    /// <summary>
    /// A peer's bigint, as a JSON number. Past long's range there is no
    /// lossless JSON number to write, and JS could not read one back.
    /// </summary>
    private static long ToLong(BigInteger value)
    {
      if (value < long.MinValue || value > long.MaxValue)
      {
        throw new InvalidDataException(
            "collab: a bigint in block data is too large for a JSON number.");
      }

      return (long)value;
    }

    /// <summary>
    /// Both container keys must be present with the right shape, so a
    /// tool's plain object can never be mistaken for a grid.
    /// </summary>
    private static bool IsGridMap(YMap map)
    {
      return Value(map, GridRowsKey) is YMap && Value(map, GridOrderKey) is YArray;
    }

    private JsonArray GridMapToPlain(YMap grid, int depth)
    {
      var rows = (YMap)Value(grid, GridRowsKey)!;
      var keys = GridRowKeys(grid, rows);
      var result = new JsonArray();

      for (var index = 0; index < keys.Count; index++)
      {
        Enter(index);

        // The keyed wrapper costs the same two levels the write side spends.
        result.Add(ToPlainOrNull(Value(rows, keys[index]), depth + 2));
        Leave();
      }

      return result;
    }

    /// <summary>
    /// Row keys in display order, normalized: first occurrence wins, keys
    /// with no row container are dropped, containers absent from the order
    /// are appended sorted by key.
    /// </summary>
    private static List<string> GridRowKeys(YMap grid, YMap rows)
    {
      var seen = new HashSet<string>(StringComparer.Ordinal);
      var keys = new List<string>();

      foreach (var entry in ((YArray)Value(grid, GridOrderKey)!).Enumerate())
      {
        if (entry is not string key)
        {
          continue;
        }

        if (seen.Contains(key) || !rows.TryGet(key, out _))
        {
          continue;
        }

        seen.Add(key);
        keys.Add(key);
      }

      keys.AddRange(rows.Keys.Where(key => !seen.Contains(key)).Order(StringComparer.Ordinal));

      return keys;
    }
  }
}
