using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The conformance suite compares EXPORTED JSON, and a plain array and a
/// <see cref="YArray"/> export to the SAME JSON — so no fixture can catch the
/// server minting a plain array where the client mints a YArray. These tests
/// assert the REPRESENTATION instead, on both sides of the `cell-block-ids`
/// fixture: the doc the server seeds from input.json, and the doc the JS
/// client actually produced (update.b64). A divergence there is silent in
/// JSON and loses a child block the moment two peers insert into one cell.
/// </summary>
public sealed class YDocConverterCellBlockIdsTests
{
  private const string CaseName = "cell-block-ids";

  [Fact]
  public void ServerSeedMintsTheCellIdListAsAYArray()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, YDocConverterFixtures.Load(CaseName).Input);

    AssertCellBlockIdsAreYArrays(doc);
  }

  [Fact]
  public void TheClientUpdateCarriesTheSameRepresentation()
  {
    var doc = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        doc.ApplyUpdate(YDocConverterFixtures.Load(CaseName).Update).Outcome);

    AssertCellBlockIdsAreYArrays(doc);
  }

  /// <summary>
  /// Both cells of row 0 — the POPULATED one and the EMPTY one, because the
  /// empty case is the one the generic array rule would leave a plain leaf and
  /// the one whose later promotion would race two peers.
  /// </summary>
  private static void AssertCellBlockIdsAreYArrays(YDoc doc)
  {
    var row0 = Row(doc, "tb1", 0);

    var populated = Assert.IsType<YArray>(Entry(Assert.IsType<YMap>(row0.Get(0)), "blocks"));
    var empty = Assert.IsType<YArray>(Entry(Assert.IsType<YMap>(row0.Get(1)), "blocks"));

    Assert.Equal(["p1", "p2"], populated.Enumerate().Select(value => (string?)value));
    Assert.Empty(empty.Enumerate());

    // A merged-cell marker under the same cell map is NOT an id list and keeps
    // the generic rules; so does a sibling primitive array on the block.
    var merged = Assert.IsType<YMap>(Row(doc, "tb1", 1).Get(1));

    Assert.IsNotType<YArray>(Entry(merged, "mergedInto"));
    Assert.IsNotType<YArray>(Entry(Data(doc, "tb1"), "colWidths"));

    // NESTED only: a `blocks` key nested in a plain object IS one, a block's
    // TOP-LEVEL `data.blocks` is not — the client draws the line in the same
    // place, because blockDataToYMap never consults the key set.
    Assert.IsType<YArray>(Entry(Assert.IsType<YMap>(Entry(Data(doc, "tb2"), "panel")), "blocks"));
    Assert.IsNotType<YArray>(Entry(Data(doc, "tb2"), "blocks"));
  }

  private static YArray Row(YDoc doc, string id, int index)
  {
    var grid = Assert.IsType<YMap>(Entry(Data(doc, id), "content"));
    var rows = Assert.IsType<YMap>(Entry(grid, "__rows"));
    var order = Assert.IsType<YArray>(Entry(grid, "__rowKeys"));
    var key = Assert.IsType<string>(order.Get(index));

    return Assert.IsType<YArray>(Entry(rows, key));
  }

  private static YMap Data(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(Entry(Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id)), "data"));
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
