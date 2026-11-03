using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// YDocConverter.ApplyOps, captured into fixtures/collab-edits/cases.json.
/// Each case seeds a doc as client 1, applies the ops as client 2 and records
/// the update the transaction emits, byte for byte, plus the export. A refusal
/// records its message and that nothing was written. The Go server must emit
/// the same bytes (internal/collab/convert/apply_test.go): the bytes are what
/// a peer merges, so they pin which containers an edit keeps.
/// Grid row keys are minted from a counter (YDocConverter.RowKeySource), so a
/// case that adds a row has fixed bytes too. HTML in the ops is read by
/// the runtime here and recorded with its segments, so Go needs no runtime.
/// Set BLOK_WRITE_COLLAB_EDITS=1 to rewrite the file after an intended change.
/// </summary>
public sealed class YDocConverterEditCaptureTests
{
  private const string FileName = "collab-edits/cases.json";
  private const uint SeedClient = 1;
  private const uint EditClient = 2;

  [Fact]
  public void TheCaptureMatchesApplyOps()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_EDITS") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_EDITS=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private sealed record EditCase(
      string Name,
      string[] Seed,
      string? Body = null,
      string? Agent = null,
      string? Shape = null,
      string? Page = null,
      string? Prior = null,
      string? Peer = null);

  private static JsonObject Build()
  {
    var cases = new JsonArray();

    foreach (var edit in Cases().Concat(ConcurrencyCases()))
    {
      cases.Add(Capture(edit));
    }

    return new JsonObject
    {
      ["$comment"] = "Captured from C# by YDocConverterEditCaptureTests. Do not edit by hand.",
      ["seedClient"] = SeedClient,
      ["editClient"] = EditClient,
      ["cases"] = cases,
    };
  }

  private static JsonObject Capture(EditCase edit)
  {
    var seedUpdate = SeedUpdate(edit);
    var peerUpdate = edit.Peer is null ? null : PeerUpdate(edit, seedUpdate);
    var first = Run(edit, seedUpdate, peerUpdate);
    var second = Run(edit, seedUpdate, peerUpdate);
    var result = new JsonObject
    {
      ["name"] = edit.Name,
      ["seed"] = JsonNode.Parse("[" + string.Join(",", edit.Seed) + "]"),
    };

    if (edit.Page is not null)
    {
      result["page"] = JsonNode.Parse(edit.Page);
    }

    if (edit.Shape is not null)
    {
      result["shape"] = edit.Shape;
    }

    if (edit.Prior is not null)
    {
      result["prior"] = edit.Prior;
    }

    result["seedUpdate"] = Convert.ToBase64String(seedUpdate);

    // The seed's HTML as the runtime read it, so Go can seed with no runtime
    // and compare the seed bytes too.
    var seedBlocks = (JsonArray)result["seed"]!;
    var seedFound = YDocConverter.CollectSeedHtml(seedBlocks, RichTextFields.BuiltIn);

    if (seedFound.Count > 0)
    {
      var seedSegments = RichTextRuntime.Reader.ReadAsync(seedFound).AsTask().GetAwaiter().GetResult();
      result["seedHtml"] = new JsonArray([.. seedFound.Select((found, index) => (JsonNode)new JsonObject
      {
        ["html"] = found.Html,
        ["segments"] = seedSegments[index].DeepClone(),
      })]);
    }

    if (edit.Body is not null)
    {
      result["body"] = edit.Body;
    }

    if (edit.Agent is not null)
    {
      result["agent"] = JsonNode.Parse(edit.Agent);
    }

    if (first.Html.Count > 0)
    {
      result["html"] = first.Html;
    }

    if (first.Refused is not null)
    {
      result["refused"] = first.Refused;

      return result;
    }

    Assert.Equal(first.Updates, second.Updates);
    result["updates"] = new JsonArray([.. first.Updates.Select(update => (JsonNode)update)]);

    result["export"] = first.Export;
    result["exportPage"] = YDocConverter.ExportPage(first.Doc);

    if (peerUpdate is not null)
    {
      // The peer's concurrent edit, made on the seeded doc before this one,
      // and the doc after both merge.
      result["peerUpdate"] = Convert.ToBase64String(peerUpdate);
      result["mergedExport"] = first.Merged;
    }

    return result;
  }

  private sealed record Outcome(
      YDoc Doc, List<string> Updates, JsonArray Html, JsonObject? Refused, JsonArray? Export = null, JsonArray? Merged = null);

  private static Outcome Run(EditCase edit, byte[] seedUpdate, byte[]? peerUpdate)
  {
    var doc = new YDoc(EditClient);

    YDocConverter.RowKeySource.Value = Counter("e");

    doc.ApplyUpdate(seedUpdate);

    var updates = new List<string>();
    var vector = Convert.ToBase64String(doc.EncodeStateVector());

    doc.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        updates.Add(Convert.ToBase64String(update.Update));
      }
    };

    var html = new JsonArray();

    try
    {
      var ops = Ops(edit);
      var found = YDocConverter.CollectOpsHtml(doc, ops, RichTextFields.BuiltIn);
      var segments = RichTextRuntime.Reader.ReadAsync(found).AsTask().GetAwaiter().GetResult();
      var table = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

      for (var index = 0; index < found.Count; index++)
      {
        table[found[index].Html] = segments[index];
        html.Add(new JsonObject { ["html"] = found[index].Html, ["segments"] = segments[index].DeepClone() });
      }

      YDocConverter.ApplyOps(doc, ops, RichTextInput.Converting(RichTextFields.BuiltIn, table));
    }
    catch (Exception refusal) when (refusal is CollabEditException or InvalidDataException)
    {
      // Two-phase: a refused request writes nothing at all.
      Assert.Empty(updates);
      Assert.Equal(vector, Convert.ToBase64String(doc.EncodeStateVector()));

      return new Outcome(doc, updates, html, new JsonObject
      {
        ["kind"] = refusal is CollabEditException ? "edit" : "data",
        ["message"] = refusal.Message,
      });
    }

    Assert.True(updates.Count <= 1, $"{edit.Name}: one request emits at most one update");

    var exported = YDocConverter.Export(doc);
    JsonArray? merged = null;

    if (peerUpdate is not null)
    {
      Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(peerUpdate).Outcome);
      merged = YDocConverter.Export(doc);
    }

    return new Outcome(doc, updates, html, null, exported, merged);
  }

  private static byte[] SeedUpdate(EditCase edit)
  {
    var doc = new YDoc(SeedClient);

    YDocConverter.RowKeySource.Value = Counter("s");

    var blocks = (JsonArray)JsonNode.Parse("[" + string.Join(",", edit.Seed) + "]")!;

    RichTextRuntime.Seed(doc, blocks, edit.Page is null ? null : (JsonObject)JsonNode.Parse(edit.Page)!);

    if (edit.Shape is not null)
    {
      Shapes[edit.Shape](doc);
    }

    if (edit.Prior is not null)
    {
      RichTextRuntime.ApplyOps(doc, CollabEditOps.Parse(Encoding.UTF8.GetBytes(edit.Prior)));
    }

    return doc.EncodeStateAsUpdate();
  }

  private const uint PeerClient = 3;

  /// <summary>A peer's edit on the seeded doc, as the update it sends.</summary>
  private static byte[] PeerUpdate(EditCase edit, byte[] seedUpdate)
  {
    var peer = new YDoc(PeerClient);

    YDocConverter.RowKeySource.Value = Counter("p");
    Assert.Equal(ApplyOutcome.Applied, peer.ApplyUpdate(seedUpdate).Outcome);

    var before = peer.EncodeStateVector();

    Peers[edit.Peer!](peer);

    return peer.EncodeStateAsUpdate(before);
  }

  private static YMap Cell(YDoc doc, int row, int column)
  {
    var grid = (YMap)Get(Data(doc, "tb"), "content")!;
    var rows = (YMap)Get(grid, "__rows")!;
    var order = (YArray)Get(grid, "__rowKeys")!;

    return (YMap)((YArray)Get(rows, (string)order.Get(row)!)!).Get(column)!;
  }

  private static void PeerEdit(YDoc peer, string body)
  {
    RichTextRuntime.ApplyOps(peer, CollabEditOps.Parse(Encoding.UTF8.GetBytes(body)));
  }

  /// <summary>Peer edits, from YDocConverterConcurrentLossTests and TableDataLossAuditTests.</summary>
  private static readonly Dictionary<string, Action<YDoc>> Peers = new(StringComparer.Ordinal)
  {
    ["types-in-a-cell"] = peer =>
        peer.Transact(t => Cell(peer, 0, 0).Set(t, "text", "a1 typed")),
    ["adds-a-block-to-a-cell"] = peer =>
        peer.Transact(t => ((YArray)Get(Cell(peer, 0, 0), "blocks")!).Insert(t, 1, ["p2"])),
    ["sets-a-nested-colour"] = peer =>
        peer.Transact(t => ((YMap)Get(Data(peer, "cb"), "settings")!).Set(t, "colour", "red")),
    ["renames-property-p2"] = peer => peer.Transact(t =>
        ((YMap)Get((YMap)Get((YMap)Get(Data(peer, "db"), "properties")!, "__rows")!, "p2")!).Set(t, "name", "State")),
    ["renames-property-p3"] = peer => peer.Transact(t =>
        ((YMap)Get((YMap)Get((YMap)Get(Data(peer, "db"), "properties")!, "__rows")!, "p3")!).Set(t, "name", "Assignee")),
    ["types-at-the-start"] = peer =>
        peer.Transact(t => ((YXmlText)Get(Data(peer, "p"), "text")!).Insert(t, 0, "X", new AnyObject())),
    ["types-at-the-end-of-a-ytext"] = peer =>
        peer.Transact(t => ((YText)Get(Data(peer, "p"), "text")!).Insert(t, 5, " world")),
    ["adds-an-align-key"] = peer =>
        peer.Transact(t => Data(peer, "p").Set(t, "align", "center")),
    ["moves-the-row"] = peer =>
        peer.Transact(t => Data(peer, "r").Set(t, "position", "a5")),
    ["marks-body-blocks"] = peer =>
        peer.Transact(t => Data(peer, "r").Set(t, "bodyBlocks", true)),
    ["edits-the-third-item"] = peer =>
        peer.Transact(t => ((YMap)((YArray)Get(Data(peer, "x"), "items")!).Get(2)!).Set(t, "b", "peer")),
    ["adds-filter-rule-ra"] = peer => PeerEdit(peer, Edit(FilterUpdate(
        """[{ "id": "ra", "propertyId": "t", "operator": "contains", "value": "a" }]"""))),
    ["adds-column-c3"] = peer => PeerEdit(peer, Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c3", "rowId": "r0", "blocks": [] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c3", "rowId": "r1", "blocks": [] } ] ] } }
        """)),
    ["moves-column-c2-first"] = peer => PeerEdit(peer, Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
          [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ] } }
        """)),
  };

  /// <summary>Row keys "s000000001", "e000000001"...: ten characters, like a minted key.</summary>
  private static Func<string> Counter(string prefix)
  {
    var next = 0;

    return () => prefix + (++next).ToString("D9", System.Globalization.CultureInfo.InvariantCulture);
  }

  /// <summary>Peer writes no seed can make, done with the engine directly.</summary>
  private static readonly Dictionary<string, Action<YDoc>> Shapes = new(StringComparer.Ordinal)
  {
    ["order-holds-a-number-first"] = doc =>
        doc.Transact(t => doc.GetArray("root").Insert(t, 0, [1d])),
    ["order-lists-root-twice"] = doc =>
        doc.Transact(t => doc.GetArray("root").Insert(t, 2, ["root"])),
    ["order-emptied"] = doc =>
        doc.Transact(t => doc.GetArray("root").Delete(t, 0, doc.GetArray("root").Count)),
    ["bare-block-without-content-ids"] = doc =>
        doc.Transact(t => doc.GetMap("blocks").Set(t, "bare", new YMap(
        [
          new("id", "bare"),
          new("type", "toggle"),
          new("data", new YMap()),
        ]))),
    ["junk-entry-in-blocks"] = doc =>
        doc.Transact(t => doc.GetMap("blocks").Set(t, "junk", "not a block")),
    ["legacy-plain-text-under-rich-key"] = doc =>
        doc.Transact(t => Data(doc, "root").Set(t, "text", new YText("legacy words"))),
    ["legacy-ytext-caption"] = doc =>
        doc.Transact(t => Data(doc, "img").Set(t, "caption", new YText("a red fox"))),
    ["data-is-not-a-map"] = doc =>
        doc.Transact(t => Block(doc, "root").Set(t, "data", "oops")),
    ["listed-by-a-non-parent"] = doc =>
        doc.Transact(t => ((YArray)Get(Block(doc, "other"), "contentIds")!).Insert(t, 0, ["kid"])),
    ["children-re-added-out-of-order"] = doc =>
    {
      var blocks = doc.GetMap("blocks");

      doc.Transact(t =>
      {
        foreach (var id in new[] { "c2", "c1", "c3" })
        {
          blocks.Set(t, id, new YMap(
          [
            new("id", id),
            new("type", "paragraph"),
            new("data", new YMap()),
            new("parentId", "holder"),
          ]));
        }
      });
      doc.Transact(t => blocks.Remove(t, "c2"));
      doc.Transact(t => blocks.Set(t, "c2", new YMap(
      [
        new("id", "c2"),
        new("type", "paragraph"),
        new("data", new YMap()),
        new("parentId", "holder"),
      ])));
    },
    ["foreign-xml-under-data"] = doc =>
        doc.Transact(t => Data(doc, "cb").Set(t, "settings", new YXmlText("foreign"))),
  };

  private static object? Get(YMap map, string key)
  {
    return map.TryGet(key, out var value) ? value : null;
  }

  private static YMap Block(YDoc doc, string id)
  {
    return (YMap)Get(doc.GetMap("blocks"), id)!;
  }

  private static YMap Data(YDoc doc, string id)
  {
    return (YMap)Get(Block(doc, id), "data")!;
  }

  private static IReadOnlyList<CollabEditOp> Ops(EditCase edit)
  {
    if (edit.Body is not null)
    {
      return CollabEditOps.Parse(Encoding.UTF8.GetBytes(edit.Body));
    }

    var ops = new List<CollabEditOp>();

    foreach (var node in JsonNode.Parse(edit.Agent!)!.AsArray())
    {
      ops.Add(AgentOp(node!.AsObject()));
    }

    return ops;
  }

  /// <summary>The agent-only ops from a small JSON shape; insert, update and remove go through the /edit parser.</summary>
  private static CollabEditOp AgentOp(JsonObject op)
  {
    string Text(string key) => op[key]!.GetValue<string>();
    string? Maybe(string key) => op[key]?.GetValue<string>();

    switch (Text("op"))
    {
      case "move":
        return new CollabEditOp.Move(Text("id"), Maybe("after"), Maybe("parent"));
      case "lift":
        return new CollabEditOp.Lift(Text("id"));
      case "retype":
        return new CollabEditOp.Retype(Text("id"), Text("type"), op["data"]!.DeepClone().AsObject());
      case "setTunes":
        return new CollabEditOp.SetTunes(Text("id"), op["tunes"]!.DeepClone().AsObject());
      case "setMetadata":
        return new CollabEditOp.SetMetadata(
            Text("id"), op["lastEditedAt"]!.GetValue<double>(), Text("lastEditedBy"), Maybe("lastEditedWith"));
      case "setPageField":
        return new CollabEditOp.SetPageField(Text("key"), op["value"]?.DeepClone());
      case "patchMaps":
        return new CollabEditOp.PatchMaps([.. op["patches"]!.AsArray().Select(patch => new CollabMapPatch(
            patch!["map"]!.GetValue<string>(),
            patch["key"]!.GetValue<string>(),
            Engine(patch["value"]),
            patch["remove"]?.GetValue<bool>() ?? false))]);
      default:
        return CollabEditOps.Parse(Encoding.UTF8.GetBytes($$"""{"ops":[{{op.ToJsonString()}}]}"""))[0];
    }
  }

  /// <summary>JSON as an engine value, the shape restore hands a map patch.</summary>
  private static object? Engine(JsonNode? node)
  {
    switch (node)
    {
      case null:
        return null;
      case JsonObject map:
        var entries = new AnyObject();

        foreach (var (key, value) in map)
        {
          entries.Add(key, Engine(value));
        }

        return entries;
      case JsonArray array:
        var items = new AnyArray();

        foreach (var item in array)
        {
          items.Add(Engine(item));
        }

        return items;
    }

    var leaf = node.AsValue();

    return leaf.GetValueKind() switch
    {
      JsonValueKind.String => leaf.GetValue<string>(),
      JsonValueKind.True => true,
      JsonValueKind.False => false,
      _ => leaf.GetValue<double>(),
    };
  }

  private const string Root = """{ "id": "root", "type": "paragraph", "data": { "text": "r" } }""";
  private const string Second = """{ "id": "second", "type": "paragraph", "data": { "text": "s" } }""";
  private const string Toggle = """{ "id": "tg", "type": "toggle", "data": { "text": "t" }, "content": ["k1", "k2"] }""";
  private const string Kid1 = """{ "id": "k1", "type": "paragraph", "data": { "text": "one" }, "parent": "tg" }""";
  private const string Kid2 = """{ "id": "k2", "type": "paragraph", "data": { "text": "two" }, "parent": "tg" }""";
  private const string Table =
      """
      { "id": "tb", "type": "table", "data": { "withHeadings": false, "content": [
          [ { "text": "a1", "blocks": ["p1"] }, { "text": "b1", "blocks": [] } ],
          [ { "text": "a2", "blocks": [] }, { "text": "b2", "blocks": [] } ] ] } }
      """;
  private const string RowIdTable =
      """
      { "id": "tb", "type": "table", "data": { "content": [
          [ { "rowId": "r1", "text": "a1" }, { "rowId": "r1", "text": "b1" } ],
          [ { "rowId": "r2", "text": "a2" }, { "rowId": "r2", "text": "b2" } ] ] } }
      """;
  private const string Database =
      """
      { "id": "db", "type": "database", "data": {
          "schema": [ { "id": "p1", "name": "Name", "type": "title" },
                      { "id": "p2", "name": "Status", "type": "select", "options": [ { "id": "o1", "name": "Todo" } ] } ],
          "views": [ { "id": "v1", "type": "table", "filters": [], "sorts": [], "calculations": [] } ],
          "properties": { "tags": [], "people": [ "u1" ] } } }
      """;
  private const string Callout =
      """{ "id": "cb", "type": "callout", "data": { "settings": { "icon": "star", "colour": "blue" }, "count": 1, "ratio": 0.1, "big": 9007199254740992 } }""";
  private const string Image =
      """{ "id": "img", "type": "image", "data": { "url": "https://x.test/a.png", "caption": "a fox" } }""";

  private static string Edit(params string[] ops) => $$"""{"ops":[{{string.Join(",", ops)}}]}""";

  private static IEnumerable<EditCase> Cases()
  {
    // Insert.
    yield return new("insert-first", [Root, Second],
        Edit("""{"op":"insert","id":"new","block":{"type":"header","data":{}}}"""));
    yield return new("insert-after-a-sibling", [Root, Second],
        Edit("""{"op":"insert","id":"new","after":"root","block":{"type":"header","data":{"text":"n","level":2}}}"""));
    yield return new("insert-under-a-parent-after-a-child", [Toggle, Kid1, Kid2],
        Edit("""{"op":"insert","id":"new","parent":"tg","after":"k1","block":{"type":"paragraph","data":{"text":"n"}}}"""));
    yield return new("insert-under-a-parent-first", [Toggle, Kid1, Kid2],
        Edit("""{"op":"insert","id":"new","parent":"tg","block":{"type":"paragraph","data":{"text":"n"}}}"""));
    yield return new("insert-with-tunes-and-co-authors", [Root],
        Edit("""{"op":"insert","id":"new","after":"root","block":{"type":"paragraph","data":{"text":"x"},"tunes":{"align":"center"},"lastEditedBy":"u1","lastEditedAt":5}}"""));
    yield return new("insert-a-table", [Root],
        Edit("""{"op":"insert","id":"t2","after":"root","block":{"type":"table","data":{"content":[[{"rowId":"x","text":"1"}]]}}}"""));
    yield return new("later-ops-see-earlier-ones", [Root],
        Edit(
            """{"op":"insert","id":"a","after":"root","block":{"type":"toggle","data":{}}}""",
            """{"op":"insert","id":"b","parent":"a","block":{"type":"paragraph","data":{}}}""",
            """{"op":"update","id":"b","data":{"text":"bee"}}""",
            """{"op":"insert","id":"c","parent":"a","after":"b","block":{"type":"paragraph","data":{"text":"c"}}}"""));
    yield return new("insert-after-a-number-slot", [Root, Second],
        Edit("""{"op":"insert","id":"new","after":"second","block":{"type":"paragraph","data":{}}}"""),
        Shape: "order-holds-a-number-first");

    // Insert refusals.
    yield return new("refuse-insert-duplicate-id", [Root],
        Edit("""{"op":"insert","id":"root","block":{"type":"paragraph","data":{}}}"""));
    yield return new("refuse-insert-unknown-parent", [Root],
        Edit("""{"op":"insert","id":"new","parent":"nope","block":{"type":"paragraph","data":{}}}"""));
    yield return new("refuse-insert-unknown-after", [Root],
        Edit("""{"op":"insert","id":"new","after":"nope","block":{"type":"paragraph","data":{}}}"""));
    yield return new("refuse-insert-after-not-a-child", [Toggle, Kid1, Kid2, Root],
        Edit("""{"op":"insert","id":"new","parent":"tg","after":"root","block":{"type":"paragraph","data":{}}}"""));
    yield return new("refuse-insert-after-a-child-at-the-root", [Toggle, Kid1, Kid2],
        Edit("""{"op":"insert","id":"new","after":"k1","block":{"type":"paragraph","data":{}}}"""));
    yield return new("refuse-insert-after-outside-the-order", [Root],
        Edit("""{"op":"insert","id":"new","after":"root","block":{"type":"paragraph","data":{}}}"""),
        Shape: "order-emptied");
    yield return new("refuse-insert-under-a-parent-without-a-list", [Root],
        Edit("""{"op":"insert","id":"new","parent":"bare","block":{"type":"paragraph","data":{}}}"""),
        Shape: "bare-block-without-content-ids");
    yield return new("refuse-insert-under-junk", [Root],
        Edit("""{"op":"insert","id":"new","parent":"junk","block":{"type":"paragraph","data":{}}}"""),
        Shape: "junk-entry-in-blocks");
    yield return new("refuse-a-later-invalid-op-writes-nothing", [Root],
        Edit(
            """{"op":"insert","id":"new","after":"root","block":{"type":"paragraph","data":{}}}""",
            """{"op":"remove","id":"ghost"}"""));
    yield return new("update-reads-html", [Root],
        Edit("""{"op":"update","id":"root","data":{"text":"r <b>bold</b> &amp; more"}}"""));

    // Update.
    yield return new("update-replaces-the-data", [Root, Second],
        Edit("""{"op":"update","id":"root","data":{"text":"x","level":2}}"""));
    yield return new("update-normalizes-empty-paragraph-data", [Root],
        Edit("""{"op":"update","id":"root","data":{}}"""));
    yield return new("update-with-the-same-text-writes-nothing", [Root],
        Edit("""{"op":"update","id":"root","data":{"text":"r"}}"""));
    yield return new("update-edits-rich-text-in-place", [
        """{ "id": "root", "type": "paragraph", "data": { "text": "hello world" } }"""],
        Edit("""{"op":"update","id":"root","data":{"text":[{"text":"hello "},{"text":"brave","bold":true},{"text":" world"}]}}"""));
    yield return new("update-replaces-legacy-plain-text-with-rich-text", [Root],
        Edit("""{"op":"update","id":"root","data":{"text":"legacy words!"}}"""),
        Shape: "legacy-plain-text-under-rich-key");
    yield return new("update-diffs-a-plain-ytext", [Image],
        Edit("""{"op":"update","id":"img","data":{"url":"https://x.test/a.png","caption":"a quick red fox"}}"""),
        Shape: "legacy-ytext-caption");
    yield return new("update-caption-becomes-a-ytext", [Image],
        Edit("""{"op":"update","id":"img","data":{"url":"https://x.test/b.png","caption":"a fox!"}}"""));
    yield return new("update-drops-omitted-keys", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"star"}}}"""));
    yield return new("update-over-data-that-is-not-a-map", [Root],
        Edit("""{"op":"update","id":"root","data":{"text":"x"}}"""),
        Shape: "data-is-not-a-map");
    yield return new("update-over-a-foreign-xml-value", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"moon"},"count":1,"ratio":0.1,"big":9007199254740992}}"""),
        Shape: "foreign-xml-under-data");
    yield return new("refuse-update-unknown-block", [Root],
        Edit("""{"op":"update","id":"nope","data":{}}"""));
    yield return new("refuse-update-junk", [Root],
        Edit("""{"op":"update","id":"junk","data":{}}"""),
        Shape: "junk-entry-in-blocks");
    yield return new("refuse-update-nested-too-deep", [Root],
        Edit("""{"op":"update","id":"root","data":{"x":""" + new string('[', 300) + new string(']', 300) + "}}"));

    // Numbers: the live value against the request's number text.
    yield return new("numbers-equal-by-value-write-nothing", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"star","colour":"blue"},"count":1.0,"ratio":0.10000000000000001,"big":9007199254740992.0}}"""));
    // 2^53 is still a long on the live side, so the text is compared by exact
    // decimal value: ...993 is a different number even though it is the same double.
    yield return new("numbers-at-2-pow-53-compare-by-decimal-value", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"star","colour":"blue"},"count":1,"ratio":0.1,"big":9007199254740993}}"""));
    yield return new("numbers-that-differ-in-decimal-are-written", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"star","colour":"blue"},"count":1.0000000000000000001,"ratio":1e2,"big":1e400}}"""));
    yield return new("numbers-in-exponent-form", [Callout],
        Edit("""{"op":"update","id":"cb","data":{"settings":{"icon":"star","colour":"blue"},"count":1e0,"ratio":1E-1,"big":-0}}"""));

    // Remove.
    yield return new("remove-takes-the-subtree", [Toggle, Kid1, Kid2, Root],
        Edit("""{"op":"remove","id":"tg"}"""));
    yield return new("remove-a-child-unlinks-it", [Toggle, Kid1, Kid2],
        Edit("""{"op":"remove","id":"k1"}"""));
    yield return new("remove-takes-an-unlisted-child", [
        """{ "id": "tg", "type": "toggle", "data": {}, "content": [] }""",
        """{ "id": "k1", "type": "paragraph", "data": {}, "parent": "tg" }""", Root],
        Edit("""{"op":"remove","id":"tg"}"""));
    yield return new("remove-keeps-a-listed-block-naming-another-parent", [
        """{ "id": "tg", "type": "toggle", "data": {}, "content": ["k1"] }""",
        """{ "id": "other", "type": "toggle", "data": {}, "content": [] }""",
        """{ "id": "k1", "type": "paragraph", "data": {}, "parent": "other" }"""],
        Edit("""{"op":"remove","id":"tg"}"""));
    yield return new("remove-clears-a-non-parent-listing", [
        """{ "id": "tg", "type": "toggle", "data": {}, "content": ["kid"] }""",
        """{ "id": "other", "type": "toggle", "data": {}, "content": [] }""",
        """{ "id": "kid", "type": "paragraph", "data": {}, "parent": "tg" }"""],
        Edit("""{"op":"remove","id":"kid"}"""),
        Shape: "listed-by-a-non-parent");
    yield return new("remove-then-reinsert-the-same-id", [Root, Second],
        Edit(
            """{"op":"remove","id":"root"}""",
            """{"op":"insert","id":"root","after":"second","block":{"type":"paragraph","data":{"text":"again"}}}"""));
    yield return new("remove-a-block-inserted-earlier", [Toggle, Kid1, Kid2],
        Edit(
            """{"op":"insert","id":"new","parent":"tg","after":"k2","block":{"type":"paragraph","data":{}}}""",
            """{"op":"remove","id":"new"}"""));
    yield return new("remove-a-parent-spares-a-child-reinserted-elsewhere", [Toggle, Kid1, Kid2],
        Edit(
            """{"op":"remove","id":"k1"}""",
            """{"op":"insert","id":"k1","after":"tg","block":{"type":"paragraph","data":{"text":"moved"}}}""",
            """{"op":"remove","id":"tg"}"""));
    yield return new("remove-with-a-number-in-the-order", [Root, Second],
        Edit("""{"op":"remove","id":"root"}"""),
        Shape: "order-holds-a-number-first");
    yield return new("remove-every-duplicate-order-entry", [Root, Second],
        Edit("""{"op":"remove","id":"root"}"""),
        Shape: "order-lists-root-twice");
    yield return new("remove-junk", [Root],
        Edit("""{"op":"remove","id":"junk"}"""),
        Shape: "junk-entry-in-blocks");
    yield return new("refuse-remove-unknown", [Root],
        Edit("""{"op":"remove","id":"nope"}"""));

    // Tables and grids.
    yield return new("table-edit-one-cell", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a1","blocks":["p1"]},{"text":"b1 host","blocks":[]}],[{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-add-a-block-to-a-cell", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a1","blocks":["p1","p3"]},{"text":"b1","blocks":[]}],[{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-swap-rows", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}],[{"text":"a1","blocks":["p1"]},{"text":"b1","blocks":[]}]]}}"""));
    yield return new("table-remove-a-row", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-add-a-row-mints-a-key", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a1","blocks":["p1"]},{"text":"b1","blocks":[]}],[{"text":"new","blocks":[]},{"text":"row","blocks":[]}],[{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-insert-a-column", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"x","blocks":[]},{"text":"a1","blocks":["p1"]},{"text":"b1","blocks":[]}],[{"text":"y","blocks":[]},{"text":"a2","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-delete-a-column", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"b1","blocks":[]}],[{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-change-a-row-and-insert-above-it", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[[{"text":"a1","blocks":["p1"]},{"text":"b1","blocks":[]}],[{"text":"n","blocks":[]},{"text":"m","blocks":[]}],[{"text":"a2 edited","blocks":[]},{"text":"b2","blocks":[]}]]}}"""));
    yield return new("table-emptied", [Table],
        Edit("""{"op":"update","id":"tb","data":{"withHeadings":false,"content":[]}}"""));
    yield return new("row-id-table-add-a-row", [RowIdTable],
        Edit("""{"op":"update","id":"tb","data":{"content":[[{"rowId":"r1","text":"a1"},{"rowId":"r1","text":"b1"}],[{"rowId":"r3","text":"a3"},{"rowId":"r3","text":"b3"}],[{"rowId":"r2","text":"a2"},{"rowId":"r2","text":"b2"}]]}}"""));
    yield return new("row-id-table-reorder-and-edit", [RowIdTable],
        Edit("""{"op":"update","id":"tb","data":{"content":[[{"rowId":"r2","text":"a2!"},{"rowId":"r2","text":"b2"}],[{"rowId":"r1","text":"a1"},{"rowId":"r1","text":"b1"}]]}}"""));
    yield return new("row-id-table-reuses-a-freed-key", [RowIdTable],
        Edit("""{"op":"update","id":"tb","data":{"content":[[{"rowId":"r1","text":"z"},{"rowId":"r1","text":"z"}],[{"rowId":"r2","text":"a2"},{"rowId":"r2","text":"b2"}]]}}"""));
    yield return new("grid-becomes-an-identity-list", [RowIdTable],
        Edit("""{"op":"update","id":"tb","data":{"content":[{"id":"e1","v":1},{"id":"e2","v":2}]}}"""));
    yield return new("grid-becomes-a-leaf", [RowIdTable],
        Edit("""{"op":"update","id":"tb","data":{"content":"flat"}}"""));

    // Databases: identity lists, ordered ids, list slots.
    yield return new("database-rename-a-property", [Database],
        Edit("""{"op":"update","id":"db","data":{"schema":[{"id":"p1","name":"Title","type":"title"},{"id":"p2","name":"Status","type":"select","options":[{"id":"o1","name":"Todo"}]}],"views":[{"id":"v1","type":"table","filters":[],"sorts":[],"calculations":[]}],"properties":{"tags":[],"people":["u1"]}}}"""));
    yield return new("database-reorder-properties", [Database],
        Edit("""{"op":"update","id":"db","data":{"schema":[{"id":"p2","name":"Status","type":"select","options":[{"id":"o1","name":"Todo"}]},{"id":"p1","name":"Name","type":"title"}],"views":[{"id":"v1","type":"table","filters":[],"sorts":[],"calculations":[]}],"properties":{"tags":[],"people":["u1"]}}}"""));
    yield return new("database-add-a-filter-and-a-sort", [Database],
        Edit("""{"op":"update","id":"db","data":{"schema":[{"id":"p1","name":"Name","type":"title"},{"id":"p2","name":"Status","type":"select","options":[{"id":"o1","name":"Todo"}]}],"views":[{"id":"v1","type":"table","filters":[{"id":"f1","property":"p2"}],"sorts":["p1"],"calculations":[]}],"properties":{"tags":[],"people":["u1"]}}}"""));
    yield return new("database-list-slots", [Database],
        Edit("""{"op":"update","id":"db","data":{"schema":[{"id":"p1","name":"Name","type":"title"},{"id":"p2","name":"Status","type":"select","options":[{"id":"o1","name":"Todo"}]}],"views":[{"id":"v1","type":"table","filters":[],"sorts":[],"calculations":[]}],"properties":{"tags":[{"id":"t1","name":"red"}],"people":[],"fresh":[]}}}"""));
    yield return new("database-delete-a-property-and-add-one", [Database],
        Edit("""{"op":"update","id":"db","data":{"schema":[{"id":"p1","name":"Name","type":"title"},{"id":"p3","name":"Due","type":"date"}],"views":[{"id":"v1","type":"table","filters":[],"sorts":[],"calculations":[]}],"properties":{"tags":[],"people":["u1"]}}}"""));
    yield return new("top-level-blocks-keep-the-generic-rule", [
        """{ "id": "cu", "type": "custom", "data": { "blocks": ["a", "b"], "items": [{"k":1},{"k":2},{"k":3}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"blocks":["a","c","b"],"items":[{"k":1},{"k":9},{"k":2},{"k":3}]}}"""));
    yield return new("arrays-pair-elements-by-similarity", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"a":1,"b":2,"c":3},{"a":4,"b":5,"c":6}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"a":1,"b":2,"c":30},{"a":7,"b":8,"c":9},{"a":4,"b":5,"c":6}]}}"""));
    yield return new("arrays-reorder-splices", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"a":1},{"a":2},{"a":3}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"a":3},{"a":1}]}}"""));
    yield return new("arrays-numbers-pair-by-value", [
        """{ "id": "cu", "type": "custom", "data": { "items": [[1,2],[3,4]] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[[1.0,2.0],[5,6],[3e0,4]]}}"""));

    yield return new("update-replaces-a-word-in-a-plain-ytext", [Image],
        Edit("""{"op":"update","id":"img","data":{"url":"https://x.test/a.png","caption":"a blue fox"}}"""),
        Shape: "legacy-ytext-caption");
    yield return new("arrays-keep-an-unchanged-element-between-changed-ones", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"a":1},{"b":2},{"c":3}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"a":10},{"b":2},{"c":30}]}}"""));
    yield return new("arrays-similarity-picks-the-later-element", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"x":1,"y":1}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"p":9},{"x":1,"y":2}]}}"""));
    yield return new("arrays-refuse-a-crossing-rank-pair", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"a":1},{"a":2},{"a":3}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"a":3},{"b":9}]}}"""));
    yield return new("arrays-similarity-window-reaches-the-count-difference", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"t":0},{"t":1},{"t":2},{"x":5,"t":3}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"x":5,"t":9},{"u":1}]}}"""));

    yield return new("ordered-ids-keep-an-unchanged-id-between-changed-ones", [
        """{ "id": "cu", "type": "custom", "data": { "cell": { "blocks": ["a", "b", "c"] } } }"""],
        Edit("""{"op":"update","id":"cu","data":{"cell":{"blocks":["x","b","y"]}}}"""));

    yield return new("arrays-an-element-that-gained-a-key-is-not-equal", [
        """{ "id": "cu", "type": "custom", "data": { "items": [{"a":1},{"b":2}] } }"""],
        Edit("""{"op":"update","id":"cu","data":{"items":[{"a":1,"z":0},{"b":2},{"c":3}]}}"""));

    // Agent ops.
    yield return new("move-into-a-parent-first", [Toggle, Kid1, Kid2, Root],
        Agent: """[{"op":"move","id":"root","parent":"tg"}]""");
    yield return new("move-a-child-to-the-root-after", [Toggle, Kid1, Kid2, Root],
        Agent: """[{"op":"move","id":"k1","after":"root"}]""");
    yield return new("move-within-a-parent", [Toggle, Kid1, Kid2],
        Agent: """[{"op":"move","id":"k1","parent":"tg","after":"k2"}]""");
    yield return new("move-then-anchor-on-it", [Toggle, Kid1, Kid2, Root],
        Agent: """[{"op":"move","id":"k2","after":"root"},{"op":"insert","id":"new","after":"k2","block":{"type":"paragraph","data":{}}}]""");
    yield return new("move-survives-its-old-parents-removal", [Toggle, Kid1, Kid2, Root],
        Agent: """[{"op":"move","id":"k1","after":"root"},{"op":"remove","id":"tg"}]""");
    yield return new("refuse-move-inside-itself", [Toggle, Kid1, Kid2],
        Agent: """[{"op":"move","id":"tg","parent":"k1"}]""");
    yield return new("refuse-move-after-itself", [Root, Second],
        Agent: """[{"op":"move","id":"root","after":"root"}]""");
    yield return new("refuse-move-unknown", [Root],
        Agent: """[{"op":"move","id":"nope"}]""");
    yield return new("refuse-move-under-a-parent-without-a-list", [Root],
        Agent: """[{"op":"move","id":"root","parent":"bare"}]""",
        Shape: "bare-block-without-content-ids");
    yield return new("lift-then-remove-keeps-the-children", [Toggle, Kid1, Kid2, Root],
        Agent: """[{"op":"lift","id":"tg"},{"op":"remove","id":"tg"}]""");
    yield return new("lift-unlisted-children-in-key-order", [
        """{ "id": "holder", "type": "toggle", "data": {}, "content": [] }""", Root],
        Agent: """[{"op":"lift","id":"holder"}]""",
        Shape: "children-re-added-out-of-order");
    yield return new("retype-keeps-the-block-and-its-children", [Toggle, Kid1, Kid2],
        Agent: """[{"op":"retype","id":"tg","type":"header","data":{"text":"t","level":2}}]""");
    yield return new("refuse-retype-with-a-nul-type", [Root],
        Agent: """[{"op":"retype","id":"root","type":"a\u0000b","data":{}}]""");
    yield return new("set-tunes", [Root],
        Agent: """[{"op":"setTunes","id":"root","tunes":{"align":"right","colour":{"bg":"red"}}}]""");
    yield return new("set-tunes-in-place-and-delete-one", [
        """{ "id": "root", "type": "paragraph", "data": {}, "tunes": { "align": "left", "colour": { "bg": "red", "fg": "blue" } } }"""],
        Agent: """[{"op":"setTunes","id":"root","tunes":{"align":null,"colour":{"bg":"green","fg":"blue"}}}]""");
    yield return new("set-metadata-with-a-co-editor", [Root],
        Agent: """[{"op":"setMetadata","id":"root","lastEditedAt":1700000000000.5,"lastEditedBy":"u1","lastEditedWith":"agent"}]""");
    yield return new("set-metadata-without-a-co-editor-removes-it", [Root],
        Agent: """[{"op":"setMetadata","id":"root","lastEditedAt":1,"lastEditedBy":"u1","lastEditedWith":"agent"},{"op":"setMetadata","id":"root","lastEditedAt":2,"lastEditedBy":"u2"}]""");
    yield return new("refuse-set-metadata-on-junk", [Root],
        Agent: """[{"op":"setMetadata","id":"junk","lastEditedAt":1,"lastEditedBy":"u1"}]""",
        Shape: "junk-entry-in-blocks");
    yield return new("set-page-title-and-icon", [Root],
        Agent: """[{"op":"setPageField","key":"title","value":"Plan\u0000s"},{"op":"setPageField","key":"icon","value":{"type":"emoji","value":"x\u0000y"}}]""");
    yield return new("clear-page-title", [Root],
        Agent: """[{"op":"setPageField","key":"title","value":""},{"op":"setPageField","key":"icon","value":null}]""",
        Page: """{ "title": "Old", "icon": { "type": "emoji", "value": "o" } }""");
    yield return new("refuse-a-bad-page-icon", [Root],
        Agent: """[{"op":"setPageField","key":"icon","value":{"type":"emoji"}}]""");
    yield return new("refuse-an-unknown-page-field", [Root],
        Agent: """[{"op":"setPageField","key":"cover","value":"x"}]""");
    yield return new("refuse-a-page-title-that-is-not-a-string", [Root],
        Agent: """[{"op":"setPageField","key":"title","value":5}]""");
    yield return new("patch-maps", [Root],
        Agent: """[{"op":"patchMaps","patches":[{"map":"values","key":"k","value":{"a":[1,"b",true,null]}},{"map":"page","key":"title","value":"T"},{"map":"values","key":"gone","remove":true}]}]""");
    yield return new("refuse-patch-of-an-unknown-map", [Root],
        Agent: """[{"op":"patchMaps","patches":[{"map":"blocks","key":"k","value":1}]}]""");
  }

  private const string LossTable =
      """{ "id": "tb", "type": "table", "data": { "content": [[ { "text": "a1", "blocks": ["p1"] }, { "text": "b1", "blocks": [] } ]] } }""";

  private const string TableWithRowIds =
      """{ "id": "tb", "type": "table", "data": { "content": [ [ { "blocks": ["p1"], "id": "c0", "rowId": "r0" } ], [ { "blocks": ["p2"], "id": "c0", "rowId": "r1" } ] ] } }""";

  private const string FullTable =
      """
      { "id": "tb", "type": "table", "content": ["p00", "p01", "p10", "p11", "p12"],
        "data": {
          "withHeadings": true, "withHeadingColumn": true, "stretched": true,
          "colWidths": [120.5, 200, 333.25], "initialColWidth": 217.75, "textSize": "comfortable",
          "content": [
            [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 2, "color": "blue", "textColor": "red", "placement": "middle-center" },
              { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] },
              { "id": "c2", "rowId": "r0", "blocks": ["p01"], "rowspan": 2 } ],
            [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] },
              { "id": "c1", "rowId": "r1", "blocks": ["p12"], "placement": "bottom-right" },
              { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 2] } ]
          ] } }
      """;

  private static readonly string[] FullTableBlocks =
  [
    FullTable,
    """{ "id": "p00", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "origin" }] } }""",
    """{ "id": "p01", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "tall" }] } }""",
    """{ "id": "p10", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "first" }] } }""",
    """{ "id": "p11", "type": "list", "parent": "tb", "data": { "text": [{ "text": "second" }], "style": "unordered" } }""",
    """{ "id": "p12", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "x" }] } }""",
  ];

  private static readonly (string Name, string Content)[] TableEdits =
  [
    ("move-column-c2-to-the-front", """
      [ [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
        [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ]
      """),
    ("insert-column-c3-in-the-middle", """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c3", "rowId": "r0", "blocks": [] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c3", "rowId": "r1", "blocks": [] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """),
    ("delete-column-c1", """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """),
    ("move-row-r1-above-r0", """
      [ [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ],
        [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ] ]
      """),
    ("merge-then-colour-the-covered-column", """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 3, "rowspan": 2, "color": "green" }, { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c1", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] } ] ]
      """),
    ("cells-lose-their-column-ids", """
      [ [ { "blocks": ["p00"] }, { "blocks": [] }, { "blocks": ["p01"] } ],
        [ { "blocks": ["p10", "p11"] }, { "blocks": ["p12"] }, { "blocks": [] } ] ]
      """),
    ("two-columns-share-an-id", """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c0", "rowId": "r0", "blocks": ["p01"] }, { "id": "c2", "rowId": "r0", "blocks": [] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c0", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """),
    ("legacy-strings-replace-the-cells", """[ ["a", "b", "c"], ["d", "e", "f"] ]"""),
    ("table-emptied", "[ ]"),
  ];

  private static string FilterData(string rules)
  {
    return $$"""
        {
            "schema": [{ "id": "t", "name": "Name", "type": "title", "position": "a0" }],
            "activeViewId": "v1",
            "views": [{ "id": "v1", "name": "Table", "type": "table", "position": "a0",
                "sorts": [], "filters": [], "visibleProperties": [],
                "filterTree": { "id": "v1-filters", "conjunction": "and", "filterRules": {{rules}} } }] }
        """;
  }

  private static string FilterDatabase(string rules) =>
      $$"""{ "id": "db", "type": "database", "data": {{FilterData(rules)}} }""";

  private static string FilterUpdate(string rules) =>
      $$"""{ "op": "update", "id": "db", "data": {{FilterData(rules)}} }""";

  /// <summary>
  /// The server edits of YDocConverterConcurrentLossTests,
  /// TableDataLossAuditTests and YDocConverterTextMergeTests. A case with a
  /// peer also records the peer's concurrent update and the merged export.
  /// </summary>
  private static IEnumerable<EditCase> ConcurrencyCases()
  {
    const string HostCellEdit = """
        { "op": "update", "id": "tb", "data": { "content": [[ { "text": "a1", "blocks": ["p1"] }, { "text": "b1 host", "blocks": [] } ]] } }
        """;
    const string Callout = """{ "id": "cb", "type": "callout", "data": { "settings": { "icon": "star", "colour": "blue" } } }""";
    const string Row = """{ "id": "r", "type": "database-row", "data": { "position": "a0", "title": "One", "properties": { "t": "One" } } }""";

    yield return new("loss-concurrent-cell-typing", [LossTable], Edit(HostCellEdit), Peer: "types-in-a-cell");
    yield return new("loss-a-server-table-update-keeps-the-row-containers", [LossTable], Edit(HostCellEdit));
    yield return new("loss-concurrent-block-inserts-into-one-cell", [LossTable], Edit("""
        { "op": "update", "id": "tb", "data": { "content": [[ { "text": "a1", "blocks": ["p1", "p3"] }, { "text": "b1", "blocks": [] } ]] } }
        """), Peer: "adds-a-block-to-a-cell");
    yield return new("loss-concurrent-writes-to-a-nested-map", [Callout], Edit("""
        { "op": "update", "id": "cb", "data": { "settings": { "icon": "bolt", "colour": "blue" } } }
        """), Peer: "sets-a-nested-colour");
    yield return new("loss-concurrent-renames-of-two-properties", [
        """{ "id": "db", "type": "database", "data": { "properties": [ { "id": "p1", "name": "Name" }, { "id": "p2", "name": "Status" } ] } }"""],
        Edit("""{ "op": "update", "id": "db", "data": { "properties": [ { "id": "p1", "name": "Title" }, { "id": "p2", "name": "Status" } ] } }"""),
        Peer: "renames-property-p2");
    yield return new("loss-concurrent-typing-in-top-level-text",
        ["""{ "id": "p", "type": "paragraph", "data": { "text": [{ "text": "hello" }] } }"""],
        Edit("""{ "op": "update", "id": "p", "data": { "text": [{ "text": "hello!" }] } }"""),
        Peer: "types-at-the-start");
    yield return new("loss-a-top-level-key-added-concurrently",
        ["""{ "id": "p", "type": "paragraph", "data": { "text": [{ "text": "hi" }] } }"""],
        Edit("""{ "op": "update", "id": "p", "data": { "text": [{ "text": "hi there" }] } }"""),
        Peer: "adds-an-align-key");
    yield return new("loss-a-row-icon-is-a-plain-value",
        ["""{ "id": "r", "type": "database-row", "data": { "position": "a0", "icon": "🌱", "properties": { "t": "One" } } }"""],
        Edit("""{ "op": "update", "id": "r", "data": { "position": "a0", "icon": "🚀", "properties": { "t": "One" } } }"""),
        Peer: "moves-the-row");
    yield return new("loss-a-row-cover-is-a-plain-value",
        ["""{ "id": "r", "type": "database-row", "data": { "position": "a0", "cover": "https://example.com/a.png", "properties": { "t": "One" } } }"""],
        Edit("""{ "op": "update", "id": "r", "data": { "position": "a0", "cover": "https://example.com/b.png", "properties": { "t": "One" } } }"""),
        Peer: "moves-the-row");
    yield return new("loss-a-body-blocks-marker-set-concurrently", [Row],
        Edit("""{ "op": "update", "id": "r", "data": { "position": "a0", "title": "One", "properties": { "t": "One", "n": "note" } } }"""),
        Peer: "marks-body-blocks");
    yield return new("loss-an-update-drops-a-nested-key", [Callout],
        Edit("""{ "op": "update", "id": "cb", "data": { "settings": { "icon": "bolt" } } }"""));
    yield return new("loss-adding-a-table-row-keeps-the-row-keys", [LossTable], Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
            [ { "text": "a1", "blocks": ["p1"] }, { "text": "b1", "blocks": [] } ],
            [ { "text": "a2", "blocks": [] }, { "text": "b2", "blocks": [] } ] ] } }
        """));
    yield return new("loss-numeric-rows-pair-with-the-rows-in-the-doc", [
        """{ "id": "tb", "type": "table", "data": { "content": [ [ { "count": 1 }, { "count": 2 } ], [ { "count": 3 }, { "count": 4.5 } ] ] } }"""],
        Edit("""{ "op": "update", "id": "tb", "data": { "content": [ [ { "count": 1 }, { "count": 2 } ], [ { "count": 3 }, { "count": 9.5 } ] ] } }"""));
    yield return new("loss-reordering-properties-keeps-a-concurrent-rename", [
        """{ "id": "db", "type": "database", "data": { "properties": [ { "id": "p1", "name": "Name" }, { "id": "p2", "name": "Status" }, { "id": "p3", "name": "Owner" } ] } }"""],
        Edit("""{ "op": "update", "id": "db", "data": { "properties": [ { "id": "p3", "name": "Owner" }, { "id": "p1", "name": "Name" }, { "id": "p2", "name": "Status" } ] } }"""),
        Peer: "renames-property-p3");
    yield return new("loss-an-unequal-array-middle-keeps-the-container", [
        """{ "id": "x", "type": "tool", "data": { "items": [ { "a": "1" }, { "a": "2" }, { "a": "3" } ] } }"""],
        Edit("""{ "op": "update", "id": "x", "data": { "items": [ { "a": "1" }, { "a": "2" }, { "a": "3x" }, { "a": "4" } ] } }"""),
        Peer: "edits-the-third-item");
    yield return new("loss-change-a-row-and-insert-one-above-it", [TableWithRowIds], Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
            [ { "blocks": [], "id": "c0", "rowId": "rN" } ],
            [ { "blocks": ["p1", "p3"], "id": "c0", "rowId": "r0" } ],
            [ { "blocks": ["p2"], "id": "c0", "rowId": "r1" } ] ] } }
        """));
    yield return new("loss-concurrent-filter-rules-in-one-group", [FilterDatabase("[]")],
        Edit(FilterUpdate("""[{ "id": "rb", "propertyId": "t", "operator": "contains", "value": "b" }]""")),
        Peer: "adds-filter-rule-ra");

    // TableDataLossAuditTests.
    foreach (var (name, content) in TableEdits)
    {
      yield return new($"table-loss-{name}", FullTableBlocks, Edit(
          $$"""{ "op": "update", "id": "tb", "data": { "withHeadings": true, "withHeadingColumn": false, "colWidths": [100, 200], "content": {{content}} } }"""));
    }

    foreach (var (firstName, first) in TableEdits)
    {
      foreach (var (name, content) in TableEdits)
      {
        yield return new($"table-loss-{name}-after-{firstName}", FullTableBlocks,
            Edit($$"""{ "op": "update", "id": "tb", "data": { "content": {{content}} } }"""),
            Prior: Edit($$"""{ "op": "update", "id": "tb", "data": { "content": {{first}} } }"""));
      }
    }

    yield return new("table-loss-a-host-cell-edit-and-a-peers-new-column", FullTableBlocks, Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "color": "red" }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }
        """), Peer: "adds-column-c3");
    yield return new("table-loss-a-host-cell-edit-follows-a-column-move", FullTableBlocks, Edit("""
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01", "pNew"] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }
        """), Peer: "moves-column-c2-first");

    // YDocConverterTextMergeTests.
    yield return new("merge-an-update-keeps-the-same-ytext",
        ["""{ "id": "p", "type": "note", "data": { "text": "hello" } }"""],
        Edit("""{ "op": "update", "id": "p", "data": { "text": "hello!" } }"""),
        Peer: "types-at-the-end-of-a-ytext");
    yield return new("merge-an-update-drops-the-omitted-keys",
        ["""{ "id": "p", "type": "note", "data": { "text": "old", "level": 3 } }"""],
        Edit("""{ "op": "update", "id": "p", "data": { "text": "new" } }"""));
  }
}
