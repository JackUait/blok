using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
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
  /// Accounting shared with the client: a value INSIDE <c>data</c> is level
  /// 1 (see <see cref="BlockFieldDepth"/>), each enclosing object or array
  /// adds one, and only containers count — so the scalar inside the deepest
  /// allowed map is read. A seed takes 256 levels inside data and refuses the
  /// 257th; Export reads the 257th container as null.
  /// </summary>
  internal const int MaxValueDepth = 256;

  /// <summary>
  /// The level of the <c>data</c>/<c>tunes</c> map itself. Its VALUES are
  /// level 1 — the client counts a value inside data as the first level, and
  /// the malformed-doc-blocks fixture pins the boundary across both walks.
  /// </summary>
  private const int BlockFieldDepth = 0;

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

  /// <summary>
  /// THE list of block-data keys whose value is stored as a <see cref="YText"/>
  /// so two peers typing in one block merge per character instead of the later
  /// write taking the whole field.
  ///
  /// LOCKSTEP: it must name exactly what <c>DIFFABLE_TEXT_KEYS</c> names in
  /// src/components/modules/yjs/serializer.ts. Widening the set is one entry
  /// there and one entry here — and nowhere else in this file.
  ///
  /// Top-level block data ONLY, exactly like the client: a nested <c>text</c>
  /// (a table cell's) goes through the generic value walk and stays a leaf, and
  /// so does a <c>text</c> under <c>tunes</c>.
  /// </summary>
  private static readonly string[] DiffableTextKeys = ["text", "code", "caption", "title", "alt", "artist"];

  /// <summary>
  /// THE list of NESTED data keys whose value is stored as a <see cref="YArray"/>
  /// even when empty or all-string, so two peers each inserting a block into ONE
  /// table cell keep both ids instead of one whole-value write orphaning the
  /// other's child block.
  ///
  /// LOCKSTEP: it must name exactly what <c>EAGER_ARRAY_KEYS</c> names in
  /// src/components/modules/yjs/serializer.ts. Widening the set is one entry
  /// there and one entry here — and nowhere else in this file.
  ///
  /// NESTED block data ONLY, exactly like the client: <c>BlockDataEntries</c>
  /// (the TOP level) does not consult it, so a custom tool's top-level
  /// <c>data.blocks</c> keeps the generic array rule.
  ///
  /// The generic array rule cannot cover it: <c>IsConvertibleArray</c> promotes
  /// only non-empty ALL-OBJECT/ARRAY arrays, and a cell is born
  /// <c>blocks: []</c> and then holds strings — as a view is born
  /// <c>filters: []</c> / <c>sorts: []</c>. Minting is EAGER for the same
  /// reason <c>contentIds</c> is: a later promotion runs on two peers at once
  /// and map-set is last-writer-wins, so the loser's ids are discarded.
  /// </summary>
  private static readonly string[] OrderedIdArrayKeys = ["blocks", "filters", "sorts"];

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
    ApplyOps(doc, ops, out _);
  }

  /// <summary>
  /// <paramref name="visited"/> counts the blocks the removal walks stepped
  /// through, for the test that pins them linear in the subtree.
  /// </summary>
  internal static void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops, out int visited)
  {
    visited = 0;
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(ops);

    if (ops.Count == 0)
    {
      return;
    }

    var blockMap = doc.GetMap(BlocksRoot);
    var rootOrder = doc.GetArray(OrderRoot);
    var planner = new EditPlanner(blockMap, rootOrder);
    var steps = planner.Plan(ops);

    visited = planner.Visited;

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

  /// <summary>Empty paragraph data becomes { text: "" }; nothing else changes.</summary>
  private static JsonObject NormalizeBlockData(string? type, JsonObject data)
  {
    return type == "paragraph" && data.Count == 0
      ? new JsonObject { ["text"] = "" }
      : data;
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

    /// <summary>Each block's type, for the normalization an update shares with a seed.</summary>
    private readonly Dictionary<string, string?> types = new(StringComparer.Ordinal);

    /// <summary>Blocks the removal walks dequeued; linear in the subtree, never the document.</summary>
    internal int Visited { get; private set; }

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

        var parentId = ReadString(block, "parentId");

        parents[id] = parentId;
        types[id] = ReadString(block, "type");
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

    private static string? ReadString(YMap block, string key)
    {
      return Value(block, key) as string;
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
      types[op.Id] = TryGetString(op.Block, "type", out var type) ? type : null;
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

      var entries = InputWriter.BlockDataEntries(
          NormalizeBlockData(types.GetValueOrDefault(op.Id), op.Data));

      // The values reach the doc as the plain JSON they came in as, so the
      // guards the conversion carries have to be run over them HERE, while
      // planning: a refusal must happen before the transaction opens.
      InputWriter.Screen(entries);

      return [EditStep.ReplaceData(op.Id, entries)];
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
        Visited++;

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
        types.Remove(id);
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

    /// <summary>
    /// Rewrites a block's data KEY BY KEY rather than setting a fresh map over
    /// the old one, and each key IN PLACE rather than setting a fresh
    /// container over the old one. A whole-key set is last-writer-wins, so it
    /// discarded the live container a peer was editing at that moment together
    /// with everything in it — the text they were typing, the row they were in,
    /// the id they had just put in a table cell. Per key, an existing
    /// <see cref="YText"/> is EDITED into its new value and every other live
    /// container is DEEP-ASSIGNED into (see <see cref="DeepAssign"/>), so the
    /// peer's characters and containers keep their identity and both edits
    /// survive.
    ///
    /// Keys the new data does not carry are still removed, so "replace the
    /// data" still means replace.
    /// </summary>
    internal static EditStep ReplaceData(
        string id, IReadOnlyList<KeyValuePair<string, object?>> data)
    {
      return new EditStep((transaction, blockMap, _) =>
      {
        if (Value(blockMap, id) is not YMap block)
        {
          return;
        }

        if (Value(block, "data") is not YMap existing)
        {
          block.Set(transaction, "data", InputWriter.ToDataMap(data));

          return;
        }

        var keep = new HashSet<string>(data.Select(entry => entry.Key), StringComparer.Ordinal);

        foreach (var key in existing.Keys.ToArray())
        {
          if (!keep.Contains(key))
          {
            existing.Remove(transaction, key);
          }
        }

        foreach (var (key, value) in data)
        {
          if (value is MergeableText text)
          {
            if (Value(existing, key) is YText live)
            {
              EditText(transaction, live, text.Value);
            }
            else
            {
              existing.Set(transaction, key, new YText(text.Value));
            }

            continue;
          }

          // TOP level: the ordered-id-array rule is a NESTED rule on both
          // sides, so `nested` is false here — a custom tool's top-level
          // `data.blocks` keeps the generic array rule.
          DeepAssign.Entry(
              transaction, existing, key, value as JsonNode, BlockFieldDepth + 1, nested: false);
        }
      });
    }

    /// <summary>
    /// Turns <paramref name="live"/> into <paramref name="next"/> with the
    /// smallest set of edits, so every character outside them keeps its CRDT
    /// identity and a peer's concurrent edit there survives.
    ///
    /// Applied back to front: every index counts from the text as it was
    /// before this call, exactly as the client applies the same ops.
    ///
    /// INSERT FIRST, then delete what it replaces. The other order anchors the
    /// new text to the RIGHT of the run it replaces — the characters it is
    /// anchored to are the ones being tombstoned — so a peer's concurrent
    /// keystroke inside that run surfaces in FRONT of the whole replacement.
    /// LOCKSTEP with the same order in DocumentStore.updateBlockData
    /// (src/components/modules/yjs/document-store.ts).
    /// </summary>
    private static void EditText(YTransaction transaction, YText live, string next)
    {
      var before = live.ToString();

      if (string.Equals(before, next, StringComparison.Ordinal))
      {
        return;
      }

      var edits = TextDiff.Diff(before, next);

      for (var index = edits.Count - 1; index >= 0; index--)
      {
        var edit = edits[index];

        if (edit.Insert.Length > 0)
        {
          live.Insert(transaction, edit.Index, edit.Insert);
        }

        if (edit.Remove > 0)
        {
          live.Delete(transaction, edit.Index + edit.Insert.Length, edit.Remove);
        }
      }
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
  /// The /edit write path, IN PLACE: plain JSON assigned onto the shared
  /// containers a block's data already holds, at every depth, instead of a
  /// fresh container set over each key.
  ///
  /// LOCKSTEP with the client's <c>deepAssignYMap</c> / <c>deepAssignYArray</c>
  /// / <c>deepAssignYGrid</c> / <c>pairGridRows</c> / <c>assignKeySequence</c>
  /// in src/components/modules/yjs/document-store.ts, which is what a full
  /// <c>save()</c> flush runs. The rules are the same and in the same order,
  /// because the two sides write into ONE document: a container one side
  /// replaces wholesale is a container the other side's concurrent edit was
  /// inside, and a whole-key set is last-writer-wins, so that edit is
  /// discarded with no error. Grid rows keep their KEYS for the same reason —
  /// re-minting them moves every row in the table, not just the edited one.
  ///
  /// Only the containers matter. A LEAF has no identity to keep, so a leaf
  /// that changed is simply written.
  /// </summary>
  private static class DeepAssign
  {
    /// <summary>
    /// One key of a live map. <paramref name="depth"/> is the depth OF THE
    /// VALUE, counted exactly as <c>InputWriter.PlainToYValue</c> counts it,
    /// so a wholesale write here guards the same levels the planning walk
    /// already guarded.
    ///
    /// <paramref name="nested"/> is false only for a block's TOP-LEVEL data
    /// keys, where the ordered-id-array rule does not apply — same split as
    /// the client's <c>updateBlockData</c> (top level) versus
    /// <c>assignYMapEntry</c> (nested).
    /// </summary>
    internal static void Entry(
        YTransaction transaction,
        YMap target,
        string key,
        JsonNode? value,
        int depth,
        bool nested)
    {
      var existing = Value(target, key);

      // The keyed grid FIRST: a grid wrapper IS a map, and the object branch
      // below would tear its container keys apart.
      if (value is JsonArray rows && existing is YMap grid && IsGridMap(grid))
      {
        if (InputWriter.IsGridArray(rows))
        {
          Grid(transaction, grid, rows, depth);
        }
        else if (InputWriter.IsIdentityArray(rows))
        {
          Identity(transaction, grid, rows, depth);
        }
        else if (!SameAsLive(grid, rows, depth))
        {
          // Neither shape any more (emptied, or the elements lost their ids) —
          // rebuild, so the write path matches the read path.
          target.Set(transaction, key, InputWriter.PlainToYValue(rows, depth));
        }

        return;
      }

      // An ordered id list is a YArray at ANY depth, even empty or all-string,
      // so two peers each dropping a block into ONE table cell keep both ids.
      // Before the generic array branch, which would downshift an all-string
      // value back to a plain leaf for failing IsConvertibleArray.
      // A grid or an identity array is the WRAPPER's business: forcing one to
      // a plain positionally-diffed array makes a reorder racing a field edit
      // converge both peers on the same wrong value.
      if (nested &&
          IsOrderedIdArrayKey(key) &&
          value is JsonArray idList &&
          !InputWriter.IsGridArray(idList) &&
          !InputWriter.IsIdentityArray(idList))
      {
        if (existing is YArray liveIds)
        {
          Array(transaction, liveIds, idList, depth);
        }
        else
        {
          // A cell written before this rule still holds a plain array.
          // Promote it unconditionally, so the migration happens on the first
          // write rather than never. THIS ONE write is last-writer-wins, as
          // every write of this key was before; every write after it merges.
          target.Set(transaction, key, InputWriter.PlainToYArray(idList, depth));
        }

        return;
      }

      if (value is JsonArray array && existing is YArray liveArray)
      {
        if (InputWriter.IsConvertibleArray(array))
        {
          Array(transaction, liveArray, array, depth);
        }
        else if (!SameAsLive(liveArray, array, depth))
        {
          target.Set(transaction, key, InputWriter.PlainToYValue(array, depth));
        }

        return;
      }

      if (value is JsonObject map)
      {
        if (existing is YMap liveMap)
        {
          Map(transaction, liveMap, map, depth);

          return;
        }

        // Unconditional, even when the plain shapes match: what is there is
        // not a YMap, and leaving it would keep the key un-mergeable forever.
        target.Set(transaction, key, InputWriter.PlainToYValue(map, depth));

        return;
      }

      if (!SameAsLive(existing, value, depth))
      {
        target.Set(transaction, key, InputWriter.PlainToYValue(value, depth));
      }
    }

    /// <summary>
    /// Assign a plain object onto a live map, key by key.
    ///
    /// Keys the object does not carry are REMOVED: an update states the whole
    /// value of the key it names, so "replace the data" still means replace,
    /// nested levels included. Only the keys the doc holds when this runs are
    /// removed, so a key a peer adds concurrently arrives afterwards and
    /// stays.
    ///
    /// Keys are written as they came in: the planning walk
    /// (<c>InputWriter.Screen</c>) ran the NUL screen over every key of this
    /// same JSON already, and refused the request if one carried a NUL.
    /// </summary>
    private static void Map(
        YTransaction transaction, YMap target, JsonObject source, int depth)
    {
      foreach (var key in target.Keys.ToArray())
      {
        if (!source.ContainsKey(key))
        {
          target.Remove(transaction, key);
        }
      }

      foreach (var (key, value) in source)
      {
        Entry(transaction, target, key, value, depth + 1, nested: true);
      }
    }

    /// <summary>
    /// Element-wise assign onto a live array with a TWO-ENDED diff: skip the
    /// equal prefix and suffix, recurse per element when the changed middles
    /// have equal length, otherwise replace the middle with ONE splice.
    /// Array item identity is what lets a concurrent insert and an element
    /// edit both apply, so an untouched element is never rewritten.
    /// </summary>
    private static void Array(
        YTransaction transaction, YArray target, JsonArray source, int depth)
    {
      var items = target.Enumerate().ToList();
      var sourceLength = source.Count;
      var (prefix, suffix) = CommonEnds(
          items.Count,
          sourceLength,
          (itemIndex, sourceIndex) =>
              SameAsLive(items[itemIndex], source[sourceIndex], depth + 1));
      var targetMiddle = items.Count - prefix - suffix;
      var sourceMiddle = sourceLength - prefix - suffix;

      if (targetMiddle == 0 && sourceMiddle == 0)
      {
        return;
      }

      if (targetMiddle == sourceMiddle)
      {
        for (var offset = 0; offset < sourceMiddle; offset++)
        {
          Element(transaction, target, prefix + offset, source[prefix + offset], depth + 1);
        }

        return;
      }

      // Unequal-length middles. Pair them by content FIRST: an element that is
      // still the same element must keep its container. A blanket
      // delete+insert of the middle recreates every container in it, so a
      // column inserted beside a cell a peer is concurrently editing threw
      // that peer's cell write away. Only an order-preserving pairing —
      // inserts and deletes, no move — can be expressed without a splice; a
      // genuine reorder still falls back to one, because a YArray has no move.
      var assignment = PairRows(
          targetMiddle,
          sourceMiddle,
          (targetIndex, sourceIndex) =>
              SameAsLive(items[prefix + targetIndex], source[prefix + sourceIndex], depth + 1),
          (targetIndex, sourceIndex) =>
              RowSimilarity(items[prefix + targetIndex], source[prefix + sourceIndex], depth + 1),
          enforceOrder: true);
      var paired = assignment.Where(index => index >= 0).ToList();
      var reordered = paired.Where((index, rank) => rank > 0 && index <= paired[rank - 1]).Any();

      if (paired.Count > 0 && !reordered)
      {
        var kept = new HashSet<int>(paired);

        // Backwards, so an earlier delete cannot shift a later offset.
        for (var offset = targetMiddle - 1; offset >= 0; offset--)
        {
          if (!kept.Contains(offset))
          {
            target.Delete(transaction, prefix + offset, 1);
          }
        }

        for (var offset = 0; offset < sourceMiddle; offset++)
        {
          if (assignment[offset] < 0)
          {
            target.Insert(
                transaction,
                prefix + offset,
                [InputWriter.PlainToYValue(source[prefix + offset], depth + 1)]);

            continue;
          }

          Element(transaction, target, prefix + offset, source[prefix + offset], depth + 1);
        }

        return;
      }

      // Nothing pairs, or the pairing is a reorder: one splice, so the change
      // lands as a single array event instead of N element rewrites.
      if (targetMiddle > 0)
      {
        target.Delete(transaction, prefix, targetMiddle);
      }

      if (sourceMiddle > 0)
      {
        target.Insert(
            transaction,
            prefix,
            [.. Enumerable
                .Range(prefix, sourceMiddle)
                .Select(index => InputWriter.PlainToYValue(source[index], depth + 1))]);
      }
    }

    /// <summary>One array element in place, recursing into live containers.</summary>
    private static void Element(
        YTransaction transaction, YArray target, int index, JsonNode? value, int depth)
    {
      var existing = target.Get(index);

      if (value is JsonArray rows && existing is YMap grid && IsGridMap(grid))
      {
        if (InputWriter.IsGridArray(rows))
        {
          Grid(transaction, grid, rows, depth);

          return;
        }

        if (InputWriter.IsIdentityArray(rows))
        {
          Identity(transaction, grid, rows, depth);

          return;
        }
      }

      if (value is JsonObject map && existing is YMap liveMap)
      {
        Map(transaction, liveMap, map, depth);

        return;
      }

      if (value is JsonArray array &&
          existing is YArray liveArray &&
          InputWriter.IsConvertibleArray(array))
      {
        Array(transaction, liveArray, array, depth);

        return;
      }

      // Equal-length middles can still hold individually equal elements
      // between changed ones — those must not be rewritten.
      if (SameAsLive(existing, value, depth))
      {
        return;
      }

      target.Delete(transaction, index, 1);
      target.Insert(transaction, index, [InputWriter.PlainToYValue(value, depth)]);
    }

    /// <summary>
    /// Assign plain rows onto a keyed grid wrapper.
    ///
    /// An /edit carries no row keys — it is the whole grid as plain arrays —
    /// so the rows must be RE-ASSOCIATED with the keys already in the doc.
    /// Once paired, a row is diffed in place and its container survives; only
    /// the order array records that rows moved. That is the whole point: an
    /// array has no move, so a positional diff expresses a reorder as
    /// delete+insert and throws away whatever a peer concurrently typed into
    /// the deleted row.
    ///
    /// The row wrapper costs two levels, the same two the write and read walks
    /// spend on it.
    /// </summary>
    private static void Grid(
        YTransaction transaction, YMap grid, JsonArray source, int depth)
    {
      var rows = (YMap)Value(grid, GridRowsKey)!;
      var order = (YArray)Value(grid, GridOrderKey)!;
      var currentKeys = GridRowKeys(grid, rows);
      var currentRows = currentKeys.Select(key => Value(rows, key)).ToList();
      var rowDepth = depth + 2;
      var assignment = PairRows(
          currentKeys.Count,
          source.Count,
          (currentIndex, sourceIndex) =>
              SameAsLive(currentRows[currentIndex], source[sourceIndex], rowDepth),
          (currentIndex, sourceIndex) =>
              RowSimilarity(currentRows[currentIndex], source[sourceIndex], rowDepth),
          enforceOrder: false);
      var paired = new HashSet<int>(assignment.Where(index => index >= 0));
      var nextKeys = new List<string>();

      for (var index = 0; index < currentKeys.Count; index++)
      {
        if (!paired.Contains(index))
        {
          rows.Remove(transaction, currentKeys[index]);
        }
      }

      for (var index = 0; index < source.Count; index++)
      {
        var pairedWith = assignment[index];

        if (pairedWith < 0)
        {
          var minted = InputWriter.GenerateRowKey();

          rows.Set(transaction, minted, InputWriter.PlainToYValue(source[index], rowDepth));
          nextKeys.Add(minted);

          continue;
        }

        var key = currentKeys[pairedWith];

        // Through Entry, not Array: the row's live value may be anything, and
        // the ordinary key rules decide what to do with it.
        Entry(transaction, rows, key, source[index], rowDepth, nested: true);
        nextKeys.Add(key);
      }

      KeySequence(transaction, order, nextKeys);
    }

    /// <summary>
    /// Assign plain id-bearing objects onto an identity-keyed wrapper.
    ///
    /// Nothing has to be re-associated here — unlike a grid row, the element
    /// carries its own key — so a reorder is just a new order array and every
    /// element's map survives it. That is the whole point: diffed by POSITION,
    /// a reorder racing a field edit applied that edit to whichever element
    /// took the index, and both peers converged on the same wrong value.
    ///
    /// LOCKSTEP with <c>deepAssignYIdentity</c> in
    /// src/components/modules/yjs/document-store.ts.
    /// </summary>
    private static void Identity(
        YTransaction transaction, YMap target, JsonArray source, int depth)
    {
      var rows = (YMap)Value(target, GridRowsKey)!;
      var order = (YArray)Value(target, GridOrderKey)!;
      // IsIdentityArray guarantees a non-empty string id on every element. The
      // id is used as the key as it came in: the planning walk screened this
      // same JSON through PlainToIdentityMap, which refuses a NUL in it.
      var nextKeys = source.Select(element => element!["id"]!.GetValue<string>()).ToList();
      var kept = new HashSet<string>(nextKeys, StringComparer.Ordinal);

      foreach (var key in rows.Keys.ToArray())
      {
        if (!kept.Contains(key))
        {
          rows.Remove(transaction, key);
        }
      }

      for (var index = 0; index < source.Count; index++)
      {
        Entry(transaction, rows, nextKeys[index], source[index], depth + 2, nested: true);
      }

      KeySequence(transaction, order, nextKeys);
    }

    /// <summary>
    /// Re-associate keyless plain rows with the doc's existing rows, in four
    /// passes, each cheaper and more certain than the next:
    ///
    /// 1. Two-ended anchors — the equal prefix and suffix pair 1:1. Rows
    ///    outside the edited span never enter the search.
    /// 2. Exact content match across the middle — this is how a MOVED row is
    ///    recognized as the same row rather than a delete plus an insert.
    /// 3. Cell-level similarity, only when the leftover counts DIFFER (a row
    ///    was added or removed in the same write that edited one): the edited
    ///    row still shares most of its cells with itself, a brand-new row
    ///    shares none. Equal counts skip straight to 4 — equal-length middles
    ///    rewrite in place.
    /// 4. Positional remainder — extra source rows are genuinely new, extra
    ///    doc rows genuinely deleted. Under <c>enforceOrder</c> — true for the
    ///    array walk, false for the keyed grid — a rank pair is taken only
    ///    when it keeps the pairing MONOTONIC: a
    ///    crossing pair is exactly what makes a SPLICING caller read an
    ///    add-and-remove as a reorder and rewrite the whole middle. A genuine
    ///    reorder is paired entirely by pass 2, so this pass never sees its
    ///    rows.
    ///
    /// Rows with identical content are interchangeable by definition, so pass
    /// 2 pairing an arbitrary one of them is not a defect.
    /// </summary>
    /// <returns>
    /// For each source row, the index of the doc row it pairs with, or -1 when
    /// it is a new row.
    /// </returns>
    private static int[] PairRows(
        int currentCount,
        int sourceCount,
        Func<int, int, bool> rowsEqual,
        Func<int, int, int> similarity,
        bool enforceOrder)
    {
      var assignment = Enumerable.Repeat(-1, sourceCount).ToArray();
      var taken = new HashSet<int>();

      void Pair(int sourceIndex, int currentIndex)
      {
        assignment[sourceIndex] = currentIndex;
        taken.Add(currentIndex);
      }

      var (prefix, suffix) = CommonEnds(currentCount, sourceCount, rowsEqual);

      for (var index = 0; index < prefix; index++)
      {
        Pair(index, index);
      }

      for (var index = 0; index < suffix; index++)
      {
        Pair(sourceCount - 1 - index, currentCount - 1 - index);
      }

      var middleSources = Enumerable
          .Range(0, sourceCount)
          .Where(index => assignment[index] < 0)
          .ToList();
      var middleTargets = Enumerable
          .Range(0, currentCount)
          .Where(index => !taken.Contains(index))
          .ToList();

      foreach (var sourceIndex in middleSources)
      {
        var match = middleTargets
            .Where(index => !taken.Contains(index) && rowsEqual(index, sourceIndex))
            .Select(index => (int?)index)
            .FirstOrDefault();

        if (match is not null)
        {
          Pair(sourceIndex, match.Value);
        }
      }

      var restSources = middleSources.Where(index => assignment[index] < 0).ToList();
      var restTargets = middleTargets.Where(index => !taken.Contains(index)).ToList();

      // Rank window: an unmatched row can only have shifted by the number of
      // unmatched inserts/deletes around it, so scoring further afield finds
      // nothing and would make the pass quadratic on a large grid. A row that
      // moved further than that was already caught by the exact pass above.
      var window = Math.Abs(restSources.Count - restTargets.Count) + 1;

      if (restSources.Count != restTargets.Count)
      {
        for (var rank = 0; rank < restSources.Count; rank++)
        {
          var sourceIndex = restSources[rank];
          var free = restTargets
              .Where((index, targetRank) =>
                  !taken.Contains(index) && Math.Abs(targetRank - rank) <= window)
              .ToList();
          var match = MostSimilar(free, sourceIndex, similarity);

          if (match >= 0)
          {
            Pair(sourceIndex, match);
          }
        }
      }

      // Whether pairing the two keeps the pairing MONOTONIC — every pair
      // already made stays on the side of it that source order and doc order
      // agree on. Reads `assignment` LIVE, so a pair taken here constrains
      // the next. Only a caller that SPLICES on a crossing asks for this: for
      // the keyed wrapper a crossing assignment is what the key order exists
      // to express, and refusing it mints a fresh key and deletes the live
      // row, which is the loss itself.
      bool KeepsOrder(int sourceIndex, int currentIndex)
      {
        for (var index = 0; index < assignment.Length; index++)
        {
          if (assignment[index] < 0)
          {
            continue;
          }

          var ordered = index < sourceIndex
              ? assignment[index] < currentIndex
              : assignment[index] > currentIndex;

          if (!ordered)
          {
            return false;
          }
        }

        return true;
      }

      // Taken ONCE, so `rank` keeps its 1:1 meaning: a refused candidate's
      // target is left unused rather than sliding to the next source.
      var finalTargets = restTargets.Where(index => !taken.Contains(index)).ToList();
      var rest = restSources.Where(index => assignment[index] < 0).ToList();

      for (var rank = 0; rank < rest.Count && rank < finalTargets.Count; rank++)
      {
        if (!enforceOrder || KeepsOrder(rest[rank], finalTargets[rank]))
        {
          Pair(rest[rank], finalTargets[rank]);
        }
      }

      return assignment;
    }

    /// <summary>
    /// The candidate doc row sharing the most cells with the source row, or -1
    /// when none shares any: a brand-new row has nothing in common with an
    /// existing one.
    /// </summary>
    private static int MostSimilar(
        IReadOnlyList<int> candidates, int sourceIndex, Func<int, int, int> similarity)
    {
      var best = -1;
      var bestScore = 0;

      foreach (var candidate in candidates)
      {
        var score = similarity(candidate, sourceIndex);

        if (score > bestScore)
        {
          best = candidate;
          bestScore = score;
        }
      }

      return best;
    }

    /// <summary>
    /// How much two rows look like the same row: the length of their common
    /// cell prefix plus common suffix. Measured from BOTH ends, never per
    /// position — a column inserted or deleted at the FRONT shifts every cell,
    /// so a positional score reads such a row as sharing nothing with itself
    /// and the pairing then hands a peer's concurrent edit to the wrong row.
    /// </summary>
    private static int RowSimilarity(object? current, JsonNode? source, int depth)
    {
      static int Score(JsonNode? live, JsonNode? value)
      {
        if (live is JsonArray items && value is JsonArray cells)
        {
          var (prefix, suffix) = CommonEnds(
              items.Count,
              cells.Count,
              (itemIndex, cellIndex) => JsonNode.DeepEquals(items[itemIndex], cells[cellIndex]));

          return prefix + suffix;
        }

        // Two objects: how much of what they both carry still agrees. A grid
        // ROW is always an array, so this branch only serves the element
        // pairing in Array — where an element is a table CELL, not a row. It
        // is the client's rowSimilarity, key for key; a score the two sides
        // disagree on pairs different elements and one of them splices.
        if (live is JsonObject fields && value is JsonObject values)
        {
          return fields
              .Where(entry => values.ContainsKey(entry.Key))
              .Sum(entry => Score(entry.Value, values[entry.Key]));
        }

        return JsonNode.DeepEquals(live, value) ? 1 : 0;
      }

      // Score the live side as the JSON the export would write, so a grid map
      // and a cell map are compared in the shape the source carries.
      return TryPlain(current, depth, out var plain) ? Score(plain, source) : 0;
    }

    /// <summary>
    /// Rewrite a grid's row-order array with one two-ended splice. The
    /// elements are plain key STRINGS, so delete+insert here costs nothing —
    /// no container is destroyed. Also self-heals: keys the read path
    /// normalized away (duplicated by concurrent reorders, or stranded by a
    /// concurrent delete) are absent from <paramref name="keys"/> and get
    /// spliced out.
    /// </summary>
    private static void KeySequence(
        YTransaction transaction, YArray order, List<string> keys)
    {
      var current = order.Enumerate().ToList();

      bool Same(int currentIndex, int keyIndex)
      {
        return current[currentIndex] is string key &&
            string.Equals(key, keys[keyIndex], StringComparison.Ordinal);
      }

      var (prefix, suffix) = CommonEnds(current.Count, keys.Count, Same);
      var currentMiddle = current.Count - prefix - suffix;
      var nextMiddle = keys.Count - prefix - suffix;

      if (currentMiddle > 0)
      {
        order.Delete(transaction, prefix, currentMiddle);
      }

      if (nextMiddle > 0)
      {
        order.Insert(
            transaction,
            prefix,
            [.. keys.Skip(prefix).Take(nextMiddle).Cast<object?>()]);
      }
    }

    /// <summary>
    /// Lengths of the equal prefix and equal suffix of two sequences, the
    /// suffix measured only past the prefix so the two never overlap. Every
    /// two-ended diff here shares this accounting.
    /// </summary>
    private static (int Prefix, int Suffix) CommonEnds(
        int leftLength, int rightLength, Func<int, int, bool> isEqualAt)
    {
      var maxPrefix = Math.Min(leftLength, rightLength);
      var prefix = 0;

      while (prefix < maxPrefix && isEqualAt(prefix, prefix))
      {
        prefix++;
      }

      var maxSuffix = maxPrefix - prefix;
      var suffix = 0;

      while (suffix < maxSuffix &&
          isEqualAt(leftLength - 1 - suffix, rightLength - 1 - suffix))
      {
        suffix++;
      }

      return (prefix, suffix);
    }

    /// <summary>
    /// Whether the live value already IS the plain value.
    ///
    /// Comparison only. A shape this writer can produce reads exactly as
    /// <see cref="Export"/> reads it; anything else — a foreign peer's XML
    /// type, bytes, a bigint, a value nested past the depth cap — answers
    /// "not the same", so the caller writes over it, which is what a
    /// whole-key set did for EVERY value before this path existed. A
    /// comparison that is wrong in that direction costs a redundant write; it
    /// cannot drop an edit.
    /// </summary>
    private static bool SameAsLive(object? live, JsonNode? value, int depth)
    {
      return TryPlain(live, depth, out var plain) && JsonNode.DeepEquals(plain, value);
    }

    /// <summary>The live value as the JSON the export would write, or false.</summary>
    private static bool TryPlain(object? live, int depth, out JsonNode? plain)
    {
      plain = null;

      // Past the cap the export writes the lockstep null rather than the
      // value, so there is nothing here to compare honestly: answer "not the
      // same" and let the caller write.
      if (depth > MaxValueDepth)
      {
        return false;
      }

      switch (live)
      {
        case null:
          return true;

        case YMap grid when IsGridMap(grid):
          return TryPlainGrid(grid, depth, out plain);

        case YMap map:
          return TryPlainEntries(map.Keys.ToArray().Select(
              key => new KeyValuePair<string, object?>(key, Value(map, key))),
              depth + 1,
              out plain);

        case AnyObject any:
          return TryPlainEntries(any, depth + 1, out plain);

        case YArray array:
          return TryPlainItems([.. array.Enumerate()], depth + 1, out plain);

        case AnyArray items:
          return TryPlainItems(items, depth + 1, out plain);

        // A block's mergeable text renders as its string form, exactly as the
        // export renders it.
        case YText text:
          plain = JsonValue.Create(text.ToString());

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

        default:
          return false;
      }
    }

    private static bool TryPlainEntries(
        IEnumerable<KeyValuePair<string, object?>> entries, int depth, out JsonNode? plain)
    {
      var result = new JsonObject();

      plain = null;

      foreach (var (key, child) in entries)
      {
        if (!TryPlain(child, depth, out var childPlain))
        {
          return false;
        }

        result[key] = childPlain;
      }

      plain = result;

      return true;
    }

    private static bool TryPlainItems(
        IReadOnlyList<object?> items, int depth, out JsonNode? plain)
    {
      var result = new JsonArray();

      plain = null;

      foreach (var item in items)
      {
        if (!TryPlain(item, depth, out var itemPlain))
        {
          return false;
        }

        result.Add(itemPlain);
      }

      plain = result;

      return true;
    }

    private static bool TryPlainGrid(YMap grid, int depth, out JsonNode? plain)
    {
      var rows = (YMap)Value(grid, GridRowsKey)!;

      // The keyed wrapper costs the same two levels the write side spends.
      return TryPlainItems(
          [.. GridRowKeys(grid, rows).Select(key => Value(rows, key))],
          depth + 2,
          out plain);
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
    /// <summary>
    /// <c>blockDataToYMap</c> as ENTRIES: the generic value walk, except that a
    /// STRING under a diffable key becomes mergeable text instead of an atomic
    /// leaf. Entries, not a <see cref="YMap"/>, because an edit writes them
    /// onto the block's EXISTING data map key by key so a live
    /// <see cref="YText"/> survives, and a prelim map's entries cannot be read
    /// back out of it.
    ///
    /// Each value travels as the PLAIN JSON it came in as: an update
    /// deep-assigns it into the shared containers the doc already holds (see
    /// <see cref="DeepAssign"/>), and a prelim <see cref="YMap"/> /
    /// <see cref="YArray"/> / <see cref="YText"/> hands nothing back to diff
    /// against. Mergeable text travels as a marker so the update path can tell
    /// "this string belongs in a YText" from an ordinary leaf.
    ///
    /// Only the KEYS are screened here. A caller that does not convert the
    /// values for real (the update path) must run <see cref="Screen"/> over
    /// them while planning.
    /// </summary>
    internal static List<KeyValuePair<string, object?>> BlockDataEntries(JsonObject data)
    {
      GuardDepth(BlockFieldDepth, "a data value");

      var entries = new List<KeyValuePair<string, object?>>();

      foreach (var (key, child) in data)
      {
        var dataKey = NoNul(key, "a data key");

        entries.Add(Pair(
            dataKey,
            IsDiffableTextKey(dataKey) &&
            child is JsonValue scalar &&
            scalar.GetValueKind() == JsonValueKind.String
              ? new MergeableText(NoNul(scalar.GetValue<string>(), "a string value"))
              : child));
      }

      return entries;
    }

    /// <summary>
    /// Runs the NUL and depth guards over every key, string and container
    /// level of the entries, and throws the result away.
    ///
    /// THE CONVERSION IS THE VALIDATOR — hand-writing a second walk would rot
    /// against it — and a refusal has to happen while planning, before the
    /// transaction opens. Only the UPDATE path needs this: the insert path
    /// converts for real, at plan time, through <see cref="ToDataMap"/>.
    /// </summary>
    internal static void Screen(IReadOnlyList<KeyValuePair<string, object?>> entries)
    {
      foreach (var entry in entries)
      {
        PlainToYValue(entry.Value as JsonNode, BlockFieldDepth + 1);
      }
    }

    /// <summary>Entries become the shared types they stand for.</summary>
    internal static YMap ToDataMap(IReadOnlyList<KeyValuePair<string, object?>> entries)
    {
      return new YMap(entries.Select(entry =>
          Pair(entry.Key, ToShared(entry.Value, BlockFieldDepth + 1))));
    }

    /// <summary>
    /// One <see cref="BlockDataEntries"/> value as the shared type it stands
    /// for: a marker mints the <see cref="YText"/>, anything else is plain
    /// JSON and goes through the ordinary value walk.
    /// </summary>
    internal static object? ToShared(object? value, int depth)
    {
      return value is MergeableText text
        ? new YText(text.Value)
        : PlainToYValue(value as JsonNode, depth);
    }

    internal static YMap Block(string id, JsonObject block)
    {
      // Export skips such a block, so accepting it here would PUT the record
      // back a block shorter.
      if (!TryGetString(block, "type", out var type))
      {
        throw new InvalidDataException($"collab: block \"{id}\" type is not a string.");
      }

      var entries = new List<KeyValuePair<string, object?>>
      {
        Pair("id", id),
        Pair("type", NoNul(type, $"block \"{id}\" type")),
        Pair(
            "data",
            ToDataMap(BlockDataEntries(
                NormalizeBlockData(type, ObjectEntries(block["data"], $"block \"{id}\" data"))))),
      };

      // EAGER, always — even with no tunes. Same law as `contentIds` below and
      // the YText above: a container two peers can create must be minted by
      // the ONE peer that creates the block. Created lazily on the first tune
      // write instead, two peers each set a fresh map on a tuneless block, and
      // map-set is last-writer-wins — the loser's map was discarded WITH the
      // tune inside it. Read-back drops an empty map, so the exported shape is
      // unchanged. LOCKSTEP with `outputDataToYBlock` in
      // src/components/modules/yjs/serializer.ts.
      entries.Add(Pair(
          "tunes",
          ObjectToYMap(
              block.TryGetPropertyValue("tunes", out var tunes)
                ? ObjectEntries(tunes, $"block \"{id}\" tunes")
                : [],
              BlockFieldDepth)));

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
              .EnumerateRunes()
              .Select(rune => (object?)NoNul(
                  rune.ToString(),
                  $"block \"{id}\" content")));

        default:
          throw new InvalidDataException($"collab: block \"{id}\" has non-iterable content.");
      }
    }

    private static YMap ObjectToYMap(JsonObject value, int depth)
    {
      GuardDepth(depth, "a data value");

      var entries = new List<KeyValuePair<string, object?>>();

      foreach (var (key, child) in value)
      {
        var mapKey = NoNul(key, "a data key");

        entries.Add(Pair(
            mapKey,
            IsOrderedIdArrayKey(mapKey) &&
                child is JsonArray idList &&
                !IsGridArray(idList) &&
                !IsIdentityArray(idList)
              ? PlainToYArray(idList, depth + 1)
              : PlainToYValue(child, depth + 1)));
      }

      return new YMap(entries);
    }

    /// <summary>
    /// A plain array as a <see cref="YArray"/>, element-wise, WHATEVER the
    /// elements are — empty and all-primitive included, unlike
    /// <c>PlainToYValue</c>. Only the ordered-id-array rule uses it; mirrors
    /// the client's <c>YBlockSerializer.plainToYArray</c>.
    /// </summary>
    internal static YArray PlainToYArray(JsonArray array, int depth)
    {
      GuardDepth(depth, "a data value");

      return new YArray(array.Select(element => PlainToYValue(element, depth + 1)));
    }

    /// <summary>
    /// The grid rule, then the array rule, then nested maps; primitives and
    /// non-convertible arrays stay atomic leaves.
    /// </summary>
    internal static object? PlainToYValue(JsonNode? value, int depth)
    {
      if (value is JsonArray array && IsConvertibleArray(array))
      {
        GuardDepth(depth, "a data value");

        if (IsGridArray(array))
        {
          return PlainToGridMap(array, depth);
        }

        // The identity rule, between the grid rule and the plain array rule,
        // exactly as the client orders them.
        if (IsIdentityArray(array))
        {
          return PlainToIdentityMap(array, depth);
        }

        return new YArray(array.Select(element => PlainToYValue(element, depth + 1)));
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
    /// A keyed wrapper from id-bearing objects, keyed by each element's own id.
    /// The SAME container shape a grid uses, so <see cref="IsGridMap"/> and the
    /// grid read path answer both identically; only the key SOURCE differs — an
    /// id is already stable across peers, so there is nothing to mint.
    ///
    /// Mirrors <c>plainToIdentityMap</c> in
    /// src/components/modules/yjs/serializer.ts.
    /// </summary>
    private static YMap PlainToIdentityMap(JsonArray elements, int depth)
    {
      var rowEntries = new List<KeyValuePair<string, object?>>();
      var order = new List<object?>();

      foreach (var element in elements)
      {
        // IsIdentityArray guarantees a non-empty string id on every element.
        var key = NoNul(element!["id"]!.GetValue<string>(), "a data key");

        // The wrapper adds a container level of its own, so an element costs
        // two levels — the same two the grid spends and the read walk expects.
        rowEntries.Add(Pair(key, PlainToYValue(element, depth + 2)));
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

    internal static bool IsConvertibleArray(JsonArray array)
    {
      return array.Count > 0 &&
          array.All(element => element is JsonObject or JsonArray);
    }

    /// <summary>
    /// The rows of a keyed grid: what <see cref="PlainToGridMap"/> is given.
    /// </summary>
    internal static bool IsGridArray(JsonArray array)
    {
      return IsConvertibleArray(array) && array.All(element => element is JsonArray);
    }

    /// <summary>
    /// An array whose elements ALL carry a unique, non-empty string <c>id</c>
    /// (a database's schema or views, a select's options) — and which is not a
    /// grid. Such an array takes the keyed wrapper too, keyed by the id.
    ///
    /// Same reason as the grid rule, one shape further out: a YArray has no
    /// move, so a positional diff writes a reorder as delete+insert, which
    /// recreates the element's map and lands a peer's concurrent field edit on
    /// whatever object took that index. Uniqueness is required — duplicate ids
    /// cannot address distinct containers — so such an array keeps the plain
    /// YArray behaviour instead.
    ///
    /// Mirrors <c>isIdentityArray</c> in
    /// src/components/modules/yjs/serializer.ts.
    /// </summary>
    internal static bool IsIdentityArray(JsonArray array)
    {
      if (!IsConvertibleArray(array) || IsGridArray(array))
      {
        return false;
      }

      var ids = new HashSet<string>(StringComparer.Ordinal);

      foreach (var element in array)
      {
        if (element is not JsonObject entry ||
            entry["id"] is not JsonValue id ||
            id.GetValueKind() != JsonValueKind.String)
        {
          return false;
        }

        var value = id.GetValue<string>();

        if (value.Length == 0 || !ids.Add(value))
        {
          return false;
        }
      }

      return true;
    }

    internal static string GenerateRowKey()
    {
      return new string(RandomNumberGenerator.GetItems<char>(RowKeyAlphabet, RowKeyLength));
    }

    private static KeyValuePair<string, object?> Pair(string key, object? value)
    {
      return new KeyValuePair<string, object?>(key, value);
    }
  }

  /// <summary>Whether a top-level block-data key holds mergeable text.</summary>
  private static bool IsDiffableTextKey(string key)
  {
    return Array.IndexOf(DiffableTextKeys, key) >= 0;
  }

  /// <summary>Whether a NESTED data key holds an ordered id list.</summary>
  private static bool IsOrderedIdArrayKey(string key)
  {
    return Array.IndexOf(OrderedIdArrayKeys, key) >= 0;
  }

  /// <summary>The value under a key, or null when the map has no live entry for it.</summary>
  private static object? Value(YMap map, string key)
  {
    return map.TryGet(key, out var value) ? value : null;
  }

  /// <summary>
  /// Both container keys must be present with the right shape, so a
  /// tool's plain object can never be mistaken for a grid.
  /// </summary>
  private static bool IsGridMap(YMap map)
  {
    return Value(map, GridRowsKey) is YMap && Value(map, GridOrderKey) is YArray;
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

  /// <summary>
  /// A block-data string bound for a <see cref="YText"/>, still as a string.
  /// A prelim YText holds its text privately and reads back empty, and the
  /// update path needs the string to diff against the doc.
  /// </summary>
  private sealed record MergeableText(string Value);

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
        if (entry is string id)
        {
          VisitBlock(id, null, hierarchy, seen, ordered);
        }
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
        ["data"] = YMapToObject(data, BlockFieldDepth),
      };

      Leave();

      if (Value(entry.Map, "tunes") is YMap { Count: > 0 } tunes)
      {
        Enter("tunes");
        block["tunes"] = YMapToObject(tunes, BlockFieldDepth);
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

        // A block's mergeable text: the JS client stores `data.text` as a
        // Y.Text so two peers typing in one block keep both edits, and renders
        // it as its string form (`JSON.stringify` calls the type's own
        // toJSON). This does the same, so the export shape is unchanged. Any
        // other shared type a foreign peer nests reads the same way rather
        // than making the room permanently unreadable.
        //
        // NOTE: the WRITE side mints one too, for the keys DiffableTextKeys
        // names. Any OTHER Y.Text is a foreign peer's, and reads the same way
        // rather than making the room permanently unreadable.
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

        // JSON.stringify of a Y.Doc is {} — a subdoc's content lives in its
        // own document, and its guid is not a value the record carries.
        case YSubdoc:
          plain = new JsonObject();

          return true;

        // JSON.stringify writes a Uint8Array as an index-keyed object, and
        // the client hands the consumer exactly that.
        case byte[] bytes:
          plain = BytesToObject(bytes);

          return true;

        // Wire refs 2 and 5 hand back parsed JSON. No Blok client writes
        // either, but a legacy or non-JS peer does, and the client reads them
        // as ordinary values.
        case JsonNode node:
          return TryReadWireJson(node, out plain);

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
    /// A wire JSON value, materialised now rather than when the export is
    /// written. System.Text.Json parses lazily, and it refuses to materialise
    /// a string a browser can legitimately put on the wire — an unpaired
    /// surrogate, which JSON.stringify escapes rather than drops. Left lazy,
    /// that failure lands in the save call, outside every guard here, and
    /// costs the whole record rather than the one value.
    /// </summary>
    private static bool TryReadWireJson(JsonNode node, out JsonNode? plain)
    {
      plain = null;

      try
      {
        plain = JsonNode.Parse(node.ToJsonString(), null, YContent.JsonLimits);
      }
      catch (InvalidOperationException)
      {
        return false;
      }

      return true;
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

  }
}
