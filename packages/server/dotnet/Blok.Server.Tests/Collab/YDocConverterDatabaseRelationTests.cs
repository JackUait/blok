using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A relation value is a list of <c>{ "id": rowId }</c> objects under a
/// nanoid property id inside a row's <c>properties</c>. No key-name rule can
/// name it, so its merge rests on the generic identity rule
/// (<c>IsIdentityArray</c>): every element is a plain object with a unique
/// string id, so the list is stored keyed by id and two peers' adds both
/// survive. Nothing here is relation-specific code; the tests pin that the
/// server keeps the shape the client relies on.
///
/// LOCKSTEP: <c>isIdentityArray</c> / <c>plainToIdentityMap</c> in
/// src/components/modules/yjs/serializer.ts, and
/// test/unit/tools/database/concurrent-relation-values.test.ts.
/// </summary>
public sealed class YDocConverterDatabaseRelationTests
{
  private const string RowWithRelation =
      """
      { "id": "r1", "type": "database-row",
        "data": { "title": "Alpha", "properties": { "rel": [{ "id": "z" }] } } }
      """;

  [Fact]
  public void SeedStoresARelationValueKeyedById()
  {
    var doc = SeededDoc(RowWithRelation);
    var properties = Assert.IsType<YMap>(DataValue(doc, "r1", "properties"));

    Assert.True(properties.TryGet("rel", out var relation));
    Assert.IsNotType<string>(relation);
    Assert.IsNotType<YArray>(relation);
    Assert.Equal(["z"], RelatedIds(doc));
  }

  [Fact]
  public void TwoPeersRelatingDifferentRowsAtOnceKeepBoth()
  {
    var server = SeededDoc(RowWithRelation);
    var peer = Peer(server);

    Apply(server, """{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "b" }] } } }""");
    Apply(peer, """{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "c" }] } } }""");
    Exchange(server, peer);

    Assert.Equal(["b", "c", "z"], RelatedIds(server));
    Assert.Equal(["b", "c", "z"], RelatedIds(peer));
  }

  [Fact]
  public void ARemovalAndAnAddMadeAtOnceKeepTheAdd()
  {
    var server = SeededDoc(
        """
        { "id": "r1", "type": "database-row",
          "data": { "properties": { "rel": [{ "id": "z" }, { "id": "y" }] } } }
        """);
    var peer = Peer(server);

    Apply(server, """{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "y" }] } } }""");
    Apply(peer, """{ "op": "update", "id": "r1", "data": { "properties": { "rel": [{ "id": "z" }, { "id": "y" }, { "id": "c" }] } } }""");
    Exchange(server, peer);

    Assert.Equal(["c", "y"], RelatedIds(server));
    Assert.Equal(RelatedIds(server), RelatedIds(peer));
  }

  private static string[] RelatedIds(YDoc doc)
  {
    var block = YDocConverter.Export(doc).AsArray().First(node => node?["id"]?.GetValue<string>() == "r1");
    var relation = block?["data"]?["properties"]?["rel"]?.AsArray() ?? [];

    return relation.Select(item => item?["id"]?.GetValue<string>() ?? "").OrderBy(id => id, StringComparer.Ordinal).ToArray();
  }

  private static YDoc Peer(YDoc server)
  {
    var peer = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        peer.ApplyUpdate(server.EncodeStateAsUpdate(peer.EncodeStateVector())).Outcome);

    return peer;
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

  private static object? DataValue(YDoc doc, string id, string key)
  {
    var block = Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id));
    var data = Assert.IsType<YMap>(Entry(block, "data"));

    return Entry(data, key);
  }

  private static object? Entry(YMap map, string key)
  {
    return map.TryGet(key, out var value) ? value : null;
  }
}
