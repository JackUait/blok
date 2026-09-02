namespace Blok.Server.Yjs;

/// <summary>
/// What an integration pass could not place: the structs, and per client the
/// clock they are waiting for. Kept as live structs rather than as re-encoded
/// bytes (Locked Decision 4), so a retry costs no decode.
/// </summary>
internal sealed record IntegrationRest(
    Dictionary<ulong, ulong> Missing, Dictionary<ulong, List<YStruct>> Structs);

/// <summary>
/// yjs's integrateStructs: a stack machine over the update's structs.
///
/// Structs arrive grouped by client and ascending by clock, but a struct can
/// depend on another client's struct further along in the same update. The
/// machine walks clients from the HIGHEST id down, and whenever a struct
/// names a dependency it pushes the struct and jumps to the client that
/// carries it, so a chain of dependencies is followed before anything is
/// parked. Only when the dependency is genuinely absent does the whole stack
/// — and the rest of each of those clients' runs — become pending.
/// </summary>
internal static class Integrator
{
  private const byte ParentSubBit = 0x20;

  /// <summary>
  /// The wire's structs as runtime structs, one pass per decode. A parent
  /// root stays the wire's NAME: the root it belongs to may not have been
  /// typed yet, and resolving early would pin a parked struct to a
  /// placeholder that a later GetMap replaces.
  /// </summary>
  public static Dictionary<ulong, List<YStruct>> ToRuntimeStructs(DecodedUpdate update)
  {
    ArgumentNullException.ThrowIfNull(update);

    var structs = new Dictionary<ulong, List<YStruct>>();

    foreach (var client in update.Structs)
    {
      var runtime = new List<YStruct>(client.Value.Count);

      foreach (var decoded in client.Value)
      {
        runtime.Add(ToRuntimeStruct(decoded));
      }

      structs[client.Key] = runtime;
    }

    return structs;
  }

  /// <summary>
  /// Integrates everything it can and returns the remainder, or null when
  /// nothing is left over.
  /// </summary>
  public static IntegrationRest? IntegrateStructs(
      YTransaction transaction,
      StructStore store,
      Dictionary<ulong, List<YStruct>> clientsStructRefs)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(clientsStructRefs);

    // Ascending, consumed from the end: the higher client id goes first
    // because it is the less likely to conflict with what is already here.
    var ids = clientsStructRefs.Keys.Order().ToList();

    if (ids.Count == 0)
    {
      return null;
    }

    var pending = clientsStructRefs.ToDictionary(
        client => client.Key, client => new ClientRefs(client.Value));
    var current = NextTarget(ids, pending);

    if (current is null)
    {
      return null;
    }

    var stack = new List<YStruct>();
    var rest = new Dictionary<ulong, List<YStruct>>();
    var missing = new Dictionary<ulong, ulong>();
    var state = new Dictionary<ulong, ulong>();
    var head = current.Refs[current.Index++];

    while (true)
    {
      if (head is not YSkip)
      {
        var client = head.Id.Client;

        if (!state.TryGetValue(client, out var localClock))
        {
          localClock = store.GetState(client);
          state[client] = localClock;
        }

        if (localClock < head.Id.Clock)
        {
          // A gap in this client's own run: nothing here can be placed until
          // the clocks in between arrive.
          stack.Add(head);
          RecordMissing(missing, client, head.Id.Clock - 1);
          Park(stack, ids, pending, rest);
        }
        else
        {
          var offset = localClock - head.Id.Clock;
          var dependency = head is YItem item ? item.GetMissing(transaction, store) : null;

          if (dependency is { } waitingFor)
          {
            stack.Add(head);

            if (pending.TryGetValue(waitingFor, out var carrier) &&
                carrier.Index < carrier.Refs.Count)
            {
              head = carrier.Refs[carrier.Index++];

              continue;
            }

            RecordMissing(missing, waitingFor, store.GetState(waitingFor));
            Park(stack, ids, pending, rest);
          }
          else if (offset == 0 || offset < (ulong)head.Length)
          {
            Integrate(head, transaction, (int)offset);
            state[client] = head.Id.Clock + (ulong)head.Length;
          }

          // Anything else is a run this store already holds whole: a
          // duplicate delivery, dropped.
        }
      }

      if (stack.Count > 0)
      {
        head = stack[^1];
        stack.RemoveAt(stack.Count - 1);
      }
      else if (current is not null && current.Index < current.Refs.Count)
      {
        head = current.Refs[current.Index++];
      }
      else
      {
        current = NextTarget(ids, pending);

        if (current is null)
        {
          break;
        }

        head = current.Refs[current.Index++];
      }
    }

    return rest.Count > 0 ? new IntegrationRest(missing, rest) : null;
  }

  private static YStruct ToRuntimeStruct(DecodedStruct decoded)
  {
    switch (decoded.Kind)
    {
      case DecodedStructKind.Gc:
        return new YGc { Id = decoded.Id, Length = decoded.Length };

      case DecodedStructKind.Skip:
        return new YSkip { Id = decoded.Id, Length = decoded.Length };

      default:
        return new YItem
        {
          Id = decoded.Id,
          Length = decoded.Length,
          Origin = decoded.Origin,
          RightOrigin = decoded.RightOrigin,
          Parent = (object?)decoded.ParentRoot ?? decoded.ParentId,
          ParentSub = decoded.ParentSub,

          // The wire flags a parentSub the item does not carry whenever an
          // origin suppressed the parent bytes; kept so re-encoding it is
          // byte-identical, since ParentSub alone cannot say.
          WireParentSubBit = (decoded.Info & ParentSubBit) != 0,

          // Copied because integration splices content in place; the decoded
          // update stays re-appliable.
          Content = (decoded.Content ??
              throw new InvalidOperationException(
                  $"yjs: the item at {decoded.Id.Client}:{decoded.Id.Clock} has no content."))
              .Copy(),
        };
    }
  }

  private static void Integrate(YStruct head, YTransaction transaction, int offset)
  {
    switch (head)
    {
      case YItem item:
        item.Integrate(transaction, offset);
        break;

      case YGc collected:
        collected.Integrate(transaction, offset);
        break;

      default:
        throw new InvalidOperationException(
            $"yjs: {head.GetType().Name} is never integrated.");
    }
  }

  /// <summary>Minimum wins: the earliest clock a client is waiting for.</summary>
  private static void RecordMissing(
      Dictionary<ulong, ulong> missing, ulong client, ulong clock)
  {
    if (!missing.TryGetValue(client, out var known) || known > clock)
    {
      missing[client] = clock;
    }
  }

  /// <summary>
  /// Parks the stack and, with each stacked struct, the whole unconsumed
  /// remainder of its client's run — everything after a struct that cannot be
  /// placed depends on it. The client is then struck off this pass entirely,
  /// so the same update cannot half-apply it twice.
  /// </summary>
  private static void Park(
      List<YStruct> stack,
      List<ulong> ids,
      Dictionary<ulong, ClientRefs> pending,
      Dictionary<ulong, List<YStruct>> rest)
  {
    foreach (var parked in stack)
    {
      var client = parked.Id.Client;

      if (pending.TryGetValue(client, out var refs))
      {
        refs.Index--;

        // A Skip names a hole its sender is not filling, and nothing that
        // reads the parked set wants one: integration ignores Skips, and the
        // diff writer re-derives every hole from the gaps between what is
        // parked. Keeping one lets it stand in for content — the merge that
        // folds a later delivery in measures coverage by clock range, so a
        // parked Skip makes the real content for those clocks look like a
        // duplicate and it is dropped. The struct that failed is never a
        // Skip, so the range still starts on real content.
        rest[client] = refs.Refs
            .GetRange(refs.Index, refs.Refs.Count - refs.Index)
            .Where(waiting => waiting is not YSkip)
            .ToList();
        pending.Remove(client);
        refs.Index = 0;
        refs.Refs = [];
      }
      else
      {
        rest[client] = [parked];
      }
    }

    stack.Clear();
  }

  /// <summary>
  /// The next client to read from, highest id first. A client Park struck off
  /// is simply no longer in <paramref name="pending"/> — dropping it from the
  /// id list there instead would be a scan per park, and one legal frame can
  /// carry tens of thousands of clients.
  /// </summary>
  private static ClientRefs? NextTarget(List<ulong> ids, Dictionary<ulong, ClientRefs> pending)
  {
    while (ids.Count > 0)
    {
      if (pending.TryGetValue(ids[^1], out var target) && target.Refs.Count != target.Index)
      {
        return target;
      }

      ids.RemoveAt(ids.Count - 1);
    }

    return null;
  }

  /// <summary>
  /// One client's structs and how far the pass has read into them. Mutable
  /// and shared: the machine keeps pointing at this object after Park has
  /// emptied it, and reads the emptiness as "move on to the next client".
  /// </summary>
  private sealed class ClientRefs(List<YStruct> refs)
  {
    public List<YStruct> Refs { get; set; } = refs;

    public int Index { get; set; }
  }
}
