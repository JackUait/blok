using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Row keys never reach exported JSON, so the conformance suite cannot see the
/// server keying a table row differently from the client. These tests assert
/// the KEYS on both sides of the `table-row-ids` fixture: the doc the server
/// seeds from input.json, and the doc the JS client produced (update.b64).
/// </summary>
public sealed class YDocConverterTableRowIdsTests
{
  private const string CaseName = "table-row-ids";

  private static readonly string[] CellRowIds = ["r0", "r1", "rX"];

  [Fact]
  public void ServerSeedKeysARowByItsRowId()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, YDocConverterFixtures.Load(CaseName).Input);

    AssertRowKeys(doc);
  }

  [Fact]
  public void TheClientUpdateKeysTheRowsTheSameWay()
  {
    var doc = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        doc.ApplyUpdate(YDocConverterFixtures.Load(CaseName).Update).Outcome);

    AssertRowKeys(doc);
  }

  /// <summary>
  /// Row 0 is keyed by its row id. Row 1's cells disagree and row 2 is empty,
  /// so both get a minted key that is neither of the ids.
  /// </summary>
  private static void AssertRowKeys(YDoc doc)
  {
    var data = Assert.IsType<YMap>(Entry(Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), "tr1")), "data"));
    var grid = Assert.IsType<YMap>(Entry(data, "content"));
    var keys = Assert.IsType<YArray>(Entry(grid, "__rowKeys"))
        .Enumerate()
        .Select(key => Assert.IsType<string>(key))
        .ToArray();

    Assert.Equal(3, keys.Length);
    Assert.Equal("r0", keys[0]);
    Assert.DoesNotContain(keys[1], CellRowIds);
    Assert.DoesNotContain(keys[2], CellRowIds);
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
