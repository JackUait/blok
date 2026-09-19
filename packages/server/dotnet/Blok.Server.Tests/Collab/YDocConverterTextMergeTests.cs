using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A block's mergeable text must reach the doc as a <see cref="YText"/>, not a
/// plain string, so two people typing in one paragraph keep both bursts.
///
/// These assertions are at the CRDT REPRESENTATION level on purpose: a plain
/// string and a YText export to IDENTICAL JSON, so the conformance suite's
/// JSON comparison cannot see the difference — which is how the plain string
/// shipped unnoticed.
/// </summary>
public sealed class YDocConverterTextMergeTests
{
  [Fact]
  public void SeedStoresBlockTextAsAYText()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "hello" } }""");

    Assert.Equal("hello", Assert.IsType<YText>(DataValue(doc, "p", "text")).ToString());
  }

  /// <summary>Empty paragraph data is normalized to { text: "" } — still a YText.</summary>
  [Fact]
  public void SeedStoresTheNormalizedEmptyParagraphTextAsAYText()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": {} }""");

    Assert.Equal(string.Empty, Assert.IsType<YText>(DataValue(doc, "p", "text")).ToString());
  }

  /// <summary>A re-seed must not DOWNGRADE the key back to a plain string.</summary>
  [Fact]
  public void ReseedingTheSameDocumentStillMintsAYText()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "one" } }""");

    YDocConverter.Seed(
        doc,
        new JsonArray(
            JsonNode.Parse("""{ "id": "p", "type": "paragraph", "data": { "text": "two" } }""")));

    Assert.Equal("two", Assert.IsType<YText>(DataValue(doc, "p", "text")).ToString());
  }

  /// <summary>Mirrors the client: only a STRING under the key becomes a YText.</summary>
  [Fact]
  public void SeedKeepsANonStringTextAtomic()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": 42 } }""");

    Assert.Equal(42d, DataValue(doc, "p", "text"));
  }

  /// <summary>Mirrors the client: TOP-LEVEL block data only, never a nested text.</summary>
  [Fact]
  public void SeedKeepsANestedTextAtomic()
  {
    var doc = SeededDoc(
        """{ "id": "t", "type": "table", "data": { "cell": { "text": "inner" } } }""");

    var cell = Assert.IsType<YMap>(DataValue(doc, "t", "cell"));

    Assert.True(cell.TryGet("text", out var inner));
    Assert.Equal("inner", inner);
  }

  /// <summary>Tunes are not block data; a text there stays an atomic leaf.</summary>
  [Fact]
  public void SeedKeepsATuneTextAtomic()
  {
    var doc = SeededDoc(
        """{ "id": "p", "type": "paragraph", "data": {}, "tunes": { "text": "tuned" } }""");

    var tunes = Assert.IsType<YMap>(Entry(Block(doc, "p"), "tunes"));

    Assert.True(tunes.TryGet("text", out var value));
    Assert.Equal("tuned", value);
  }

  /// <summary>An update op must edit the live YText, not replace the whole data map.</summary>
  [Fact]
  public void UpdateKeepsTheSameYTextInstance()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "hello" } }""");
    var before = Assert.IsType<YText>(DataValue(doc, "p", "text"));

    Apply(doc, """{ "op": "update", "id": "p", "data": { "text": "hello!" } }""");

    var after = Assert.IsType<YText>(DataValue(doc, "p", "text"));

    Assert.Same(before, after);
    Assert.Equal("hello!", after.ToString());
  }

  /// <summary>
  /// The defect in user terms: a peer typing into the paragraph while the host
  /// pushes an update op through /edit must not lose the burst.
  /// </summary>
  [Fact]
  public void AnUpdateOpAndAPeersTypingBothSurvive()
  {
    var server = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "hello" } }""");
    var peer = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        peer.ApplyUpdate(server.EncodeStateAsUpdate(peer.EncodeStateVector())).Outcome);

    // The peer types " world" at the end of the paragraph.
    var peerText = Assert.IsType<YText>(DataValue(peer, "p", "text"));
    peer.Transact(transaction => peerText.Insert(transaction, 5, " world"));

    // At the same moment the host pushes an edit that appends "!".
    Apply(server, """{ "op": "update", "id": "p", "data": { "text": "hello!" } }""");

    Exchange(server, peer);

    var merged = Assert.IsType<YText>(DataValue(server, "p", "text")).ToString();

    Assert.Contains(" world", merged, StringComparison.Ordinal);
    Assert.Contains("!", merged, StringComparison.Ordinal);
    Assert.Equal("hello world!".Length, merged.Length);
    Assert.Equal(merged, Assert.IsType<YText>(DataValue(peer, "p", "text")).ToString());
  }

  /// <summary>An update still drops the keys the new data does not carry.</summary>
  [Fact]
  public void UpdateStillDropsTheKeysTheNewDataOmits()
  {
    var doc = SeededDoc(
        """{ "id": "p", "type": "paragraph", "data": { "text": "old", "level": 3 } }""");

    Apply(doc, """{ "op": "update", "id": "p", "data": { "text": "new" } }""");

    var data = Assert.IsType<YMap>(Entry(Block(doc, "p"), "data"));

    Assert.Equal(["text"], data.Keys.ToArray());
  }

  private static void Exchange(YDoc left, YDoc right)
  {
    var toRight = left.EncodeStateAsUpdate(right.EncodeStateVector());
    var toLeft = right.EncodeStateAsUpdate(left.EncodeStateVector());

    Assert.Equal(ApplyOutcome.Applied, right.ApplyUpdate(toRight).Outcome);
    Assert.Equal(ApplyOutcome.Applied, left.ApplyUpdate(toLeft).Outcome);
  }

  private static YDoc SeededDoc(params string[] blockJson)
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray()));

    return doc;
  }

  private static void Apply(YDoc doc, params string[] opJson)
  {
    YDocConverter.ApplyOps(
        doc,
        CollabEditOps.Parse(
            Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }""")));
  }

  private static YMap Block(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id));
  }

  private static object? DataValue(YDoc doc, string id, string key)
  {
    return Entry(Assert.IsType<YMap>(Entry(Block(doc, id), "data")), key);
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
