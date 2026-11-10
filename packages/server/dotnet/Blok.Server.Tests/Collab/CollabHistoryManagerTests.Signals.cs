using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>Change signals and audit events through the room manager, on the real converter.</summary>
public sealed partial class CollabHistoryManagerTests
{
  private static readonly TimeSpan SignalWindow = TimeSpan.FromSeconds(60);

  [Fact]
  public async Task OneSignalPerWindowNamesTheChangedBlocksAndTheirAuthors()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    var opened = time.GetUtcNow();
    await EditAsync(manager, Update("a", "two"), actor: "u1");
    time.Advance(TimeSpan.FromSeconds(30));
    await EditAsync(manager, Insert("b", "three", after: "a"), actor: "u2");
    await manager.SettleAsync();

    Assert.Empty(observer.Signals);

    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();

    var signal = Assert.Single(observer.Signals);
    Assert.Equal(DocId, signal.DocumentId);
    Assert.Equal(Lineage(), signal.Lineage);
    Assert.Equal((1UL, 2UL), (signal.FromSequence, signal.ToSequence));
    Assert.Equal((opened, opened + SignalWindow), (signal.WindowStart, signal.WindowEnd));
    Assert.Equal([new("a", "changed"), new("b", "added")], signal.Blocks);
    Assert.Equal([new("u1", "person"), new("u2", "person")], signal.Authors);
  }

  [Fact]
  public async Task AnEditAfterTheWindowOpensTheNextOne()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    time.Advance(SignalWindow);
    await manager.SettleAsync();
    await EditAsync(manager, Update("a", "three"));
    time.Advance(SignalWindow);
    await manager.SettleAsync();

    Assert.Equal([(1UL, 1UL), (2UL, 2UL)], observer.Signals.Select(signal => (signal.FromSequence, signal.ToSequence)));
  }

  [Fact]
  public async Task ABlockAddedAndRemovedInOneWindowSendsNothing()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Insert("b", "brief", after: "a"));
    await EditAsync(manager, Remove("b"));
    time.Advance(SignalWindow);
    await manager.SettleAsync();

    Assert.Empty(observer.Signals);
  }

  [Fact]
  public async Task ALineageChangeClosesTheWindow()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    var first = Lineage();
    await ResetAsync(manager);
    await EditAsync(manager, Update("a", "three"));
    var second = Lineage();
    time.Advance(SignalWindow);
    await manager.SettleAsync();

    Assert.Equal([first, second], observer.Signals.Select(signal => signal.Lineage));
  }

  [Fact]
  public async Task TheWindowLengthComesFromTheOptions()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer, TimeSpan.FromMinutes(5));
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    time.Advance(TimeSpan.FromMinutes(4));
    await EditAsync(manager, Update("a", "three"));
    await manager.SettleAsync();

    Assert.Empty(observer.Signals);

    time.Advance(TimeSpan.FromMinutes(1));
    await manager.SettleAsync();

    var signal = Assert.Single(observer.Signals);
    Assert.Equal((1UL, 2UL), (signal.FromSequence, signal.ToSequence));
    Assert.Equal(TimeSpan.FromMinutes(5), signal.WindowEnd - signal.WindowStart);
  }

  [Fact]
  public async Task AThrowingObserverIsLoggedAndEditsGoOn()
  {
    var observer = new SignalObserver { Failure = new InvalidOperationException("host down") };
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    time.Advance(SignalWindow);
    await manager.SettleAsync();
    await EditAsync(manager, Update("a", "three"));

    Assert.Contains(log, line => line.Contains("host down", StringComparison.Ordinal));
  }

  [Fact]
  public async Task ASlowObserverNeverHoldsTheRoom()
  {
    var observer = new SignalObserver { Gate = new TaskCompletionSource() };
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    time.Advance(SignalWindow);

    for (var i = 0; i < 5; i++)
    {
      await EditAsync(manager, Update("a", $"edit {i}"));
    }

    Assert.Equal(6, operations.Committed(DocId).Count);
    observer.Gate.SetResult();
    time.Advance(SignalWindow);
    await manager.SettleAsync();
    Assert.Equal(2, observer.Signals.Count);
  }

  [Fact]
  public void AnObserverThatOverridesNeitherMemberGetsNoHub()
  {
    Assert.Null(CollabChangeSignalHub.For(
        new RecordingActivityObserver(),
        SignalWindow,
        time,
        (_, _, _, _, _) => throw new InvalidOperationException("no history read"),
        null));
  }

  [Fact]
  public async Task AnEditIsAContentEditedEventWithTheActorsNote()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"), actor: "u1");
    await EditAsync(manager, Update("a", "three"), actor: "u1");
    await manager.SettleAsync();

    var edited = Assert.Single(observer.Events);
    Assert.Equal(CollabAuditEventTypes.ContentEdited, edited.Type);
    Assert.Equal(DocId, edited.DocumentId);
    Assert.Equal(new CollabAuditActor("u1", "person", null), edited.Actor);
  }

  [Fact]
  public async Task DeletingALineageAndPurgingAreEvents()
  {
    var observer = new SignalObserver();
    var manager = SignalManager(observer);
    await LoadAsync(manager);
    var old = Lineage();
    await ResetAsync(manager);

    Assert.Equal(CollabHistoryStatus.Ready, (await manager.DeleteLineageAsync(DocId, old, "u9")).Status);
    await manager.PurgeDocumentAsync(DocId, _ => ValueTask.FromResult(true));
    await manager.SettleAsync();

    Assert.Collection(
        observer.Events,
        deleted =>
        {
          Assert.Equal(CollabAuditEventTypes.LineageDeleted, deleted.Type);
          Assert.Equal(old, deleted.Lineage);
          Assert.Equal(new CollabAuditActor("u9", "person", null), deleted.Actor);
        },
        purged =>
        {
          Assert.Equal(CollabAuditEventTypes.DocumentPurged, purged.Type);
          Assert.Null(purged.Actor);
        });
  }

  private CollabRoomManager SignalManager(ICollabActivityObserver observer, TimeSpan? window = null) =>
      new(
          store,
          endpoint,
          new CollabDocConverter(time, RichTextRuntime.Reader),
          new CollabRoomOptions { ChangeSignalWindow = window ?? SignalWindow },
          time,
          log.Add,
          operations,
          observer);

  private sealed class SignalObserver : ICollabActivityObserver
  {
    private readonly List<CollabChangeSignal> signals = [];
    private readonly List<CollabAuditEvent> events = [];

    internal Exception? Failure { get; init; }

    internal TaskCompletionSource? Gate { get; init; }

    internal IReadOnlyList<CollabChangeSignal> Signals
    {
      get
      {
        lock (signals)
        {
          return [.. signals];
        }
      }
    }

    internal IReadOnlyList<CollabAuditEvent> Events
    {
      get
      {
        lock (signals)
        {
          return [.. events];
        }
      }
    }

    public ValueTask RecordAsync(
        string documentId,
        string actorId,
        DateTimeOffset at,
        CollabActivityKind kind,
        CancellationToken cancellationToken = default) => ValueTask.CompletedTask;

    public async ValueTask OnChangesAsync(CollabChangeSignal signal, CancellationToken cancellationToken = default)
    {
      if (Gate is { } gate)
      {
        await gate.Task;
      }

      if (Failure is { } failure)
      {
        throw failure;
      }

      lock (signals)
      {
        signals.Add(signal);
      }
    }

    public ValueTask OnEventAsync(CollabAuditEvent auditEvent, CancellationToken cancellationToken = default)
    {
      lock (signals)
      {
        events.Add(auditEvent);
      }

      return ValueTask.CompletedTask;
    }
  }
}
