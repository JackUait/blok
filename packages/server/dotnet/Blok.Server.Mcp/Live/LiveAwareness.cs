using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Yjs;

namespace Blok.Server.Mcp.Live;

/// <summary>Which clients one awareness change touched.</summary>
internal sealed record AwarenessChange(IReadOnlyList<ulong> Added, IReadOnlyList<ulong> Updated, IReadOnlyList<ulong> Removed);

/// <summary>
/// y-protocols' Awareness (node_modules/y-protocols/awareness.js) plus the
/// document store's tombstone prune. Not thread-safe: the room loop owns it.
/// </summary>
internal sealed class LiveAwareness
{
  internal const long OutdatedTimeoutMs = 30_000;
  // A stateless meta row is a tombstone: it stops a stale relay with an older clock
  // from bringing a departed client back. document-store.ts AWARENESS_TOMBSTONE_TTL_MS.
  internal const long TombstoneTtlMs = 90_000;

  private readonly Dictionary<ulong, JsonNode> states = [];
  // Insertion order of states, as a JS Map iterates.
  private readonly LinkedList<ulong> order = new();
  private readonly Dictionary<ulong, LinkedListNode<ulong>> orderIndex = [];
  private readonly Dictionary<ulong, (ulong Clock, long LastUpdated)> meta = [];
  private readonly Func<long> now;

  internal LiveAwareness(ulong clientId, Func<long> now)
  {
    ClientId = clientId;
    this.now = now;
    SetLocalState(new JsonObject());
  }

  internal event Action<AwarenessChange, object?>? Updated;

  internal ulong ClientId { get; }

  internal int StateCount => states.Count;

  internal int MetaCount => meta.Count;

  internal JsonObject? LocalState => states.TryGetValue(ClientId, out var state) ? state as JsonObject : null;

  internal IEnumerable<ulong> Clients => order;

  internal JsonNode? StateOf(ulong client) => states.GetValueOrDefault(client);

  internal bool HasMeta(ulong client) => meta.ContainsKey(client);

  internal void SetLocalState(JsonObject? state)
  {
    var clock = meta.TryGetValue(ClientId, out var current) ? current.Clock + 1 : 0;
    var had = states.ContainsKey(ClientId);

    SetState(ClientId, state);
    meta[ClientId] = (clock, now());
    if (state is null)
    {
      Updated?.Invoke(new AwarenessChange([], [], [ClientId]), "local");
    }
    else
    {
      Updated?.Invoke(had ? new AwarenessChange([], [ClientId], []) : new AwarenessChange([ClientId], [], []), "local");
    }
  }

  internal void SetLocalStateField(string field, JsonNode? value)
  {
    if (LocalState is not { } state)
    {
      return;
    }
    var next = (JsonObject)state.DeepClone();

    next[field] = value?.DeepClone();
    SetLocalState(next);
  }

  /// <summary>applyAwarenessUpdate; throws on bytes it cannot read, before anything changes.</summary>
  internal void Apply(ReadOnlySpan<byte> update, object? origin)
  {
    PruneTombstones();
    var entries = Decode(update);
    var timestamp = now();
    List<ulong> added = [], updated = [], removed = [];

    foreach (var (client, entryClock, state) in entries)
    {
      var clock = entryClock;
      var known = meta.TryGetValue(client, out var clientMeta);
      var current = known ? clientMeta.Clock : 0;

      if (!(current < clock || (current == clock && state is null && states.ContainsKey(client))))
      {
        continue;
      }
      if (state is null)
      {
        // Never let a peer remove this client's own state; outbid it instead.
        if (client == ClientId && LocalState is not null)
        {
          clock++;
        }
        else
        {
          SetState(client, null);
        }
      }
      else
      {
        SetState(client, state);
      }
      meta[client] = (clock, timestamp);
      if (!known && state is not null)
      {
        added.Add(client);
      }
      else if (known && state is null)
      {
        removed.Add(client);
      }
      else if (state is not null)
      {
        updated.Add(client);
      }
    }
    if (added.Count > 0 || updated.Count > 0 || removed.Count > 0)
    {
      Updated?.Invoke(new AwarenessChange(added, updated, removed), origin);
    }
  }

  /// <summary>Every known state when <paramref name="clients"/> is null; clients without a meta row are skipped.</summary>
  internal byte[] Encode(IEnumerable<ulong>? clients)
  {
    var known = (clients ?? order).Where(meta.ContainsKey).ToList();
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)known.Count);
    foreach (var client in known)
    {
      writer.WriteVarUint(client);
      writer.WriteVarUint(meta[client].Clock);
      writer.WriteVarString(McpJson.Write(states.GetValueOrDefault(client)));
    }

    return writer.ToArray();
  }

  /// <summary>This client's null state at its current clock, or null before any.</summary>
  internal byte[]? EncodeLocalDeparture()
  {
    if (!meta.TryGetValue(ClientId, out var local))
    {
      return null;
    }
    var writer = new Lib0Writer();

    writer.WriteVarUint(1);
    writer.WriteVarUint(ClientId);
    writer.WriteVarUint(local.Clock);
    writer.WriteVarString("null");

    return writer.ToArray();
  }

  /// <summary>removeAwarenessStates for every peer, as a disconnect does.</summary>
  internal void ClearRemote()
  {
    Remove([.. order.Where(client => client != ClientId)], "local");
  }

  /// <summary>The 3 s check: renew our own state at 15 s, drop peers silent for 30 s.</summary>
  internal void Check()
  {
    var time = now();

    if (LocalState is { } local && OutdatedTimeoutMs / 2 <= time - meta[ClientId].LastUpdated)
    {
      SetLocalState(local);
    }
    var outdated = meta
        .Where(entry => entry.Key != ClientId && OutdatedTimeoutMs <= time - entry.Value.LastUpdated && states.ContainsKey(entry.Key))
        .Select(entry => entry.Key)
        .ToList();

    if (outdated.Count > 0)
    {
      Remove(outdated, "timeout");
    }
  }

  /// <summary>Drops every peer's state and meta row.</summary>
  internal void Clear()
  {
    foreach (var client in order.Where(client => client != ClientId).ToList())
    {
      SetState(client, null);
    }
    foreach (var client in meta.Keys.Where(client => client != ClientId).ToList())
    {
      meta.Remove(client);
    }
  }

  private void Remove(List<ulong> clients, object? origin)
  {
    var removed = new List<ulong>();

    foreach (var client in clients)
    {
      if (!states.ContainsKey(client))
      {
        continue;
      }
      SetState(client, null);
      if (client == ClientId)
      {
        meta[client] = (meta[client].Clock + 1, now());
      }
      removed.Add(client);
    }
    if (removed.Count > 0)
    {
      Updated?.Invoke(new AwarenessChange([], [], removed), origin);
    }
  }

  // Stateless rows of silent peers go; ours stays (document-store.ts pruneAwarenessMeta).
  private void PruneTombstones()
  {
    var staleBefore = now() - TombstoneTtlMs;
    var stale = meta
        .Where(entry => entry.Key != ClientId && !states.ContainsKey(entry.Key) && entry.Value.LastUpdated < staleBefore)
        .Select(entry => entry.Key)
        .ToList();

    foreach (var client in stale)
    {
      meta.Remove(client);
    }
  }

  private void SetState(ulong client, JsonNode? state)
  {
    if (state is null)
    {
      if (states.Remove(client) && orderIndex.Remove(client, out var node))
      {
        order.Remove(node);
      }

      return;
    }
    if (!states.ContainsKey(client))
    {
      orderIndex[client] = order.AddLast(client);
    }
    states[client] = state;
  }

  private static List<(ulong Client, ulong Clock, JsonNode? State)> Decode(ReadOnlySpan<byte> update)
  {
    var reader = new Lib0Reader(update);
    var count = reader.ReadVarUint();
    var entries = new List<(ulong, ulong, JsonNode?)>();

    for (ulong index = 0; index < count; index++)
    {
      var client = reader.ReadVarUint();
      var clock = reader.ReadVarUint();

      entries.Add((client, clock, McpJson.Parse(reader.ReadVarString())));
    }

    return entries;
  }
}
