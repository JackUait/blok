using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The doc reads restore and history build on, captured into
/// fixtures/collab-structure/cases.json: DescribeStructure, ReadPageMaps (each
/// value's kind), PlainPageMaps (with and without the title skipped) and
/// PlainMapValuesEqual over every pair of page-map values. Docs are the
/// client-written rooms of fixtures/collab plus shapes written here as client
/// 1. The Go server must read the same (internal/collab/convert/structure_test.go).
/// Set BLOK_WRITE_COLLAB_STRUCTURE=1 to rewrite the file after an intended change.
/// </summary>
public sealed class YDocConverterStructureCaptureTests
{
  private const string FileName = "collab-structure/cases.json";

  [Fact]
  public void TheCaptureMatchesTheDocReads()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true, MaxDepth = 2048 }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_STRUCTURE") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_STRUCTURE=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static JsonObject Build()
  {
    var cases = new JsonArray();

    foreach (var name in YDocConverterFixtures.CaseNames())
    {
      var doc = new YDoc();

      doc.ApplyUpdate(YDocConverterFixtures.Load(name).Update);
      cases.Add(Capture(new JsonObject { ["name"] = name, ["room"] = name }, doc));
    }

    foreach (var (name, write) in Shapes())
    {
      var doc = new YDoc(1);

      write(doc);
      cases.Add(Capture(
          new JsonObject { ["name"] = name, ["roomUpdate"] = Convert.ToBase64String(doc.EncodeStateAsUpdate()) },
          doc));
    }

    return new JsonObject
    {
      ["$comment"] = "Captured from C# by YDocConverterStructureCaptureTests. Do not edit by hand. A room names a fixtures/collab case or carries its own update.",
      ["cases"] = cases,
    };
  }

  private static IEnumerable<(string, Action<YDoc>)> Shapes()
  {
    yield return ("page-map-values", doc => doc.Transact(t =>
    {
      var page = doc.GetMap("page");
      var values = doc.GetMap("values");
      var ordered = new AnyObject();

      ordered.Add("b", 1d);
      ordered.Add("2", 2d);
      ordered.Add("1", 3d);

      var o1 = new AnyObject();

      o1.Add("a", 1d);
      o1.Add("b", 2d);

      var o2 = new AnyObject();

      o2.Add("b", 2d);
      o2.Add("a", 1d);

      var o3 = new AnyObject();

      o3.Add("a", 1d);
      o3.Add("b", 2d);

      var array = new AnyArray();

      array.Add("x");
      array.Add(null);

      page.Set(t, "title", new YText("shared"));
      page.Set(t, "icon", o1);
      page.Set(t, "undefined", YUndefined.Instance);
      values.Set(t, "ordered", ordered);
      values.Set(t, "o2", o2);
      values.Set(t, "o3", o3);
      values.Set(t, "n1", 1d);
      values.Set(t, "n2", 1.5d);
      values.Set(t, "s", "text");
      values.Set(t, "s2", "text");
      values.Set(t, "flag", true);
      values.Set(t, "nothing", null);
      values.Set(t, "array", array);
      values.Set(t, "bytes", new byte[] { 1, 2 });
      values.Set(t, "map", new YMap([new("k", "v")]));
      values.Set(t, "list", new YArray(["a"]));
    }));
    // A peer can nest a value JSON cannot hold; the read leaves that key out.
    yield return ("page-map-non-json", doc => doc.Transact(t =>
    {
      var values = doc.GetMap("values");
      var big = new AnyObject();
      var bytes = new AnyArray();

      big.Add("n", new BigInteger(1));
      bytes.Add(new byte[] { 1 });
      values.Set(t, "big", big);
      values.Set(t, "bytes", bytes);
      values.Set(t, "kept", "plain");
      doc.GetMap("page").Set(t, "cover", big);
    }));
    yield return ("empty-page-maps", doc => doc.Transact(t =>
    {
      doc.GetMap("page").Set(t, "title", new YText("only shared"));
    }));
    yield return ("odd-block-entries", doc => doc.Transact(t =>
    {
      var blocks = doc.GetMap("blocks");

      blocks.Set(t, "junk", "not a block");
      blocks.Set(t, "self", new YMap([new("id", "self"), new("type", "p"), new("data", new YMap()), new("parentId", "self")]));
      blocks.Set(t, "renamed", new YMap([new("id", "other"), new("type", "p"), new("data", new YMap())]));
      blocks.Set(t, "untyped", new YMap([new("id", "untyped"), new("data", new YMap())]));
      blocks.Set(t, "flat-data", new YMap([new("id", "flat-data"), new("type", "p"), new("data", "x")]));
      blocks.Set(t, "mixed", new YMap(
      [
        new("id", "mixed"),
        new("type", "toggle"),
        new("data", new YMap()),
        new("contentIds", new YArray(["kid", 1d, "ghost"])),
      ]));
      blocks.Set(t, "kid", new YMap([new("id", "kid"), new("type", "p"), new("data", new YMap()), new("parentId", "mixed")]));
      blocks.Set(t, "a", new YMap([new("id", "a"), new("type", "p"), new("data", new YMap()), new("parentId", "b")]));
      blocks.Set(t, "b", new YMap([new("id", "b"), new("type", "p"), new("data", new YMap()), new("parentId", "a")]));
      doc.GetArray("root").Insert(t, 0, ["mixed", 2d, "self", "renamed", "missing", "mixed"]);
    }));
  }

  private static JsonObject Capture(JsonObject result, YDoc doc)
  {
    var structure = YDocConverter.DescribeStructure(doc);
    var keys = new JsonArray();

    foreach (var (id, shape) in structure.Keys.OrderBy(entry => entry.Key, StringComparer.Ordinal))
    {
      keys.Add(new JsonObject
      {
        ["id"] = id,
        ["isBlock"] = shape.IsBlock,
        ["storedParent"] = shape.StoredParent,
        ["listed"] = shape.ListedChildren is null ? null : new JsonArray([.. shape.ListedChildren.Select(child => (JsonNode)child)]),
      });
    }

    result["structure"] = new JsonObject
    {
      ["keys"] = keys,
      ["rootOrder"] = new JsonArray([.. structure.RootOrder.Select(id => (JsonNode)id)]),
      ["reached"] = new JsonArray([.. structure.ReachedInMainPass.Order(StringComparer.Ordinal).Select(id => (JsonNode)id)]),
    };

    var kinds = new JsonObject();
    var plainValues = new List<(string Name, object? Value)>();

    foreach (var name in YDocConverter.PageMaps)
    {
      var entries = new JsonObject();

      foreach (var (key, value) in YDocConverter.ReadPageMaps(doc).Maps[name].OrderBy(entry => entry.Key, StringComparer.Ordinal))
      {
        entries[key] = Kind(value);
        plainValues.Add(($"{name}.{key}", value));
      }

      kinds[name] = entries;
    }

    result["pageMaps"] = kinds;
    result["plainPageMaps"] = PlainMaps(doc, null);
    result["plainPageMapsSkippingTitle"] = PlainMaps(doc, ["title"]);

    var equal = new JsonArray();

    for (var left = 0; left < plainValues.Count; left++)
    {
      for (var right = left + 1; right < plainValues.Count; right++)
      {
        if (YDocConverter.PlainMapValuesEqual(plainValues[left].Value, plainValues[right].Value))
        {
          equal.Add(new JsonArray(plainValues[left].Name, plainValues[right].Name));
        }
      }
    }

    result["equalPairs"] = equal;

    return result;
  }

  private static JsonArray PlainMaps(YDoc doc, IReadOnlyCollection<string>? skip)
  {
    var maps = new JsonArray();

    foreach (var (name, map) in YDocConverter.PlainPageMaps(doc, skip))
    {
      maps.Add(new JsonObject { ["name"] = name, ["map"] = map.DeepClone() });
    }

    return maps;
  }

  private static string Kind(object? value)
  {
    return value switch
    {
      null => "null",
      string => "string",
      double => "number",
      bool => "bool",
      AnyObject => "object",
      AnyArray => "array",
      byte[] => "bytes",
      YUndefined => "undefined",
      YMap => "YMap",
      YArray => "YArray",
      YXmlText => "YXmlText",
      YText => "YText",
      _ => value.GetType().Name,
    };
  }
}
