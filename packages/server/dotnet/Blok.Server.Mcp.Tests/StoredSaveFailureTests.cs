using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Sources;
using Xunit;
using static Blok.Server.Mcp.Tests.StoredFaults;

namespace Blok.Server.Mcp.Tests;

/// <summary>After any failed save, a stored handle holds what the source holds: no unsaved edits, no undo step for them.</summary>
public sealed class StoredSaveFailureTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-save-").FullName;
  private readonly BundleFixture fixture;
  private readonly FaultySource source;

  public StoredSaveFailureTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
    source = new FaultySource(new FilesSource(dir, fixture.Host.Bundle));
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private static async Task<string?> TitleAsync(StoredSession session)
  {
    var read = await session.ReadAsync(new JsonObject(), CancellationToken.None);

    return McpJson.String(read["structuredContent"]?["page"]?["title"]);
  }

  [Fact]
  public async Task APlainSaveFailureLeavesTheSourcesDocumentInMemory()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source);

    await session.ExecuteAsync(Batch(SetTitle("Saved")), Caller, null, CancellationToken.None);
    source.NextSave = new IOException("disk full");

    await Assert.ThrowsAsync<IOException>(() => session.ExecuteAsync(Batch(SetTitle("Unsaved")), Caller, null, CancellationToken.None));

    Assert.Equal("Saved", await TitleAsync(session));
  }

  [Fact]
  public async Task APlainSaveFailureLeavesNoUndoStepForTheUnsavedBatch()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source);

    await session.ExecuteAsync(Batch(SetTitle("Saved")), Caller, null, CancellationToken.None);
    source.NextSave = new InvalidOperationException("lost connection");
    await Assert.ThrowsAsync<InvalidOperationException>(() => session.ExecuteAsync(Batch(SetTitle("Unsaved")), Caller, null, CancellationToken.None));

    var undo = Answer(await session.ExecuteAsync(Batch(Command("history.undo", new JsonObject())), Caller, null, CancellationToken.None));

    // An undo of the unsaved batch would answer ok and save "Saved" back.
    Assert.NotEqual(true, McpJson.Bool(undo?["ok"]));
    Assert.Equal("Saved", await TitleAsync(session));
  }

  [Fact]
  public async Task AMissingDocumentTextLeavesTheSourcesDocumentInMemory()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime) { DropDocumentText = true };
    var session = await OpenAsync(new McpBundle(runtime), source);

    await Assert.ThrowsAsync<InvalidOperationException>(() => session.ExecuteAsync(Batch(SetTitle("Unsaved")), Caller, null, CancellationToken.None));
    runtime.DropDocumentText = false;

    Assert.Null(await TitleAsync(session));
  }

  [Fact]
  public async Task AReloadThatFailsAfterARefusedSaveDoesNotEscapeAndRetriesOnTheNextCall()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source);

    source.NextSave = McpHostError.Surface("CONFLICT", "Someone else saved it.");
    source.NextLoad = new IOException("source down");

    var answer = Answer(await session.ExecuteAsync(Batch(SetTitle("Refused")), Caller, null, CancellationToken.None));

    Assert.Equal(false, McpJson.Bool(answer?["ok"]));
    Assert.Null(await TitleAsync(session));
  }
}
