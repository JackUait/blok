using System.Net;
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary><c>databases=keep|restore</c> on restore and restore/preview.</summary>
public sealed partial class HistoryEndpointTests
{
  private const string TableData = """{ "schema": [{ "id": "t", "type": "title" }], "views": [] }""";

  /// <summary>A toggle made after point 0, holding a database: a keep restore to 0 would orphan it.</summary>
  private static async Task<string> DatabaseInANewToggleAsync(HistoryApp history)
  {
    var lineage = await history.OpenAsync();
    await history.EditAsync("toggle", """{ "ops": [ { "op": "insert", "id": "t", "block": { "type": "toggle", "data": {} } } ] }""");
    await history.EditAsync("database", $$"""{ "ops": [ { "op": "insert", "id": "d", "parent": "t", "block": { "type": "database", "data": {{TableData}} } } ] }""");

    return lineage;
  }

  [Theory]
  [InlineData("?databases=")]
  [InlineData("?databases=Keep")]
  [InlineData("?databases=none")]
  [InlineData("?databases=keep&databases=keep")]
  public async Task ADatabasesOtherThanKeepOrRestoreIsABadRequest(string query)
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var restore = await Send(history.App, HttpMethod.Post, $"/history/{lineage}/0/restore{query}", key: "bad");
    using var preview = await history.SendAsync(HttpMethod.Post, $"/history/{lineage}/0/restore/preview{query}");

    await AssertError(restore, HttpStatusCode.BadRequest, "databases must be keep or restore\n");
    await AssertError(preview, HttpStatusCode.BadRequest, "databases must be keep or restore\n");
  }

  [Fact]
  public async Task AKeepRestoreThatWouldOrphanADatabaseIsRefusedEvenWithEveryConfirm()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await DatabaseInANewToggleAsync(history);
    var before = await history.BlocksAsync();

    using var request = new HttpRequestMessage(HttpMethod.Post, $"/sync/{SyncApp.Doc}/history/{lineage}/0/restore?databases=keep");
    request.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", "orphan");
    request.Headers.TryAddWithoutValidation("X-Blok-Restore-Confirm", "share, unlock, lockedReshape, orphanedDatabase");
    using var refused = await history.App.CreateClient().SendAsync(request);

    Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
    Assert.Equal("application/json", refused.Content.Headers.ContentType?.MediaType);
    Assert.Equal("restore_refused", Assert.Single(refused.Headers.GetValues("X-Blok-Restore-Refusal")));
    Assert.Equal(
        """{"error":"restore_refused","guards":[{"kind":"orphanedDatabase","blockId":"d"}]}""",
        await refused.Content.ReadAsStringAsync());
    Assert.True(JsonNode.DeepEquals(before, await history.BlocksAsync()));

    using var preview = await history.SendAsync(HttpMethod.Post, $"/history/{lineage}/0/restore/preview?databases=keep");
    Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
    Assert.Equal(
        """[{"kind":"orphanedDatabase","blockId":"d"}]""",
        JsonNode.Parse(await preview.Content.ReadAsStringAsync())!["guards"]!.ToJsonString());

    // Without keep, the same restore runs as it always did.
    using var restored = await history.RestoreAsync(lineage, "0", "orphan");
    Assert.Equal(HttpStatusCode.NoContent, restored.StatusCode);
  }

  [Fact]
  public async Task AKeepRestoreLeavesADatabaseAsItIsNow()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditAsync("database", $$"""{ "ops": [ { "op": "insert", "id": "d", "block": { "type": "database", "data": {{TableData}} } } ] }""");
    await history.EditTextAsync("two");

    using var restore = await Send(history.App, HttpMethod.Post, $"/history/{lineage}/0/restore?databases=keep", key: "keep");

    Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);
    var blocks = (await history.BlocksAsync()).AsArray();
    // An insert with no anchor went first; the kept database stays there.
    Assert.Equal(["d", "a"], blocks.Select(block => block!["id"]!.GetValue<string>()));
    Assert.Equal("one", blocks[1]!["data"]!["text"]![0]!["text"]!.GetValue<string>());
  }
}
