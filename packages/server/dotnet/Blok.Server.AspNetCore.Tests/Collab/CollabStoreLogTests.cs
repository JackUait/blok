using Blok.Server.AspNetCore.Collab;
using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// The stores the server builds log through the collab category, as Go's and
/// Rust's servers hand them their collab log.
/// </summary>
public sealed class CollabStoreLogTests : IDisposable
{
  private readonly string directory = Directory.CreateTempSubdirectory("blok-store-log-").FullName;
  private readonly CapturingLoggerProvider logs = new();

  public void Dispose()
  {
    Directory.Delete(directory, recursive: true);
  }

  [Fact]
  public async Task TheLocalWorkingSetStoreLogsTheUnreadableFileItMovesAside()
  {
    await using var provider = Build(journal: false);
    var store = provider.GetRequiredService<ICollabWorkingSetStore>();
    await File.WriteAllBytesAsync(Path.Combine(directory, CollabDocKey.For("doc-1")), [0x01, 0x02, 0x03]);

    Assert.Null(await store.ReadAsync("doc-1", CancellationToken.None));

    Assert.Contains(
        logs.Entries,
        entry => entry is { Category: "Blok.Server.Collab", Level: LogLevel.Warning } &&
            entry.Message.StartsWith("collab: moved the unreadable working set for \"doc-1\" to ", StringComparison.Ordinal));
  }

  [Fact]
  public async Task TheJournalLogsADocumentHeldElsewhere()
  {
    await using var provider = Build(journal: true);
    var store = provider.GetRequiredService<CollabOperationStoreSource>().Store!;

    var first = await store.OpenAsync("doc-1");
    var second = await store.OpenAsync("doc-1");

    Assert.Equal(CollabDocumentOpenOutcome.DocumentOpenElsewhere, second.Outcome);
    Assert.Contains(
        logs.Entries,
        entry => entry is { Category: "Blok.Server.Collab", Level: LogLevel.Warning } &&
            entry.Message.StartsWith("collab: \"doc-1\" is held elsewhere: ", StringComparison.Ordinal));
    await first.Session!.DisposeAsync();
  }

  private ServiceProvider Build(bool journal)
  {
    var services = new ServiceCollection();
    services.AddLogging(logging => logging.AddProvider(logs));
    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "http://127.0.0.1:5100/api/blok-docs";
      options.CollabDirectory = directory;
      options.CollabJournal = journal;
    });

    return services.BuildServiceProvider();
  }
}
