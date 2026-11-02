using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Room format 1 → 2 (YDocConverter.MigrateRichText), captured into
/// fixtures/collab-migrations/cases.json. Each case starts from a frozen
/// format-1 room (fixtures/collab-format1) or a room written here as client
/// 1, optionally reshaped by a second update, and migrates as client 2. It
/// records the HTML the migration collects, the segments the runtime read
/// for it, the count, the update the migration emits byte for byte, and the
/// export. The Go server must collect the same HTML and emit the same bytes
/// (internal/collab/convert/migrate_test.go).
/// Set BLOK_WRITE_COLLAB_MIGRATIONS=1 to rewrite the file after an intended change.
/// </summary>
public sealed class YDocConverterMigrationCaptureTests
{
  private const string FileName = "collab-migrations/cases.json";
  private const uint EditClient = 2;
  private const uint ShapeClient = 3;

  [Fact]
  public void TheCaptureMatchesMigrateRichText()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true, MaxDepth = 2048 }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_MIGRATIONS") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_MIGRATIONS=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static JsonObject Build()
  {
    var cases = new JsonArray();

    foreach (var name in YDocConverterFixtures.Format1CaseNames())
    {
      cases.Add(Capture(name, name, null, false, null));
      cases.Add(Capture(name + "/string-leaves", name, null, true, null));
    }

    cases.Add(Capture("rich-negatives/host-widget", "rich-negatives", null, false, new() { ["widget"] = ["text"] }));
    cases.Add(Capture("nul-in-legacy-html", null, doc => doc.Transact(t =>
    {
      doc.GetMap("blocks").Set(t, "p", Block("p", "paragraph", "a\0<b>b\0c</b>", null, asString: true));
      doc.GetArray("root").Insert(t, 0, ["p"]);
    }), false, null));
    cases.Add(Capture("unreachable-blocks-and-string-leaves", null, doc => doc.Transact(t =>
    {
      var blocks = doc.GetMap("blocks");

      blocks.Set(t, "orphan", Block("orphan", "paragraph", "<b>lost</b> child", "nowhere"));
      blocks.Set(t, "leaf", Block("leaf", "header", "<i>leaf</i>", null, asString: true));
      doc.GetArray("root").Insert(t, 0, ["leaf"]);
    }), false, null));
    cases.Add(Capture("markup-typed-as-text", null, doc => doc.Transact(t =>
    {
      doc.GetMap("blocks").Set(t, "p", Block("p", "paragraph", "a &lt; b &amp;&amp; \"c\"", null));
      doc.GetArray("root").Insert(t, 0, ["p"]);
    }), false, null));
    cases.Add(Capture("odd-blocks-are-skipped", null, doc => doc.Transact(t =>
    {
      var blocks = doc.GetMap("blocks");

      blocks.Set(t, "junk", "not a block");
      blocks.Set(t, "untyped", new YMap([new("data", new YMap([new("text", new YText("<b>x</b>"))]))]));
      blocks.Set(t, "no-data", new YMap([new("type", "paragraph"), new("data", "oops")]));
      blocks.Set(t, "number", new YMap([new("type", "paragraph"), new("data", new YMap([new("text", 5d)]))]));
      blocks.Set(t, "done", new YMap([new("type", "paragraph"), new("data", new YMap([new("text", new YXmlText("ok"))]))]));
      blocks.Set(t, "empty", Block("empty", "quote", "", null));
    }), false, null));

    return new JsonObject
    {
      ["$comment"] = "Captured from C# by YDocConverterMigrationCaptureTests. Do not edit by hand. A room names a collab-format1 case or carries its own update.",
      ["editClient"] = EditClient,
      ["cases"] = cases,
    };
  }

  private static JsonObject Capture(
      string name, string? room, Action<YDoc>? write, bool stringLeaves, Dictionary<string, IList<string>>? custom)
  {
    var result = new JsonObject { ["name"] = name };
    byte[] roomUpdate;

    if (room is not null)
    {
      result["room"] = room;
      roomUpdate = YDocConverterFixtures.LoadFormat1(room).Update;
    }
    else
    {
      var seed = new YDoc(1);

      write!(seed);
      roomUpdate = seed.EncodeStateAsUpdate();
      result["roomUpdate"] = Convert.ToBase64String(roomUpdate);
    }

    if (stringLeaves)
    {
      // As the released client stored a rich field: a plain string leaf.
      var shaped = new YDoc(ShapeClient);

      shaped.ApplyUpdate(roomUpdate);

      var vector = shaped.EncodeStateVector();

      YDocConverterMigrationTests.StringLeaves(shaped);
      result["shapeUpdate"] = Convert.ToBase64String(shaped.EncodeStateAsUpdate(vector));
    }

    var fields = custom is null ? RichTextFields.BuiltIn : RichTextFields.With(custom);

    if (custom is not null)
    {
      result["customFields"] = JsonSerializer.SerializeToNode(custom);
    }

    var doc = new YDoc(EditClient);

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(roomUpdate).Outcome);

    if (result["shapeUpdate"] is JsonValue shape)
    {
      doc.ApplyUpdate(Convert.FromBase64String(shape.GetValue<string>()));
    }

    var found = YDocConverter.CollectLegacyRichText(doc, fields);
    var read = found.Count == 0
      ? []
      : RichTextRuntime.Reader.ReadAsync(found).AsTask().GetAwaiter().GetResult();
    var table = new Dictionary<string, JsonArray>(StringComparer.Ordinal);
    var html = new JsonArray();

    for (var index = 0; index < found.Count; index++)
    {
      table[found[index].Html] = read[index];
      html.Add(new JsonObject
      {
        ["type"] = found[index].Type,
        ["field"] = found[index].Field,
        ["html"] = found[index].Html,
        ["segments"] = read[index].DeepClone(),
      });
    }

    result["found"] = html;

    if (found.Count > 0)
    {
      // Nothing is answered: the migration refuses and writes nothing.
      var vector = Convert.ToBase64String(doc.EncodeStateVector());

      result["refusing"] = Assert.Throws<InvalidDataException>(
          () => YDocConverter.MigrateRichText(doc, RichTextInput.Refusing(fields))).Message;
      Assert.Equal(vector, Convert.ToBase64String(doc.EncodeStateVector()));
    }

    var updates = new JsonArray();

    doc.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        updates.Add(Convert.ToBase64String(update.Update));
      }
    };

    result["migrated"] = YDocConverter.MigrateRichText(doc, RichTextInput.Converting(fields, table));
    result["updates"] = updates;
    result["export"] = YDocConverter.Export(doc, fields, null, out _);
    // A second run finds nothing left to migrate.
    Assert.Empty(YDocConverter.CollectLegacyRichText(doc, fields));

    return result;
  }

  private static YMap Block(string id, string type, string html, string? parentId, bool asString = false)
  {
    var entries = new List<KeyValuePair<string, object?>>
    {
      new("id", id),
      new("type", type),
      new("data", new YMap([new KeyValuePair<string, object?>("text", asString ? html : new YText(html))])),
    };

    if (parentId is not null)
    {
      entries.Add(new("parentId", parentId));
    }

    return new YMap(entries);
  }
}
