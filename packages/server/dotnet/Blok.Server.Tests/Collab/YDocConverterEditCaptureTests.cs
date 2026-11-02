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
      string? Page = null);

  private static JsonObject Build()
  {
    var cases = new JsonArray();

    foreach (var edit in Cases())
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
    var first = Run(edit, seedUpdate);
    var second = Run(edit, seedUpdate);
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

    result["export"] = YDocConverter.Export(first.Doc);
    result["exportPage"] = YDocConverter.ExportPage(first.Doc);

    return result;
  }

  private sealed record Outcome(YDoc Doc, List<string> Updates, JsonArray Html, JsonObject? Refused);

  private static Outcome Run(EditCase edit, byte[] seedUpdate)
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

    return new Outcome(doc, updates, html, null);
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

    return doc.EncodeStateAsUpdate();
  }

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
}
