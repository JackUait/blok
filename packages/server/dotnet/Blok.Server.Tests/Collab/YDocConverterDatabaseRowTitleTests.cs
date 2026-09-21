using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A <c>database-row</c> block's TOP-LEVEL <c>title</c> must behave on the
/// server exactly as a paragraph's <c>text</c> does: minted as a
/// <see cref="YText"/> whoever seeds the document, edited in place by
/// <c>/edit</c>, and merged per character with a peer typing at the same
/// moment.
///
/// The rule is key-based, never type-based — <c>title</c> is one of the keys
/// <c>DiffableTextKeys</c> names — so nothing here is a database feature. The
/// tests exist because a server-seeded row that came out a plain string would
/// never merge again for the rest of that document's life.
///
/// Assertions are at the CRDT REPRESENTATION level on purpose: a plain string
/// and a YText export to IDENTICAL JSON, so a JSON comparison cannot see the
/// difference.
///
/// LOCKSTEP: the client side of the same rule is <c>DIFFABLE_TEXT_KEYS</c> /
/// <c>isDiffableTextKey</c> in src/components/modules/yjs/serializer.ts.
/// </summary>
public sealed class YDocConverterDatabaseRowTitleTests
{
  private const string RowWithTitle =
      """
      { "id": "r1", "type": "database-row",
        "data": { "title": "Ship it", "properties": { "status": "todo" } } }
      """;

  /// <summary>A row a client wrote and the server seeded from JSON.</summary>
  [Fact]
  public void SeedStoresADatabaseRowTitleAsAYText()
  {
    var doc = SeededDoc(RowWithTitle);

    Assert.Equal("Ship it", Assert.IsType<YText>(DataValue(doc, "r1", "title")).ToString());
  }

  /// <summary>Rows are born through /edit inserts, not only through a seed.</summary>
  [Fact]
  public void AnInsertOpMintsAYTextForTheRowTitle()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "" } }""");

    Apply(
        doc,
        """
        { "op": "insert", "id": "r1", "after": "p",
          "block": { "type": "database-row", "data": { "title": "Ship it" } } }
        """);

    Assert.Equal("Ship it", Assert.IsType<YText>(DataValue(doc, "r1", "title")).ToString());
  }

  /// <summary>An /edit must EDIT the live YText, not set a fresh value over it.</summary>
  [Fact]
  public void AnEditKeepsTheSameYTextInstanceForTheRowTitle()
  {
    var doc = SeededDoc(RowWithTitle);
    var before = Assert.IsType<YText>(DataValue(doc, "r1", "title"));

    Apply(doc, """{ "op": "update", "id": "r1", "data": { "title": "Ship it!" } }""");

    var after = Assert.IsType<YText>(DataValue(doc, "r1", "title"));

    Assert.Same(before, after);
    Assert.Equal("Ship it!", after.ToString());
  }

  /// <summary>
  /// The case that matters: the row was seeded BY THE SERVER, and a client
  /// then types into its title while the server pushes an /edit. Both bursts
  /// must survive, character by character.
  /// </summary>
  [Fact]
  public void AServerSeededRowMergesAClientsTypingWithAnEdit()
  {
    var server = SeededDoc(RowWithTitle);
    var client = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        client.ApplyUpdate(server.EncodeStateAsUpdate(client.EncodeStateVector())).Outcome);

    // The client types " now" at the end of the title.
    var clientTitle = Assert.IsType<YText>(DataValue(client, "r1", "title"));
    client.Transact(transaction => clientTitle.Insert(transaction, "Ship it".Length, " now"));

    // At the same moment the server pushes an edit that prepends "Do ".
    Apply(server, """{ "op": "update", "id": "r1", "data": { "title": "Do Ship it" } }""");

    Exchange(server, client);

    var merged = Assert.IsType<YText>(DataValue(server, "r1", "title")).ToString();

    Assert.Equal("Do Ship it now", merged);
    Assert.Equal(merged, Assert.IsType<YText>(DataValue(client, "r1", "title")).ToString());
  }

  /// <summary>Two clients typing into one row title keep both bursts.</summary>
  [Fact]
  public void TwoClientsTypingInOneRowTitleKeepBothBursts()
  {
    var server = SeededDoc(RowWithTitle);
    var left = Peer(server);
    var right = Peer(server);

    Type(left, 0, "A ");
    Type(right, "Ship it".Length, " B");

    Exchange(server, left);
    Exchange(server, right);
    Exchange(server, left);

    Assert.Equal("A Ship it B", Title(server));
    Assert.Equal("A Ship it B", Title(left));
    Assert.Equal("A Ship it B", Title(right));
  }

  /// <summary>
  /// A row written BEFORE the top-level title existed keeps its title inside
  /// <c>properties</c>, where it is a NESTED key and therefore an ordinary
  /// atomic leaf — exactly as on the client, where only top-level data keys
  /// are diffable.
  /// </summary>
  [Fact]
  public void AnOldRowKeepsItsNestedTitleAtomic()
  {
    var doc = SeededDoc(
        """
        { "id": "r0", "type": "database-row",
          "data": { "properties": { "title": "Legacy", "status": "todo" } } }
        """);

    var properties = Assert.IsType<YMap>(DataValue(doc, "r0", "properties"));

    Assert.True(properties.TryGet("title", out var nested));
    Assert.Equal("Legacy", nested);
  }

  /// <summary>
  /// Promotion is forbidden on both sides: a whole-key set is
  /// last-writer-wins, so inventing a top-level <c>title</c> for an old row
  /// would be a data-losing write nobody asked for. The server must leave the
  /// row exactly as it found it.
  /// </summary>
  [Fact]
  public void TheServerNeverInventsATopLevelTitleForAnOldRow()
  {
    var doc = SeededDoc(
        """
        { "id": "r0", "type": "database-row",
          "data": { "properties": { "title": "Legacy" } } }
        """);

    Assert.Equal(["properties"], Data(doc, "r0").Keys.ToArray());

    // An edit that does not carry a title must not grow one either.
    Apply(
        doc,
        """
        { "op": "update", "id": "r0",
          "data": { "properties": { "title": "Legacy", "status": "done" } } }
        """);

    Assert.Equal(["properties"], Data(doc, "r0").Keys.ToArray());
    Assert.Equal(
        JsonNode.Parse(
            """
            [{ "id": "r0", "type": "database-row",
               "data": { "properties": { "title": "Legacy", "status": "done" } } }]
            """)!.ToJsonString(),
        YDocConverter.Export(doc).ToJsonString());
  }

  private static YDoc Peer(YDoc server)
  {
    var peer = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        peer.ApplyUpdate(server.EncodeStateAsUpdate(peer.EncodeStateVector())).Outcome);

    return peer;
  }

  private static void Type(YDoc doc, int index, string characters)
  {
    var title = Assert.IsType<YText>(DataValue(doc, "r1", "title"));

    doc.Transact(transaction => title.Insert(transaction, index, characters));
  }

  private static string Title(YDoc doc)
  {
    return Assert.IsType<YText>(DataValue(doc, "r1", "title")).ToString();
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

  private static YMap Data(YDoc doc, string id)
  {
    var block = Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id));

    return Assert.IsType<YMap>(Entry(block, "data"));
  }

  private static object? DataValue(YDoc doc, string id, string key)
  {
    return Entry(Data(doc, id), key);
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
