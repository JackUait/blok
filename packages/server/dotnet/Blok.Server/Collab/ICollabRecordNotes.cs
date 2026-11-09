using System.Collections.Concurrent;

namespace Blok.Server.Collab;

/// <summary>
/// What kind of actor wrote one journal record. Kept beside the journal, never
/// in it: the journal bytes are shared by every backend and do not change.
/// </summary>
/// <param name="Kind">"person" or "agent".</param>
/// <param name="Client">
/// An agent's client name, as the agent id carries it (<c>agent:&lt;person&gt;:&lt;client&gt;</c>).
/// Raw: the host maps it to a brand.
/// </param>
/// <param name="OnBehalfOf">The person an agent acted for, when one is known.</param>
public sealed record CollabRecordNote(string Kind, string? Client = null, string? OnBehalfOf = null);

/// <summary>
/// Optional store for one <see cref="CollabRecordNote"/> per journal record,
/// keyed by document, lineage and sequence. Without one, history answers
/// carry no actor kinds.
/// </summary>
/// <remarks>
/// <para>
/// Register an implementation with <c>AddBlokServer(…).UseCollabRecordNotes&lt;T&gt;()</c>.
/// It is a singleton and must be safe to use from several documents at once.
/// </para>
/// <para>
/// A note is written right after its record is journalled, inside the room's
/// lane, within the room's commit timeout. It is not atomic with the journal:
/// a crash, a timeout or a throw between the two loses that one note, and the
/// record then has no kind. The edit itself is never refused for it.
/// </para>
/// <para>
/// Blok never deletes notes. When a document is purged or a lineage deleted,
/// delete its notes too.
/// </para>
/// </remarks>
public interface ICollabRecordNotes
{
  /// <summary>Stores the note of one journalled record.</summary>
  /// <param name="documentId">Caller-supplied text; treat it as untrusted when it becomes a path or a key.</param>
  /// <param name="lineage">The record's lineage.</param>
  /// <param name="sequence">The record's sequence in that lineage.</param>
  /// <param name="note">Who wrote it.</param>
  /// <param name="cancellationToken">Cancelled when the room's commit timeout passes.</param>
  ValueTask WriteAsync(
      string documentId,
      string lineage,
      ulong sequence,
      CollabRecordNote note,
      CancellationToken cancellationToken);

  /// <summary>Every note of one lineage, by sequence. A record without a note is absent.</summary>
  ValueTask<IReadOnlyDictionary<ulong, CollabRecordNote>> ReadAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken);
}

/// <summary>Keeps notes in memory, for tests and single-process hosts. They are lost on restart.</summary>
public sealed class InMemoryCollabRecordNotes : ICollabRecordNotes
{
  private readonly ConcurrentDictionary<(string, string), ConcurrentDictionary<ulong, CollabRecordNote>> notes = new();

  /// <inheritdoc/>
  public ValueTask WriteAsync(
      string documentId,
      string lineage,
      ulong sequence,
      CollabRecordNote note,
      CancellationToken cancellationToken)
  {
    notes.GetOrAdd((documentId, lineage), _ => new())[sequence] = note;

    return ValueTask.CompletedTask;
  }

  /// <inheritdoc/>
  public ValueTask<IReadOnlyDictionary<ulong, CollabRecordNote>> ReadAsync(
      string documentId,
      string lineage,
      CancellationToken cancellationToken)
  {
    IReadOnlyDictionary<ulong, CollabRecordNote> found = notes.TryGetValue((documentId, lineage), out var lineageNotes)
        ? new Dictionary<ulong, CollabRecordNote>(lineageNotes)
        : new Dictionary<ulong, CollabRecordNote>();

    return ValueTask.FromResult(found);
  }
}

/// <summary>
/// Who wrote a record, and who a block stamp credits. The same rule the agent
/// engines stamp with (src/shared/agent/attribution.ts): the person is the
/// author and the agent co-authors; with no person the agent is the author.
/// </summary>
internal static class CollabActorKinds
{
  internal const string Person = "person";
  internal const string Agent = "agent";

  // src/shared/mcp/actor.ts builds agent:<principal>:<client>, and its
  // client name never holds a colon, so the last colon splits the two.
  private const string AgentPrefix = "agent:";

  /// <summary>
  /// The note for a record by <paramref name="actorId"/>. Null when no actor
  /// is known. An in-process agent passes <paramref name="agent"/> and its
  /// own <paramref name="onBehalfOf"/>, which wins over the id's.
  /// </summary>
  internal static CollabRecordNote? Classify(string? actorId, bool agent = false, string? onBehalfOf = null)
  {
    if (string.IsNullOrEmpty(actorId))
    {
      return null;
    }

    string? client = null;
    string? person = null;

    if (actorId.StartsWith(AgentPrefix, StringComparison.Ordinal))
    {
      agent = true;
      var rest = actorId[AgentPrefix.Length..];
      var split = rest.LastIndexOf(':');

      if (split >= 0)
      {
        person = rest[..split];
        client = rest[(split + 1)..];
      }
    }

    if (!agent)
    {
      return new CollabRecordNote(Person);
    }

    if (!string.IsNullOrEmpty(onBehalfOf))
    {
      person = onBehalfOf;
    }

    return new CollabRecordNote(
        Agent,
        string.IsNullOrEmpty(client) ? null : client,
        string.IsNullOrEmpty(person) ? null : person);
  }

  /// <summary>
  /// The By and With a block stamp gets for a write by <paramref name="actorId"/>.
  /// Both null when no actor is known.
  /// </summary>
  internal static (string? By, string? With) Attribution(string? actorId, CollabRecordNote? note)
  {
    if (note is null || string.IsNullOrEmpty(actorId))
    {
      return (null, null);
    }

    return note.Kind == Agent && note.OnBehalfOf is { } person
        ? (person, actorId)
        : (actorId, null);
  }
}
