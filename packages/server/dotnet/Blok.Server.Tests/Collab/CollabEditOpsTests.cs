using System.Text;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The POST /sync/{doc}/edit request schema: what a consumer backend may say,
/// and the NUL screen every string passes before the doc is touched.
/// </summary>
public sealed class CollabEditOpsTests
{
  [Fact]
  public void ParsesTheThreeOpsInRequestOrder()
  {
    var ops = Parse(
        """
        { "ops": [
          { "op": "insert", "id": "b1",
            "block": { "type": "paragraph", "data": { "text": "hi" } },
            "after": "b0", "parent": "p1" },
          { "op": "update", "id": "b2", "data": { "text": "bye" } },
          { "op": "remove", "id": "b3" }
        ] }
        """);

    var insert = Assert.IsType<CollabEditOp.Insert>(ops[0]);
    Assert.Equal("b1", insert.Id);
    Assert.Equal("paragraph", insert.Block["type"]?.GetValue<string>());
    Assert.Equal("b0", insert.After);
    Assert.Equal("p1", insert.Parent);
    var update = Assert.IsType<CollabEditOp.Update>(ops[1]);
    Assert.Equal("b2", update.Id);
    Assert.Equal("bye", update.Data["text"]?.GetValue<string>());
    Assert.Equal("b3", Assert.IsType<CollabEditOp.Remove>(ops[2]).Id);
  }

  /// <summary>Absent and explicit null mean the same: first child of the root.</summary>
  [Theory]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} } }""")]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
        "after": null, "parent": null }
      """)]
  public void AnInsertWithoutAfterOrParentPlacesFirstUnderTheRoot(string op)
  {
    var insert = Assert.IsType<CollabEditOp.Insert>(Parse($$"""{ "ops": [{{op}}] }""")[0]);

    Assert.Null(insert.After);
    Assert.Null(insert.Parent);
  }

  [Fact]
  public void KeepsTheOptionalBlockMembersTheConverterWrites()
  {
    var insert = Assert.IsType<CollabEditOp.Insert>(Parse(
        """
        { "ops": [{ "op": "insert", "id": "b1", "block": {
          "id": "b1", "type": "paragraph", "data": { "text": "hi" },
          "tunes": { "align": "left" },
          "lastEditedAt": 17, "lastEditedBy": "u1" } }] }
        """)[0]);

    Assert.Equal("left", insert.Block["tunes"]?["align"]?.GetValue<string>());
    Assert.Equal(17, insert.Block["lastEditedAt"]?.GetValue<int>());
    Assert.Equal("u1", insert.Block["lastEditedBy"]?.GetValue<string>());
  }

  [Theory]
  [InlineData("not json at all", "not valid JSON")]
  [InlineData("", "not valid JSON")]
  [InlineData("""{ "ops": [{ "op": "remove", "id": "a", "id": "b" }] }""", "not valid JSON")]
  [InlineData("[]", "ops")]
  [InlineData("null", "ops")]
  [InlineData("""{ "ops": {} }""", "ops")]
  [InlineData("""{ "ops": [] }""", "ops")]
  public void RejectsAnEnvelopeThatIsNotANonEmptyOpsArray(string body, string mentions)
  {
    Assert.Contains(mentions, Refused(body), StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("""{ "op": "move", "id": "b1" }""")]
  [InlineData("""{ "op": 7, "id": "b1" }""")]
  [InlineData("""{ "id": "b1" }""")]
  [InlineData("""["remove", "b1"]""")]
  [InlineData("null")]
  [InlineData("""{ "op": "remove" }""")]
  [InlineData("""{ "op": "remove", "id": "" }""")]
  [InlineData("""{ "op": "remove", "id": 7 }""")]
  [InlineData("""{ "op": "remove", "id": "b1", "data": {} }""")]
  [InlineData("""{ "op": "insert", "id": "b1" }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": [] }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "data": {} } }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "", "data": {} } }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "p" } }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "p", "data": [] } }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "id": "x", "type": "p", "data": {} } }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "parent": "p" } }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "content": [] } }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "extra": 1 } }""")]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "after": 7 }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "parent": "" }""")]
  [InlineData("""{ "op": "update", "id": "b1" }""")]
  [InlineData("""{ "op": "update", "id": "b1", "data": "text" }""")]
  [InlineData("""{ "op": "update", "id": "b1", "data": null }""")]
  public void RejectsASchemaViolationNamingTheFailingOp(string op)
  {
    // Index 1: the message must name the op that failed, not the request.
    var message = Refused($$"""{ "ops": [{ "op": "remove", "id": "ok" }, {{op}}] }""");

    Assert.StartsWith("collab: op 1:", message, StringComparison.Ordinal);
  }

  /// <summary>
  /// The NUL law reaches every string in the request, not just the ids: yrs
  /// truncates one on write and ABORTS THE PROCESS on read, so an edit
  /// carrying one is refused before the doc is touched.
  /// </summary>
  [Theory]
  [InlineData("""{ "op": "remove", "id": "b\u00001" }""")]
  [InlineData(
      """{ "op": "insert", "id": "b\u00001", "block": { "type": "p", "data": {} } }""")]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
        "after": "a\u00000" }
      """)]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p", "data": {} },
        "parent": "p\u00000" }
      """)]
  [InlineData("""{ "op": "insert", "id": "b1", "block": { "type": "p\u0000p", "data": {} } }""")]
  [InlineData(
      """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": { "te\u0000xt": "hi" } } }""")]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p",
        "data": { "rows": [{ "cell": "a\u0000b" }] } } }
      """)]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p", "data": {},
        "tunes": { "align": "le\u0000ft" } } }
      """)]
  [InlineData(
      """
      { "op": "insert", "id": "b1", "block": { "type": "p", "data": {},
        "lastEditedBy": "u\u00001" } }
      """)]
  [InlineData("""{ "op": "update", "id": "b1", "data": { "text": "hi\u0000" } }""")]
  [InlineData("""{ "op": "update", "id": "b1", "data": { "k\u0000": 1 } }""")]
  public void RejectsANulInEveryStringPosition(string op)
  {
    var message = Refused($$"""{ "ops": [{{op}}] }""");

    Assert.StartsWith("collab: op 0:", message, StringComparison.Ordinal);
    Assert.Contains("NUL", message, StringComparison.Ordinal);
  }

  [Fact]
  public void RejectsABodyNestedDeeperThanTheJsonReaderAllows()
  {
    var deep = new string('[', YDocConverter.JsonMaxDepth + 2) +
        new string(']', YDocConverter.JsonMaxDepth + 2);

    Assert.Contains(
        "not valid JSON",
        Refused($$"""{ "ops": [{ "op": "update", "id": "b1", "data": {{deep}} }] }"""),
        StringComparison.Ordinal);
  }

  private static IReadOnlyList<CollabEditOp> Parse(string body)
  {
    return CollabEditOps.Parse(Encoding.UTF8.GetBytes(body));
  }

  private static string Refused(string body)
  {
    return Assert.Throws<CollabEditException>(() => Parse(body)).Message;
  }
}
