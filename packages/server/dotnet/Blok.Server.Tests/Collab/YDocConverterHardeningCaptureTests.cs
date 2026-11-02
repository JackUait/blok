using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The seed and export cases of YDocConverterHardeningTests, YDocConverterLawTests,
/// YDocConverterTextMergeTests and YDocConverterViewSettingsTests, captured into
/// fixtures/collab-hardening/cases.json for the Go twin
/// (internal/collab/convert/hardening_test.go).
///
/// An export case is a doc a peer could write, as update bytes, with the
/// export, the page and the warnings. A seed case starts from an optional
/// state, seeds as client 1 and records the whole state after it, byte for
/// byte (which pins every container the seed mints), or the refusal and that
/// nothing was written. HTML in a seed is read by the runtime here and
/// recorded with its segments. Set BLOK_WRITE_COLLAB_HARDENING=1 to rewrite.
/// </summary>
public sealed class YDocConverterHardeningCaptureTests
{
  private const string FileName = "collab-hardening/cases.json";
  private const uint SeedClient = 1;
  private const uint BuildClient = 7;
  private const ulong ForeignClient = 999;
  private const string NUL = "\u0000";

  // Some cases nest past System.Text.Json's default depth of 64.
  private const int Deep = 1024;

  private static JsonNode Parse(string json) =>
      JsonNode.Parse(json, documentOptions: new JsonDocumentOptions { MaxDepth = Deep })!;

  private static string Text(JsonNode node) =>
      node.ToJsonString(new JsonSerializerOptions { MaxDepth = Deep });

  [Fact]
  public void TheCaptureMatchesTheConverter()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true, MaxDepth = Deep }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HARDENING") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_HARDENING=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static JsonObject Build()
  {
    var exports = new JsonArray();
    var seeds = new JsonArray();

    foreach (var (name, build) in Exports())
    {
      exports.Add(CaptureExport(name, build));
    }

    foreach (var seed in Seeds())
    {
      seeds.Add(CaptureSeed(seed));
    }

    return new JsonObject
    {
      ["$comment"] = "Captured from C# by YDocConverterHardeningCaptureTests. Do not edit by hand.",
      ["seedClient"] = SeedClient,
      ["exports"] = exports,
      ["seeds"] = seeds,
    };
  }

  private static JsonObject CaptureExport(string name, Action<YDoc> build)
  {
    var source = new YDoc(BuildClient);

    build(source);

    // Read from a replica, as a server reads a peer's update.
    var update = source.EncodeStateAsUpdate();
    var doc = new YDoc(SeedClient);

    var applied = doc.ApplyUpdate(update).Outcome;

    Assert.True(applied == ApplyOutcome.Applied, $"{name}: {applied}");

    var warnings = new List<string>();
    var exported = YDocConverter.Export(doc, RichTextFields.BuiltIn, warnings.Add, out var slots);

    return new JsonObject
    {
      ["name"] = name,
      ["update"] = Convert.ToBase64String(update),
      ["export"] = exported,
      ["exportPage"] = YDocConverter.ExportPage(doc),
      ["warnings"] = new JsonArray([.. warnings.Select(warning => (JsonNode)warning)]),
      ["slots"] = Slots(slots),
    };
  }

  private sealed record SeedCase(string Name, string Blocks, string? Page = null, Action<YDoc>? Before = null);

  private static JsonObject CaptureSeed(SeedCase seed)
  {
    var result = new JsonObject { ["name"] = seed.Name };
    var doc = new YDoc(SeedClient);

    YDocConverter.RowKeySource.Value = Counter("s");

    if (seed.Before is not null)
    {
      // Another client: an update holding the doc's own client makes the
      // engine pick a new random one.
      var source = new YDoc(BuildClient);

      seed.Before(source);

      var before = source.EncodeStateAsUpdate();

      Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(before).Outcome);
      result["before"] = Convert.ToBase64String(before);
    }

    result["blocks"] = seed.Blocks;

    if (seed.Page is not null)
    {
      result["page"] = seed.Page;
    }

    var blocks = (JsonArray)Parse(seed.Blocks);
    var vector = Convert.ToBase64String(doc.EncodeStateVector());

    try
    {
      var found = YDocConverter.CollectSeedHtml(blocks, RichTextFields.BuiltIn);
      var segments = found.Count == 0
          ? []
          : RichTextRuntime.Reader.ReadAsync(found).AsTask().GetAwaiter().GetResult();
      var table = new Dictionary<string, JsonArray>(StringComparer.Ordinal);
      var html = new JsonArray();

      for (var index = 0; index < found.Count; index++)
      {
        table[found[index].Html] = segments[index];
        html.Add(new JsonObject { ["html"] = found[index].Html, ["segments"] = segments[index].DeepClone() });
      }

      if (html.Count > 0)
      {
        result["html"] = html;
      }

      YDocConverter.Seed(
          doc,
          blocks,
          RichTextInput.Converting(RichTextFields.BuiltIn, table),
          seed.Page is null ? null : (JsonObject)Parse(seed.Page));
    }
    catch (InvalidDataException refusal)
    {
      // A refused seed must never have opened a transaction.
      Assert.Equal(vector, Convert.ToBase64String(doc.EncodeStateVector()));
      result["refused"] = refusal.Message;

      return result;
    }

    result["state"] = Convert.ToBase64String(doc.EncodeStateAsUpdate());
    result["export"] = YDocConverter.Export(doc, RichTextFields.BuiltIn, null, out var seededSlots);
    result["slots"] = Slots(seededSlots);
    result["exportPage"] = YDocConverter.ExportPage(doc);

    return result;
  }

  /// <summary>The rich fields the export left as HTML, in the order it listed them.</summary>
  private static JsonArray Slots(IReadOnlyList<RichTextHtmlSlot> slots)
  {
    return new JsonArray([.. slots.Select(slot => (JsonNode)new JsonArray(slot.Html.Type, slot.Html.Field, slot.Key, slot.Html.Html))]);
  }

  private static Func<string> Counter(string prefix)
  {
    var next = 0;

    return () => prefix + (++next).ToString("D9", System.Globalization.CultureInfo.InvariantCulture);
  }

  private static IEnumerable<(string Name, Action<YDoc> Build)> Exports()
  {
    // YDocConverterHardeningTests.
    yield return ("hostile-nul-update", doc => doc.ApplyUpdate(Convert.FromBase64String(
        "AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE" +
        "dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk" +
        "cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA")));
    yield return ("a-doc-value-nested-past-the-limit-is-null", doc =>
        WriteBlock(doc, "deep", ("data", NestedMaps(YDocConverter.MaxValueDepth + 5))));
    yield return ("peer-bytes-and-a-subdoc", doc =>
    {
      WriteBlock(doc, "n1");
      var data = DataOf(doc, "n1");
      doc.Transact(transaction => data.Set(transaction, "blob", new byte[] { 1, 2, 3 }));
      ApplyForeign(doc, Keyed(0, data, "sub", new ContentDoc("sub-guid", new AnyObject())));
    }
    );
    yield return ("peer-minted-malformed-blocks", doc =>
    {
      WriteBlock(doc, "str-data", ("data", "nope"));
      WriteBlock(doc, "num-id", ("id", 7d));
      WriteBlock(doc, "deep", ("data", NestedMaps(300)));
      WriteBlock(doc, "fine");
    }
    );
    yield return ("wire-json-content", doc =>
    {
      WriteBlock(doc, "n1");
      ApplyForeign(
          doc,
          Keyed(0, DataOf(doc, "n1"), "legacy", new ContentJson(["""{"a":1}"""])),
          Keyed(1, DataOf(doc, "n1"), "embed", new ContentEmbed("""{"kind":"image"}""")));
    }
    );
    yield return ("wire-json-that-cannot-materialise", doc =>
    {
      WriteBlock(doc, "n1");
      ApplyForeign(doc, Keyed(0, DataOf(doc, "n1"), "lone", new ContentEmbed("\"\\ud800\"")));
    }
    );
    yield return ("wire-json-as-javascript-reads-it", doc =>
    {
      var deep = new string('[', 300) + "1" + new string(']', 300);
      WriteBlock(doc, "n1");
      ApplyForeign(
          doc,
          Keyed(0, DataOf(doc, "n1"), "numbers", new ContentEmbed("""{"n":1.0,"e":1e2,"i":1e999}""")),
          Keyed(1, DataOf(doc, "n1"), "deep", new ContentJson([deep])));
    }
    );
    yield return ("wire-json-drops-only-the-lone-surrogate", doc =>
    {
      WriteBlock(doc, "n1");
      ApplyForeign(
          doc,
          Keyed(0, DataOf(doc, "n1"), "mixed", new ContentEmbed("{\"a\":\"\\ud800\",\"b\":[1,\"\\udc00\"]}")));
    }
    );
    yield return ("wire-json-nested-past-the-json-default", doc =>
    {
      WriteBlock(doc, "n1");
      ApplyForeign(doc, Keyed(0, DataOf(doc, "n1"), "deep",
          new ContentEmbed(new string('[', 100) + "1" + new string(']', 100))));
    }
    );

    foreach (var kind in new[] { "text", "xmltext", "xmlelement", "xmlfragment", "xmlhook" })
    {
      yield return ($"foreign-shared-type-{kind}", doc =>
      {
        WriteBlock(doc, "n1", ("data", new YMap([])));
        var data = DataOf(doc, "n1");

        if (kind == "xmltext")
        {
          ApplyForeign(
              doc,
              Keyed(0, data, "rich", new ContentType(6, null)),
              Listed(1, new YId(ForeignClient, 0), new ContentString("xml text")));
        }
        else
        {
          doc.Transact(transaction => data.Set(transaction, "rich", kind switch
          {
            "text" => new YText("hello world"),
            "xmlelement" => new YXmlElement("p"),
            "xmlfragment" => new YXmlFragment(),
            _ => (YAbstractType)new YXmlHook("h"),
          }));
        }
      }
      );
    }

    yield return ("page-shared-type-title", doc =>
        doc.Transact(transaction => doc.GetMap("page").Set(transaction, "title", new YText("nested"))));
    yield return ("page-icon-that-is-not-json", doc =>
    {
      var icon = EmojiIcon("x");
      icon.Add("raw", new byte[] { 1, 2 });
      SetPage(doc, "Plan", icon);
    }
    );
    yield return ("page-title-with-a-nul", doc => SetPage(doc, "Pl" + NUL + "an", EmojiIcon("x")));
    yield return ("page-icon-with-a-nul-value", doc => SetPage(doc, "Plan", EmojiIcon("x" + NUL)));
    yield return ("page-icon-with-a-nul-in-an-extra-key", doc =>
    {
      var icon = EmojiIcon("x");
      var nested = new AnyObject();
      nested.Add("n" + NUL, "y");
      icon.Add("extra", nested);
      SetPage(doc, "Plan", icon);
    }
    );

    // YDocConverterLawTests.
    yield return ("parent-id-is-the-membership-arbiter", doc => BuildDoc(
        doc,
        ["a", "b"],
        ("a", Block("a", contentIds: ["x"])),
        ("b", Block("b", contentIds: ["x"])),
        ("x", Block("x", parentId: "b"))));
    yield return ("a-disagreeing-order-entry-does-not-consume-the-id", doc => BuildDoc(
        doc,
        ["a", "b"],
        ("a", Block("a", contentIds: ["x", "y"])),
        ("y", Block("y", parentId: "a")),
        ("b", Block("b", contentIds: ["x"])),
        ("x", Block("x", parentId: "b"))));
    yield return ("cycle-break-keeps-the-smallest-id", doc => BuildDoc(
        doc,
        [],
        ("q", Block("q", parentId: "p", contentIds: ["p"])),
        ("p", Block("p", parentId: "q", contentIds: ["q"]))));
    yield return ("cycle-break-uses-utf16-order", doc => BuildDoc(
        doc,
        [],
        ("\uFF21", Block("\uFF21", parentId: "\U0001F600")),
        ("\U0001F600", Block("\U0001F600", parentId: "\uFF21"))));
    yield return ("a-self-parent-is-broken", doc => BuildDoc(
        doc,
        [],
        ("a", Block("a", parentId: "a", contentIds: ["a"]))));
    yield return ("a-duplicate-id-emits-once", doc => BuildDoc(
        doc,
        ["a", "a"],
        ("a", Block("a", contentIds: ["k", "k"])),
        ("k", Block("k", parentId: "a"))));
    yield return ("unreached-blocks-append-in-two-sorted-passes", doc => BuildDoc(
        doc,
        [],
        ("y", Block("y", parentId: "ghost", contentIds: ["y-kid"])),
        ("y-kid", Block("y-kid", parentId: "y")),
        ("x", Block("x")),
        ("w", Block("w", parentId: "y", contentIds: ["v"])),
        ("v", Block("v", parentId: "w"))));
    yield return ("the-orphan-tail-sorts-by-utf16", doc => BuildDoc(
        doc,
        [],
        ("\uFF21", Block("\uFF21", parentId: "ghost")),
        ("\U0001F600", Block("\U0001F600", parentId: "ghost")),
        ("\u00E9", Block("\u00E9", parentId: "ghost")),
        ("z", Block("z", parentId: "ghost"))));
    yield return ("a-dangling-parent-id-is-kept", doc => BuildDoc(
        doc, [], ("a", Block("a", parentId: "not-yet-arrived"))));
    yield return ("a-dangling-content-id-stays-in-content", doc => BuildDoc(
        doc, ["a"], ("a", Block("a", contentIds: ["missing"]))));
    yield return ("integral-numbers-and-a-peer-bigint", doc =>
    {
      BuildDoc(doc, ["a"], ("a", Table("a", ("whole", 3.0), ("fraction", 2.5))));
      ApplyForeign(doc, Keyed(0, DataOf(doc, "a"), "long", new ContentAny([new BigInteger(7)])));
    }
    );
    yield return ("grid-row-keys-normalize", doc => BuildDoc(
        doc,
        ["t"],
        ("t", Table(
            "t",
            ("content", MapOf(
                ("__rows", MapOf(
                    ("k1", Row("r1")),
                    ("k2", Row("r2")),
                    ("zz", Row("orphan z")),
                    ("aa", Row("orphan a")))),
                ("__rowKeys", ArrayOf("k1", "stray", "k2", "k1"))))))));
    yield return ("a-map-is-a-grid-only-with-both-keys-in-shape", doc => BuildDoc(
        doc,
        ["t"],
        ("t", Table(
            "t",
            ("plainKeys", MapOf(("__rows", MapOf(("k1", "row"))), ("__rowKeys", PlainArray("k1")))),
            ("rowsOnly", MapOf(("__rows", MapOf(("k1", "row")))))))));
    yield return ("blocks-without-a-string-id-type-or-map-data-warn", doc => BuildDoc(
        doc,
        ["bad-id", "bad-type", "bad-data", "good"],
        ("bad-id", MapOf(
            ("id", 1.0),
            ("type", "paragraph"),
            ("data", MapOf()),
            ("contentIds", ArrayOf("kid")))),
        ("kid", Block("kid", parentId: "bad-id")),
        ("bad-type", MapOf(("id", "bad-type"), ("type", null), ("data", MapOf()))),
        ("bad-data", MapOf(("id", "bad-data"), ("type", "paragraph"), ("data", new AnyObject()))),
        ("good", Block("good"))));
    yield return ("a-non-map-blocks-entry-drops-without-a-warning", doc =>
    {
      BuildDoc(doc, ["frag", "good"], ("good", Block("good")));
      doc.Transact(transaction => doc.GetMap("blocks").Set(transaction, "frag", new YXmlFragment()));
    }
    );
  }

  private static IEnumerable<SeedCase> Seeds()
  {
    // YDocConverterHardeningTests.
    foreach (var field in new[] { "id", "type", "parent", "lastEditedBy" })
    {
      var block = new JsonObject
      {
        ["id"] = "n1",
        ["type"] = "paragraph",
        ["data"] = new JsonObject { ["text"] = "x" },
        [field] = $"a{NUL}b",
      };

      yield return new($"refuse-a-nul-in-{field}", Text(new JsonArray(block)));
    }

    yield return new("refuse-a-nul-in-a-data-key", """[{ "id": "n1", "type": "paragraph", "data": { "k\u0000e": "v" } }]""");
    yield return new("refuse-a-nul-in-a-data-value", """[{ "id": "n1", "type": "paragraph", "data": { "text": "a\u0000b" } }]""");
    yield return new("refuse-a-nul-deep-in-data", """[{ "id": "n1", "type": "paragraph", "data": { "rows": [[{ "text": "a\u0000b" }]] } }]""");
    yield return new("refuse-a-nul-key-inside-an-atomic-value", """[{ "id": "n1", "type": "paragraph", "data": { "mixed": [1, { "k\u0000": 1 }] } }]""");
    yield return new("refuse-a-nul-in-a-tune-value", """[{ "id": "n1", "type": "paragraph", "data": {}, "tunes": { "anchor": "a\u0000b" } }]""");
    yield return new("refuse-a-nul-in-a-tune-key", """[{ "id": "n1", "type": "paragraph", "data": {}, "tunes": { "a\u0000b": "x" } }]""");
    yield return new("refuse-a-nul-in-a-content-id", """[{ "id": "n1", "type": "paragraph", "data": {}, "content": ["c\u00001"] }]""");
    yield return new(
        "a-refused-seed-leaves-the-doc-as-it-was",
        """[{ "id": "good", "type": "paragraph", "data": { "text": "good" } }, { "id": "bad", "type": "paragraph", "data": { "text": "a\u0000b" } }]""",
        Before: doc => SeedPlain(doc, """[{ "id": "old", "type": "paragraph", "data": { "text": [{ "text": "old" }] } }]"""));
    yield return new("every-other-control-character", """[{ "id": "n1", "type": "paragraph", "data": { "text": [{ "text": "a\u0001b\u001Fc\td" }] } }]""");
    yield return new("data-nested-to-the-limit", NestedData(YDocConverter.MaxValueDepth + 1));
    yield return new("refuse-data-nested-past-the-limit", NestedData(YDocConverter.MaxValueDepth + 2));

    const string OneParagraph = """[{"id":"p1","type":"paragraph","data":{"text":""}}]""";

    yield return new(
        "reseed-with-no-title-removes-the-old-title",
        OneParagraph,
        "{}",
        doc => SeedPlain(doc, OneParagraph, """{"title":"Old","icon":{"type":"emoji","value":"🚀"}}"""));
    yield return new(
        "seed-leaves-the-values-map-alone",
        OneParagraph,
        """{"title":"Plan"}""",
        doc => doc.Transact(transaction => doc.GetMap("values").Set(transaction, "k", "kept")));
    yield return new(
        "seed-without-a-page-leaves-the-page-map-alone",
        OneParagraph,
        Before: doc => SeedPlain(doc, OneParagraph, """{"title":"Plan"}"""));

    var malformed = new[]
    {
      """{"title":42,"icon":"🚀"}""",
      """{"title":"","icon":{"type":"emoji"}}""",
      """{"title":null,"icon":{"type":"image","url":5}}""",
      """{"title":true,"icon":{"type":"sticker","value":"x"}}""",
      """{"title":["a"],"icon":null}""",
      """{"icon":{"type":"sticker","value":"a\u0000b"}}""",
      """{"icon":{"type":"emoji","note":"a\u0000b"}}""",
    };

    for (var index = 0; index < malformed.Length; index++)
    {
      yield return new($"seed-drops-a-malformed-title-or-icon-{index + 1}", OneParagraph, malformed[index]);
    }

    yield return new(
        "seed-keeps-a-valid-icon-with-its-extra-keys",
        OneParagraph,
        """{"title":"Plan","icon":{"type":"image","url":"https://x/i.png","alt":"logo"}}""");

    foreach (var (suffix, page) in new[]
    {
      ("title", """{"title":"a\u0000b"}"""),
      ("icon", """{"icon":{"type":"emoji","value":"a\u0000b"}}"""),
    })
    {
      yield return new(
          $"refuse-a-nul-in-a-page-{suffix}",
          """[{"id":"p2","type":"paragraph","data":{"text":""}}]""",
          page,
          doc => SeedPlain(doc, OneParagraph, """{"title":"Before"}"""));
    }

    var deepIcon = new JsonObject { ["leaf"] = 1 };

    for (var level = 0; level < 300; level++)
    {
      deepIcon = new JsonObject { ["n"] = deepIcon };
    }

    yield return new(
        "seed-drops-an-icon-nested-past-the-depth-cap",
        OneParagraph,
        Text(new JsonObject { ["icon"] = new JsonObject { ["type"] = "sticker", ["deep"] = deepIcon } }));

    // YDocConverterLawTests.
    yield return new("non-string-content-entries-pass-through", """[{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "content": [7, "b"] }, { "id": "b", "type": "paragraph", "data": { "text": "b" }, "parent": "a" }]""");
    yield return new("content-ids-are-eager", """[{ "id": "a", "type": "paragraph", "data": { "text": "a" } }]""");
    yield return new("tunes-are-eager", """[{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": {} }, { "id": "b", "type": "paragraph", "data": { "text": "b" } }]""");
    yield return new("only-empty-paragraph-data-is-normalized", """[{ "id": "p", "type": "paragraph", "data": {} }, { "id": "h", "type": "header", "data": {} }]""");
    yield return new("a-null-parent-stays-out-of-the-root-order", """[{ "id": "first", "type": "paragraph", "data": { "text": "1" } }, { "id": "nullish", "type": "paragraph", "data": { "text": "2" }, "parent": null }, { "id": "last", "type": "paragraph", "data": { "text": "3" } }]""");
    yield return new("numbers-are-doubles", """[{ "id": "a", "type": "paragraph", "data": { "n": 5, "big": 1735689600000, "f": 2.5 }, "lastEditedAt": 1735689600000 }]""");
    yield return new("the-creation-stamp", """[{ "id": "a", "type": "paragraph", "data": {}, "createdAt": 1735689600000, "createdBy": "u1" }, { "id": "b", "type": "paragraph", "data": {} }]""");
    yield return new("the-co-author-ids", """[{ "id": "a", "type": "paragraph", "data": {}, "createdBy": "u1", "createdWith": "a1", "lastEditedBy": "u1", "lastEditedWith": "a1" }]""");
    yield return new("the-array-rule", """[{ "id": "a", "type": "widget", "data": { "objects": [{ "k": 1 }], "primitives": [1, 2], "empty": [], "mixed": [1, {}], "grid": [[{ "k": 1 }]] } }]""");
    yield return new("refuse-absent-data", """[{ "id": "a", "type": "paragraph" }]""");
    yield return new("refuse-null-data", """[{ "id": "a", "type": "paragraph", "data": null }]""");
    yield return new("refuse-a-number-type", """[{ "id": "a", "type": 5, "data": {} }]""");
    yield return new("refuse-a-null-type", """[{ "id": "a", "type": null, "data": {} }]""");
    yield return new("refuse-an-absent-type", """[{ "id": "a", "data": {} }]""");
    yield return new("a-string-content-spreads-by-code-point", """[{ "id": "w", "type": "widget", "data": { "k": 1 }, "content": "a😀b" }]""");
    yield return new("blocks-without-a-string-id-are-skipped", """[{ "id": 42, "type": "paragraph", "data": { "text": "skipped" } }, { "type": "paragraph", "data": { "text": "skipped too" } }, { "id": "kept", "type": "paragraph", "data": { "text": "kept" } }]""");
    yield return new(
        "seed-replaces-whatever-the-doc-held",
        """[{ "id": "new", "type": "paragraph", "data": { "text": "new" } }]""",
        Before: doc => SeedPlain(doc, """[{ "id": "old", "type": "paragraph", "data": { "text": [{ "text": "old" }] } }]"""));

    // YDocConverterTextMergeTests.
    yield return new("block-text-is-a-ytext", """[{ "id": "p", "type": "note", "data": { "text": "hello" } }]""");
    yield return new("empty-paragraph-text-is-formatted-text", """[{ "id": "p", "type": "paragraph", "data": {} }]""");
    yield return new(
        "reseeding-still-mints-a-ytext",
        """[{ "id": "p", "type": "note", "data": { "text": "two" } }]""",
        Before: doc => SeedPlain(doc, """[{ "id": "p", "type": "note", "data": { "text": "one" } }]"""));
    yield return new("a-non-string-text-stays-atomic", """[{ "id": "p", "type": "note", "data": { "text": 42 } }]""");
    yield return new("a-nested-text-stays-atomic", """[{ "id": "t", "type": "table", "data": { "cell": { "text": "inner" } } }]""");
    yield return new("a-tune-text-stays-atomic", """[{ "id": "p", "type": "note", "data": {}, "tunes": { "text": "tuned" } }]""");

    // YDocConverterViewSettingsTests.
    yield return new("database-view-lists", """
      [{
        "id": "db",
        "type": "database",
        "data": {
          "schema": [{ "id": "t", "name": "Name", "type": "title", "position": "a0" }],
          "activeViewId": "v1",
          "views": [
            {
              "id": "v1", "name": "Table", "type": "table", "position": "a0",
              "sorts": [], "filters": [], "visibleProperties": [],
              "properties": [{ "id": "t", "visible": true }, { "id": "s", "visible": false }],
              "calculations": [],
              "filterTree": { "id": "v1-filters", "conjunction": "and", "filterRules": [] },
              "colorRules": []
            },
            {
              "id": "v2", "name": "Two", "type": "table", "position": "a1",
              "sorts": [], "filters": [], "visibleProperties": [],
              "calculations": [{ "id": "t", "fn": "count" }]
            }
          ]
        }
      }]
      """);
  }

  /// <summary>A seed with no HTML in it, for a state a case starts from.</summary>
  private static void SeedPlain(YDoc doc, string blocks, string? page = null)
  {
    YDocConverter.Seed(
        doc,
        (JsonArray)JsonNode.Parse(blocks)!,
        RichTextInput.Refusing(RichTextFields.BuiltIn),
        page is null ? null : (JsonObject)JsonNode.Parse(page)!);
  }

  private static string NestedData(int depth)
  {
    JsonNode current = new JsonObject { ["v"] = 1 };

    for (var index = 1; index < depth; index++)
    {
      current = new JsonObject { ["a"] = current };
    }

    return Text(new JsonArray(new JsonObject
    {
      ["id"] = "deep",
      ["type"] = "paragraph",
      ["data"] = current,
    }));
  }

  private static void WriteBlock(YDoc doc, string id, params (string Key, object? Value)[] overrides)
  {
    var fields = new List<KeyValuePair<string, object?>>
    {
      new("id", id),
      new("type", "paragraph"),
      new("data", new YMap([new KeyValuePair<string, object?>("text", id)])),
      new("contentIds", new YArray([])),
    };

    fields.AddRange(overrides.Select(entry => new KeyValuePair<string, object?>(entry.Key, entry.Value)));

    var blockMap = doc.GetMap("blocks");
    var rootOrder = doc.GetArray("root");

    doc.Transact(transaction =>
    {
      blockMap.Set(transaction, id, new YMap(fields));
      rootOrder.Insert(transaction, rootOrder.Count, [id]);
    });
  }

  private static void BuildDoc(YDoc doc, string[] rootOrder, params (string Id, YMap Block)[] blocks)
  {
    var blockMap = doc.GetMap("blocks");
    var root = doc.GetArray("root");

    doc.Transact(transaction =>
    {
      foreach (var (id, block) in blocks)
      {
        blockMap.Set(transaction, id, block);
      }

      if (rootOrder.Length > 0)
      {
        root.Insert(transaction, 0, rootOrder);
      }
    });
  }

  private static void SetPage(YDoc doc, string title, AnyObject icon)
  {
    doc.Transact(transaction =>
    {
      doc.GetMap("page").Set(transaction, "title", title);
      doc.GetMap("page").Set(transaction, "icon", icon);
    });
  }

  private static AnyObject EmojiIcon(string value)
  {
    var icon = new AnyObject();

    icon.Add("type", "emoji");
    icon.Add("value", value);

    return icon;
  }

  private static YMap NestedMaps(int depth)
  {
    var current = new YMap([new KeyValuePair<string, object?>("v", 1d)]);

    for (var index = 1; index < depth; index++)
    {
      current = new YMap([new KeyValuePair<string, object?>("a", current)]);
    }

    return current;
  }

  private static YMap DataOf(YDoc doc, string id)
  {
    Assert.True(doc.GetMap("blocks").TryGet(id, out var block));
    Assert.True(Assert.IsType<YMap>(block).TryGet("data", out var data));

    return Assert.IsType<YMap>(data);
  }

  private static void ApplyForeign(YDoc doc, params DecodedStruct[] structs)
  {
    var update = new DecodedUpdate(
        new Dictionary<ulong, IReadOnlyList<DecodedStruct>> { [ForeignClient] = structs },
        new DeleteSet());

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  private static DecodedStruct Keyed(ulong clock, YAbstractType target, string key, YContent content)
  {
    return new DecodedStruct(
        new YId(ForeignClient, clock),
        content.Length,
        DecodedStructKind.Item,
        null,
        null,
        null,
        target.Item?.Id ?? throw new InvalidOperationException("the target map is not integrated"),
        key,
        content,
        0x20);
  }

  private static DecodedStruct Listed(ulong clock, YId parent, YContent content)
  {
    return new DecodedStruct(
        new YId(ForeignClient, clock),
        content.Length,
        DecodedStructKind.Item,
        null,
        null,
        null,
        parent,
        null,
        content,
        0);
  }

  private static YMap Block(string id, string? parentId = null, string[]? contentIds = null)
  {
    var entries = new List<(string, object?)>
    {
      ("id", id),
      ("type", "paragraph"),
      ("data", MapOf(("text", id))),
      ("contentIds", ArrayOf(contentIds ?? [])),
    };

    if (parentId is not null)
    {
      entries.Add(("parentId", parentId));
    }

    return MapOf([.. entries]);
  }

  private static YMap Table(string id, params (string Key, object? Value)[] data)
  {
    return MapOf(("id", id), ("type", "table"), ("data", MapOf(data)), ("contentIds", ArrayOf()));
  }

  private static YArray Row(string text)
  {
    return new YArray([MapOf(("text", text))]);
  }

  private static YMap MapOf(params (string Key, object? Value)[] entries)
  {
    return new YMap(entries.Select(entry => new KeyValuePair<string, object?>(entry.Key, entry.Value)));
  }

  private static YArray ArrayOf(params string[] items)
  {
    return new YArray(items);
  }

  private static AnyArray PlainArray(params string[] items)
  {
    var array = new AnyArray();

    foreach (var item in items)
    {
      array.Add(item);
    }

    return array;
  }
}
