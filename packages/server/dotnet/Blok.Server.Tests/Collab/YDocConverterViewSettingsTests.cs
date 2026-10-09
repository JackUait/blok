using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A database view's <c>calculations</c> is born empty and two peers add to
/// it, so the server must mint it as a <see cref="YArray"/> the way the client
/// does. JSON export cannot tell a plain array from a YArray, so this checks
/// the representation.
/// </summary>
public sealed class YDocConverterViewSettingsTests
{
  [Fact]
  public void SeedMintsAnEmptyCalculationListAsAYArray()
  {
    var doc = Seeded();

    var calculations = Assert.IsType<YArray>(Entry(View(doc, "v1"), "calculations"));

    Assert.Empty(calculations.Enumerate());
  }

  [Fact]
  public void SeedMintsTheEmptyFilterColorAndGroupListsAsYArrays()
  {
    var view = View(Seeded(), "v1");
    var tree = Assert.IsType<YMap>(Entry(view, "filterTree"));

    Assert.Empty(Assert.IsType<YArray>(Entry(tree, "filterRules")).Enumerate());
    Assert.Empty(Assert.IsType<YArray>(Entry(view, "colorRules")).Enumerate());
    Assert.Empty(Assert.IsType<YArray>(Entry(view, "groupStates")).Enumerate());
  }

  [Fact]
  public void SeedKeysIdBearingViewListsByTheirIds()
  {
    var doc = Seeded();

    // The keyed wrapper outranks the eager rule, as on the client.
    Assert.True(Keyed(Entry(View(doc, "v2"), "calculations")).ContainsKey("t"));
    Assert.True(Keyed(Entry(View(doc, "v1"), "properties")).ContainsKey("s"));
  }

  private static YDoc Seeded()
  {
    var doc = new YDoc();
    var blocks = JsonNode.Parse("""
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
              "colorRules": [],
              "groupStates": []
            },
            {
              "id": "v2", "name": "Two", "type": "table", "position": "a1",
              "sorts": [], "filters": [], "visibleProperties": [],
              "calculations": [{ "id": "t", "fn": "count" }]
            }
          ]
        }
      }]
      """)!.AsArray();

    RichTextRuntime.Seed(doc, blocks);

    return doc;
  }

  private static Dictionary<string, YMap> Keyed(object? wrapper)
  {
    var rows = Assert.IsType<YMap>(Entry(Assert.IsType<YMap>(wrapper), "__rows"));

    return rows.Keys.ToDictionary(key => key, key => Assert.IsType<YMap>(Entry(rows, key)));
  }

  private static YMap View(YDoc doc, string id)
  {
    var data = Assert.IsType<YMap>(Entry(Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), "db")), "data"));

    return Keyed(Entry(data, "views"))[id];
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
