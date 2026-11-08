using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp;

/// <summary>
/// Where stored-mode handles live (<see cref="BlokMcpOptions.HandleStore"/>), so any replica that
/// shares the store can serve any call. Live handles hold sockets and never go here. Blok passes
/// only handles of 1-128 characters of <c>[A-Za-z0-9_-]</c>. Any throw is logged in full and the
/// agent sees SOURCE_UNAVAILABLE, which it may retry.
/// </summary>
/// <remarks>
/// Your duties: count-and-add must be one atomic step per principal (a row lock, a Lua script);
/// a lease must be exclusive per handle across replicas, time-limited and renewed while it is
/// held; a record can be large (the document and every undo step), so store it as long text.
/// Records are trusted: whoever can write the store can forge a record's actor, scopes and history.
/// </remarks>
public interface IBlokMcpHandleStore
{
  /// <summary>The principal's handles that have not expired.</summary>
  /// <param name="principal">Whose handles.</param>
  /// <param name="idleTimeout">A handle not leased for longer than this has expired.</param>
  /// <param name="cancellationToken">Cancels the count.</param>
  /// <returns>How many.</returns>
  ValueTask<int> CountAsync(string principal, TimeSpan idleTimeout, CancellationToken cancellationToken);

  /// <summary>Counts and adds as one step.</summary>
  /// <param name="handle">The new handle; never one the store holds.</param>
  /// <param name="record">What to keep (<see cref="BlokMcpHandleRecord.Principal"/> names the owner).</param>
  /// <param name="maxPerPrincipal">How many unexpired handles the owner may hold in the store, this one included.</param>
  /// <param name="idleTimeout">As in <see cref="CountAsync"/>.</param>
  /// <param name="cancellationToken">Cancels the add.</param>
  /// <returns>False, and nothing added, when the owner already holds <paramref name="maxPerPrincipal"/>.</returns>
  ValueTask<bool> TryAddAsync(string handle, BlokMcpHandleRecord record, int maxPerPrincipal, TimeSpan idleTimeout, CancellationToken cancellationToken);

  /// <summary>Takes the handle's lease: no other lease on it exists until this one ends, in any replica.</summary>
  /// <param name="handle">The handle.</param>
  /// <param name="idleTimeout">An expired handle answers <see cref="BlokMcpHandleAcquisition.Unknown"/>.</param>
  /// <param name="wait">How long to wait for another holder to let go.</param>
  /// <param name="cancellationToken">Cancels the wait.</param>
  /// <returns>The lease; Unknown when there is no such handle or it expired; Busy when still leased after <paramref name="wait"/>.</returns>
  ValueTask<BlokMcpHandleAcquisition> AcquireAsync(string handle, TimeSpan idleTimeout, TimeSpan wait, CancellationToken cancellationToken);

  /// <summary>
  /// Deletes every handle, of every principal, idle longer than <paramref name="idleTimeout"/> that
  /// nobody leases. Blok calls it on a timer. A store that expires records itself may do nothing.
  /// </summary>
  /// <param name="idleTimeout">As in <see cref="CountAsync"/>.</param>
  /// <param name="cancellationToken">Cancels the sweep.</param>
  /// <returns>When done.</returns>
  ValueTask SweepAsync(TimeSpan idleTimeout, CancellationToken cancellationToken);
}

/// <summary>
/// One call's hold on a handle. It is time-limited: the store may hand it to another holder once it
/// went unrenewed for its lease time (30 s), so a paused holder can lose it. Blok renews it every
/// 5 s while a call runs; the store needs no timer of its own. Each operation checks that this lease
/// still holds the handle; once it does not, renew, save and remove throw and change nothing.
/// </summary>
public interface IBlokMcpHandleLease
{
  /// <summary>The record as the store holds it.</summary>
  BlokMcpHandleRecord Record { get; }

  /// <summary>Replaces the record. Blok calls it after the source save, before release.</summary>
  /// <param name="record">The new record.</param>
  /// <param name="cancellationToken">Cancels the write.</param>
  /// <returns>When written.</returns>
  ValueTask SaveAsync(BlokMcpHandleRecord record, CancellationToken cancellationToken);

  /// <summary>Restarts the lease time. Blok calls it every 5 s while a call holds the lease.</summary>
  /// <param name="cancellationToken">Cancels the renewal.</param>
  /// <returns>When renewed.</returns>
  ValueTask RenewAsync(CancellationToken cancellationToken);

  /// <summary>Ends the lease and restarts the handle's idle time. Does nothing once the lease is gone.</summary>
  /// <param name="cancellationToken">Cancels the release.</param>
  /// <returns>When released.</returns>
  ValueTask ReleaseAsync(CancellationToken cancellationToken);

  /// <summary>Deletes the handle (blok_close, or a record that could not be saved). The lease ends with it.</summary>
  /// <param name="cancellationToken">Cancels the delete.</param>
  /// <returns>When deleted.</returns>
  ValueTask RemoveAsync(CancellationToken cancellationToken);
}

/// <summary>What <see cref="IBlokMcpHandleStore.AcquireAsync"/> got.</summary>
public sealed class BlokMcpHandleAcquisition
{
  private BlokMcpHandleAcquisition(IBlokMcpHandleLease? lease, bool busy)
  {
    Lease = lease;
    IsBusy = busy;
  }

  /// <summary>No such handle, or it expired.</summary>
  public static BlokMcpHandleAcquisition Unknown { get; } = new(null, false);

  /// <summary>Another holder kept the lease past the wait.</summary>
  public static BlokMcpHandleAcquisition Busy { get; } = new(null, true);

  /// <summary>The lease, when one was taken.</summary>
  public IBlokMcpHandleLease? Lease { get; }

  /// <summary>Whether another holder kept the lease past the wait.</summary>
  public bool IsBusy { get; }

  /// <summary>A lease was taken.</summary>
  /// <param name="lease">The lease.</param>
  /// <returns>The acquisition.</returns>
  public static BlokMcpHandleAcquisition Leased(IBlokMcpHandleLease lease)
  {
    ArgumentNullException.ThrowIfNull(lease);

    return new BlokMcpHandleAcquisition(lease, false);
  }
}

/// <summary>
/// One stored-mode handle as a store keeps it: plain JSON written by Blok (<see cref="ToJson"/>).
/// The server checks <see cref="Principal"/> and <see cref="ContractRevision"/>, never the store.
/// </summary>
public sealed class BlokMcpHandleRecord
{
  /// <summary>The record format; Blok reads only 1, and another value answers UNKNOWN_HANDLE.</summary>
  public int V { get; init; } = 1;

  /// <summary>The tool contract of the server that opened the handle. Another one answers VERSION_SKEW.</summary>
  public required string ContractRevision { get; init; }

  /// <summary>The opener. A call from another principal answers UNKNOWN_HANDLE.</summary>
  public required string Principal { get; init; }

  /// <summary>The opener's client name.</summary>
  public required string ClientName { get; init; }

  /// <summary>The opener's scopes. Null (no scope checks) and empty stay different.</summary>
  public IReadOnlyList<string>? Scopes { get; init; }

  /// <summary>The agent actor the handle writes as: <c>id</c>, <c>name</c>, <c>kind</c>, and maybe <c>onBehalfOf</c> and <c>color</c>.</summary>
  public required JsonObject Actor { get; init; }

  /// <summary>The open document.</summary>
  public required string DocumentId { get; init; }

  /// <summary>Whether the handle may write.</summary>
  public bool Write { get; init; }

  /// <summary>The source version the next save sends as its expected version.</summary>
  public string? Version { get; init; }

  /// <summary>The last save or reload failed: the next call reloads from the source first.</summary>
  public bool Stale { get; init; }

  /// <summary>The document as the handle holds it.</summary>
  public required JsonObject Document { get; init; }

  /// <summary>Undo and redo steps, each a whole document. Not bounded in bytes.</summary>
  public required JsonObject History { get; init; }

  /// <summary>The record as compact JSON text, in Node's field names.</summary>
  /// <returns>The JSON text.</returns>
  public string ToJson()
  {
    return McpJson.Write(new JsonObject
    {
      ["v"] = V,
      ["contractRevision"] = ContractRevision,
      ["principal"] = Principal,
      ["clientName"] = ClientName,
      ["scopes"] = Scopes is null ? null : new JsonArray([.. Scopes.Select(scope => (JsonNode)scope)]),
      ["actor"] = Actor.DeepClone(),
      ["documentId"] = DocumentId,
      ["write"] = Write,
      ["version"] = Version,
      ["stale"] = Stale,
      ["document"] = Document.DeepClone(),
      ["history"] = History.DeepClone(),
    });
  }

  /// <summary>Reads a record <see cref="ToJson"/> wrote.</summary>
  /// <param name="json">The JSON text.</param>
  /// <returns>The record.</returns>
  /// <exception cref="JsonException">The text is not such a record.</exception>
  public static BlokMcpHandleRecord FromJson(string json)
  {
    ArgumentNullException.ThrowIfNull(json);
    if (McpJson.Parse(json) is not JsonObject fields)
    {
      throw new JsonException("A handle record is a JSON object.");
    }

    return new BlokMcpHandleRecord
    {
      V = (int)(McpJson.Number(fields["v"]) ?? 0),
      ContractRevision = Text(fields, "contractRevision"),
      Principal = Text(fields, "principal"),
      ClientName = Text(fields, "clientName"),
      Scopes = fields["scopes"] is JsonArray scopes ? [.. scopes.Select(scope => McpJson.String(scope) ?? throw new JsonException("A scope is a string."))] : null,
      Actor = fields["actor"] as JsonObject is { } actor ? (JsonObject)actor.DeepClone() : throw new JsonException("A handle record needs an actor object."),
      DocumentId = Text(fields, "documentId"),
      Write = McpJson.Bool(fields["write"]) == true,
      Version = McpJson.String(fields["version"]),
      Stale = McpJson.Bool(fields["stale"]) == true,
      Document = fields["document"] as JsonObject is { } document ? (JsonObject)document.DeepClone() : throw new JsonException("A handle record needs a document object."),
      History = fields["history"] as JsonObject is { } history ? (JsonObject)history.DeepClone() : throw new JsonException("A handle record needs a history object."),
    };
  }

  private static string Text(JsonObject fields, string name)
  {
    return McpJson.String(fields[name]) ?? throw new JsonException($"A handle record needs a string \"{name}\".");
  }
}
