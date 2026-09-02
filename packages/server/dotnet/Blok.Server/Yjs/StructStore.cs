namespace Blok.Server.Yjs;

/// <summary>
/// Every integrated struct, grouped by client and kept in one contiguous
/// ascending clock run per client. The contiguity is what every lookup here
/// relies on, so it is checked on the way in rather than discovered later.
///
/// The pending fields hold what could not be integrated yet; the integrator
/// that fills them arrives with the transaction.
/// </summary>
internal sealed class StructStore
{
  public Dictionary<ulong, List<YStruct>> Clients { get; } = [];

  /// <summary>Decoded structs waiting for a dependency, kept as structs rather than v2 bytes.</summary>
  public List<YStruct>? PendingStructs { get; set; }

  /// <summary>Deletions that named clocks this store has not seen.</summary>
  public DeleteSet? PendingDs { get; set; }

  /// <summary>Per client, the clock the parked structs are waiting for.</summary>
  public StateVector? PendingMissing { get; set; }

  /// <summary>The next clock this store has not seen from <paramref name="client"/>.</summary>
  public ulong GetState(ulong client)
  {
    if (!Clients.TryGetValue(client, out var structs))
    {
      return 0;
    }

    var last = structs[^1];

    return last.Id.Clock + (ulong)last.Length;
  }

  /// <summary>Integrated state only; anything parked is deliberately not counted.</summary>
  public StateVector GetStateVector()
  {
    var vector = new StateVector();

    foreach (var client in Clients)
    {
      var last = client.Value[^1];

      vector.Set(client.Key, last.Id.Clock + (ulong)last.Length);
    }

    return vector;
  }

  public YStruct Find(YId id)
  {
    return Structs(id.Client)[FindIndex(id.Client, id.Clock)];
  }

  /// <summary>Index of the struct whose run covers <paramref name="clock"/>.</summary>
  public int FindIndex(ulong client, ulong clock)
  {
    var structs = Structs(client);
    var left = 0;
    var right = structs.Count - 1;

    // yjs pivots the first probe on the clock's share of the run; a plain
    // bisection lands on the same struct because the runs are contiguous.
    while (left <= right)
    {
      var middle = left + ((right - left) / 2);
      var current = structs[middle];

      if (clock < current.Id.Clock)
      {
        right = middle - 1;

        continue;
      }

      if (clock < current.Id.Clock + (ulong)current.Length)
      {
        return middle;
      }

      left = middle + 1;
    }

    throw new InvalidOperationException(
        $"yjs: client {client} has no struct at clock {clock}; check the state first.");
  }

  /// <summary>
  /// The item that starts exactly at <paramref name="id"/>, splitting the one
  /// that covers it when it starts earlier.
  /// </summary>
  public YItem GetItemCleanStart(YTransaction? transaction, YId id)
  {
    return GetStructCleanStart(transaction, id) as YItem ??
        throw new InvalidOperationException(
            $"yjs: {id.Client}:{id.Clock} is a collected struct, not an item.");
  }

  /// <summary>
  /// Same, but a GC covering the clock is returned whole and unsplit: a
  /// collected run has no content to divide, and the integrator answers a GC
  /// neighbour by dropping the item's parent rather than by failing.
  /// </summary>
  public YStruct GetStructCleanStart(YTransaction? transaction, YId id)
  {
    var structs = Structs(id.Client);
    var index = FindIndex(id.Client, id.Clock);
    var found = structs[index];

    return found is YItem item && item.Id.Clock < id.Clock
        ? Split(transaction, structs, index, item, (int)(id.Clock - item.Id.Clock))
        : found;
  }

  /// <summary>
  /// The struct that ends exactly at <paramref name="id"/>, splitting the one
  /// that covers it when it ends later. A GC is returned whole: it has no
  /// content to divide, and the integrator tests for that.
  /// </summary>
  public YStruct GetItemCleanEnd(YTransaction? transaction, YId id)
  {
    var structs = Structs(id.Client);
    var index = FindIndex(id.Client, id.Clock);
    var found = structs[index];

    if (found is YItem item && id.Clock != item.LastId.Clock)
    {
      Split(transaction, structs, index, item, (int)(id.Clock - item.Id.Clock) + 1);
    }

    return found;
  }

  /// <summary>
  /// Swaps a struct for the one that replaces it, keeping the client's run
  /// contiguous. Only content GC does this, turning a collected item into a
  /// <see cref="YGc"/> of the same span.
  /// </summary>
  public void ReplaceStruct(YStruct existing, YStruct replacement)
  {
    ArgumentNullException.ThrowIfNull(existing);
    ArgumentNullException.ThrowIfNull(replacement);

    var structs = Structs(existing.Id.Client);

    structs[FindIndex(existing.Id.Client, existing.Id.Clock)] = replacement;
  }

  /// <summary>
  /// Cuts <paramref name="item"/> and files the right half straight after it,
  /// which is what keeps the run contiguous. yjs queues the right half for
  /// merging; this release never merges, so the queue is only kept for parity.
  /// </summary>
  internal static YItem Split(
      YTransaction? transaction, List<YStruct> structs, int index, YItem item, int diff)
  {
    var right = item.SplitAt(diff);

    structs.Insert(index + 1, right);
    transaction?.MergeStructs.Add(right);

    return right;
  }

  /// <summary>
  /// Appends a struct to its client's run. A first struct may start at any
  /// clock — yjs checks contiguity only once a client is known — but a gap
  /// after that would break every lookup, so it is refused.
  /// </summary>
  public void AddStruct(YStruct added)
  {
    ArgumentNullException.ThrowIfNull(added);

    if (!Clients.TryGetValue(added.Id.Client, out var structs))
    {
      // The list is created only where it is immediately filled, so a refusal
      // below can never leave an empty one behind.
      Clients[added.Id.Client] = [added];

      return;
    }

    var last = structs[^1];

    if (last.Id.Clock + (ulong)last.Length != added.Id.Clock)
    {
      throw new InvalidOperationException(
          $"yjs: client {added.Id.Client} jumps from clock " +
          $"{last.Id.Clock + (ulong)last.Length} to {added.Id.Clock}.");
    }

    structs.Add(added);
  }

  private List<YStruct> Structs(ulong client)
  {
    return Clients.TryGetValue(client, out var structs)
        ? structs
        : throw new InvalidOperationException($"yjs: client {client} is not in the store.");
  }
}
