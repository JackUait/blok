using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>Record notes: who wrote each record, kept beside the journal, and grouping by actor.</summary>
public sealed partial class CollabHistoryManagerTests
{
  [Fact]
  public async Task EachJournalledEditLeavesANoteOfItsActorsKindNeverReadFromTheIdsText()
  {
    var notes = new InMemoryCollabRecordNotes();
    var manager = ManagerOver(operations, recordNotes: notes);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "1"), actor: "u1");
    await EditAsync(manager, Update("a", "2"), actor: "agent:alice:claude-code");
    await EditAsync(manager, Update("a", "3"));

    var written = await notes.ReadAsync(DocId, Lineage(), default);

    Assert.Equal(new CollabRecordNote("person"), written[1]);
    Assert.Equal(new CollabRecordNote("person"), written[2]);
    Assert.False(written.ContainsKey(3));
  }

  [Fact]
  public async Task AnAgentEditNotesTheAgentAndItsPerson()
  {
    var notes = new InMemoryCollabRecordNotes();
    var manager = ManagerOver(operations, recordNotes: notes);
    await LoadAsync(manager);
    var op = Update("a", "by an agent");

    var result = await manager.AgentEditAsync(
        DocId,
        (_, _) => ValueTask.FromResult<IReadOnlyList<CollabEditOp>>([op]),
        Guid.NewGuid().ToString("N"),
        CollabEditOps.CanonicalBodyDigest([op]),
        "bot-7",
        null,
        note: CollabActorKinds.Classify("bot-7", agent: true, onBehalfOf: "carol"));

    Assert.Equal(CollabEditStatus.Applied, result.Status);
    Assert.Equal(new CollabRecordNote("agent", "carol"), (await notes.ReadAsync(DocId, Lineage(), default))[1]);
  }

  [Fact]
  public async Task TheListCarriesActorKindsOnlyWithARecordNotesStore()
  {
    var notes = new InMemoryCollabRecordNotes();
    var manager = ManagerOver(operations, recordNotes: notes);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "1"), actor: "u1");
    await EditAsync(manager, Update("a", "2"), actor: "agent:u1:cursor");

    var withNotes = await manager.HistoryAsync(DocId);
    var without = await ManagerOver(operations).HistoryAsync(DocId);

    Assert.Equal(
        [new CollabActorKind("u1", new CollabRecordNote("person")),
         new CollabActorKind("agent:u1:cursor", new CollabRecordNote("person"))],
        withNotes.Versions[0].ActorKinds);
    Assert.Empty(withNotes.Versions[1].ActorKinds!);
    Assert.All(without.Versions, version => Assert.Null(version.ActorKinds));
  }

  [Fact]
  public async Task ByActorStartsAVersionWhenTheActorChanges()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "1"), actor: "u1");
    await EditAsync(manager, Update("a", "2"), actor: "u1");
    await EditAsync(manager, Update("a", "3"), actor: "u2");

    var byTime = await manager.HistoryAsync(DocId);
    var byActor = await manager.HistoryAsync(DocId, null, byActor: true, default);

    Assert.Equal([3UL, 0UL], byTime.Versions.Select(version => version.Sequence));
    Assert.Equal([3UL, 2UL, 0UL], byActor.Versions.Select(version => version.Sequence));
  }

  [Fact]
  public async Task ANoteThatFailsNeverFailsTheEdit()
  {
    var manager = ManagerOver(operations, recordNotes: new ThrowingNotes());
    await LoadAsync(manager);

    // EditAsync asserts the edit applied.
    await EditAsync(manager, Update("a", "kept"), actor: "u1");

    Assert.Equal(1UL, operations.Head(DocId)!.DurableThrough);
    Assert.Contains(log, line => line.Contains("record note", StringComparison.Ordinal));
  }

  [Fact]
  public async Task ARestoreIsNotedAsItsRestorer()
  {
    var notes = new InMemoryCollabRecordNotes();
    var manager = ManagerOver(operations, recordNotes: notes);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "1"), actor: "u1");
    var lineage = Lineage();

    var restore = await manager.RestoreAsync(DocId, lineage, 0, Guid.NewGuid().ToString("N"), "u2");

    Assert.Equal(CollabEditStatus.Applied, restore.Edit!.Status);
    Assert.Equal(new CollabRecordNote("person"), (await notes.ReadAsync(DocId, lineage, default))[2]);
  }

  private sealed class ThrowingNotes : ICollabRecordNotes
  {
    public ValueTask WriteAsync(string documentId, string lineage, ulong sequence, CollabRecordNote note, CancellationToken cancellationToken) =>
        throw new IOException("the notes are down");

    public ValueTask<IReadOnlyDictionary<ulong, CollabRecordNote>> ReadAsync(string documentId, string lineage, CancellationToken cancellationToken) =>
        throw new IOException("the notes are down");
  }
}
