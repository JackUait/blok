namespace Blok.Server.Yjs;

/// <summary>One deleted run of clocks belonging to a single client.</summary>
internal readonly record struct DeleteRange(ulong Clock, ulong Length);

/// <summary>
/// The deletions an update carries: per client, a list of clock ranges. v1
/// writes the clients in descending id order and each range's clock
/// absolutely (v2 writes them as deltas, which is why the reader and the
/// writer are format-specific).
///
/// Applying a delete set to a struct store arrives with the store.
/// </summary>
internal sealed class DeleteSet
{
  private readonly Dictionary<ulong, List<DeleteRange>> clients = [];

  public bool IsEmpty => clients.Count == 0;

  public int Count => clients.Count;

  /// <summary>Every client with at least one range, and its ranges.</summary>
  public IEnumerable<KeyValuePair<ulong, IReadOnlyList<DeleteRange>>> Clients =>
      clients.Select(client =>
          new KeyValuePair<ulong, IReadOnlyList<DeleteRange>>(client.Key, client.Value));

  public static DeleteSet Read(ref Lib0Reader reader)
  {
    var set = new DeleteSet();
    var numberOfClients = reader.ReadVarUint();

    for (ulong index = 0; index < numberOfClients; index++)
    {
      var client = reader.ReadVarUint();
      var numberOfRanges = reader.ReadVarUint();

      if (numberOfRanges == 0)
      {
        // yjs records nothing for an empty range list, so neither does this.
        continue;
      }

      // A client listed twice appends, as yjs's setIfUndefined does.
      if (!set.clients.TryGetValue(client, out var ranges))
      {
        ranges = [];
        set.clients[client] = ranges;
      }

      for (ulong range = 0; range < numberOfRanges; range++)
      {
        var clock = reader.ReadVarUint();
        var length = reader.ReadVarUint();

        ranges.Add(new DeleteRange(clock, length));
      }
    }

    return set;
  }

  public void Write(Lib0Writer writer)
  {
    ArgumentNullException.ThrowIfNull(writer);

    writer.WriteVarUint((ulong)clients.Count);

    // Descending client id, as yjs writes it; a receiver's conflict
    // resolution reads better that way and the bytes must match.
    foreach (var client in clients.OrderByDescending(entry => entry.Key))
    {
      writer.WriteVarUint(client.Key);
      writer.WriteVarUint((ulong)client.Value.Count);

      foreach (var range in client.Value)
      {
        writer.WriteVarUint(range.Clock);
        writer.WriteVarUint(range.Length);
      }
    }
  }

  /// <summary>Records one deleted run; ranges may overlap until SortAndMerge runs.</summary>
  public void Add(ulong client, ulong clock, ulong length)
  {
    if (!clients.TryGetValue(client, out var ranges))
    {
      ranges = [];
      clients[client] = ranges;
    }

    ranges.Add(new DeleteRange(clock, length));
  }

  /// <summary>
  /// Deletes everything these ranges name, and returns what could not be
  /// applied yet — or null when everything was.
  ///
  /// A range is split on BOTH edges so only the named clocks die, and there
  /// are two ways to be un-appliable: a range reaching past what this store
  /// has seen parks only its tail and still deletes the head, while a range
  /// starting past it parks whole. Both must wait for the structs to arrive,
  /// which is why the remainder is kept rather than dropped.
  /// </summary>
  public DeleteSet? Apply(YTransaction transaction, StructStore store)
  {
    ArgumentNullException.ThrowIfNull(store);

    var unapplied = new DeleteSet();

    foreach (var (client, ranges) in clients)
    {
      var structs = store.Clients.TryGetValue(client, out var known) ? known : [];
      var state = store.GetState(client);

      foreach (var range in ranges)
      {
        var clockEnd = range.Clock + range.Length;

        if (range.Clock >= state)
        {
          unapplied.Add(client, range.Clock, range.Length);

          continue;
        }

        if (state < clockEnd)
        {
          unapplied.Add(client, state, clockEnd - state);
        }

        var index = store.FindIndex(client, range.Clock);

        if (structs[index] is YItem head && !head.Deleted && head.Id.Clock < range.Clock)
        {
          StructStore.Split(
              transaction, structs, index, head, (int)(range.Clock - head.Id.Clock));
          index++;
        }

        while (index < structs.Count)
        {
          var current = structs[index++];

          if (current.Id.Clock >= clockEnd)
          {
            break;
          }

          if (current is not YItem item || item.Deleted)
          {
            continue;
          }

          if (clockEnd < item.Id.Clock + (ulong)item.Length)
          {
            StructStore.Split(
                transaction, structs, index - 1, item, (int)(clockEnd - item.Id.Clock));
          }

          item.Delete(transaction);
        }
      }
    }

    return unapplied.IsEmpty ? null : unapplied;
  }

  /// <summary>
  /// Sorts each client's ranges by clock and folds every touching or
  /// overlapping pair together, in place — yjs's sortAndMergeDeleteSet.
  /// </summary>
  public void SortAndMerge()
  {
    foreach (var ranges in clients.Values)
    {
      ranges.Sort((left, right) => left.Clock.CompareTo(right.Clock));

      var write = 1;

      for (var read = 1; read < ranges.Count; read++)
      {
        var left = ranges[write - 1];
        var right = ranges[read];

        if (left.Clock + left.Length >= right.Clock)
        {
          ranges[write - 1] = new DeleteRange(
              left.Clock,
              Math.Max(left.Length, right.Clock + right.Length - left.Clock));

          continue;
        }

        if (write < read)
        {
          ranges[write] = right;
        }

        write++;
      }

      if (ranges.Count > write)
      {
        ranges.RemoveRange(write, ranges.Count - write);
      }
    }
  }
}
