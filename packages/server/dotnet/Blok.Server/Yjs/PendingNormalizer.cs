namespace Blok.Server.Yjs;

/// <summary>
/// One client's structs as a v1 update writes them: a start clock and a
/// contiguous run, each struct paired with the number of leading ticks the
/// reader already has.
/// </summary>
internal sealed record EncodedRun(
    ulong Client, ulong Clock, IReadOnlyList<(YStruct Struct, int Offset)> Structs);

/// <summary>
/// Turns the struct store — integrated structs plus whatever is still parked
/// — into the client runs a v1 update writes.
///
/// yjs holds pending structs as v2 bytes and folds them in with
/// <c>mergeUpdates</c>; this engine holds them as structs (Locked Decision 4),
/// so the merge is done here instead. The three rules mergeUpdates enforces
/// and this must too: a client appears exactly once, a client's clocks are
/// contiguous (every hole is a <see cref="YSkip"/>), and a struct overlapping
/// what precedes it is written at an offset rather than twice.
/// </summary>
internal static class PendingNormalizer
{
  /// <summary>
  /// The integrated structs only, as yjs's writeClientsStructs computes them:
  /// a client the target has seen part of is written from that clock, a client
  /// it has never heard of from the beginning, and a client it is level with
  /// is left out.
  /// </summary>
  public static IReadOnlyList<EncodedRun> StoreRuns(StructStore store, StateVector target)
  {
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(target);

    return Build(store, target, includePending: false);
  }

  /// <summary>The integrated structs with everything parked folded in.</summary>
  public static IReadOnlyList<EncodedRun> AllRuns(StructStore store, StateVector target)
  {
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(target);

    return Build(store, target, includePending: true);
  }

  private static List<EncodedRun> Build(
      StructStore store, StateVector target, bool includePending)
  {
    var starts = StartClocks(store, target);
    var parked = includePending ? ParkedByClient(store, target) : [];
    var clients = new HashSet<ulong>(starts.Keys);

    clients.UnionWith(parked.Keys);

    var runs = new List<EncodedRun>(clients.Count);

    // Descending client id, as yjs writes it, over the store's clients and the
    // parked ones together: a parked-only client is not a second pass.
    foreach (var client in clients.OrderByDescending(id => id))
    {
      var written = new List<(YStruct Struct, int Offset)>();
      var clock = starts.TryGetValue(client, out var start)
          ? AppendIntegrated(store, client, start, written)
          : 0UL;

      if (parked.TryGetValue(client, out var waiting))
      {
        clock = AppendParked(waiting, written.Count == 0 ? target.Get(client) : clock, written);
      }

      if (written.Count > 0)
      {
        runs.Add(new EncodedRun(client, clock, written));
      }
    }

    return runs;
  }

  /// <summary>
  /// Per client, the clock the target's diff starts at. yjs's writeClientsStructs
  /// in two passes: what the target has seen part of, then what it has never
  /// heard of at all.
  /// </summary>
  private static Dictionary<ulong, ulong> StartClocks(StructStore store, StateVector target)
  {
    var starts = new Dictionary<ulong, ulong>();
    var known = new HashSet<ulong>();

    foreach (var (client, clock) in target)
    {
      known.Add(client);

      if (store.GetState(client) > clock)
      {
        starts[client] = clock;
      }
    }

    foreach (var (client, _) in store.GetStateVector())
    {
      if (!known.Contains(client))
      {
        starts[client] = 0;
      }
    }

    return starts;
  }

  /// <summary>
  /// Appends the client's integrated tail and answers the clock the group
  /// starts at. The first struct carries the offset, so the run begins exactly
  /// where the target's knowledge ends rather than at a struct boundary.
  /// </summary>
  private static ulong AppendIntegrated(
      StructStore store, ulong client, ulong start, List<(YStruct, int)> written)
  {
    var structs = store.Clients[client];
    var clock = Math.Max(start, structs[0].Id.Clock);
    var first = store.FindIndex(client, clock);

    written.Add((structs[first], (int)(clock - structs[first].Id.Clock)));

    for (var index = first + 1; index < structs.Count; index++)
    {
      written.Add((structs[index], 0));
    }

    return clock;
  }

  /// <summary>
  /// Folds the parked structs in after the integrated tail, trimming what the
  /// reader already has and naming every hole. Returns the group's start clock,
  /// which only moves when nothing integrated was written.
  /// </summary>
  private static ulong AppendParked(
      List<YStruct> waiting, ulong clock, List<(YStruct Struct, int Offset)> written)
  {
    var start = clock;
    var covered = written.Count == 0 ? 0UL : End(written[^1]);

    foreach (var parked in waiting)
    {
      var boundary = Math.Max(clock, covered);
      var end = parked.Id.Clock + (ulong)parked.Length;

      if (end <= boundary)
      {
        // Already written, or behind what the target asked for.
        continue;
      }

      if (parked.Id.Clock > boundary && written.Count > 0)
      {
        // A Skip's length is an int here and an unbounded varuint on the wire,
        // and a peer can park a struct billions of clocks ahead without
        // forging anything. Consecutive Skips name one hole, so an oversized
        // gap is written as several rather than refused — refusing it took
        // down every sync answer and every compaction for the room's life.
        for (var hole = boundary; hole < parked.Id.Clock;)
        {
          var span = (int)Math.Min(parked.Id.Clock - hole, int.MaxValue);

          written.Add((new YSkip { Id = new YId(parked.Id.Client, hole), Length = span }, 0));
          hole += (ulong)span;
        }
      }

      var offset = parked.Id.Clock < boundary ? boundary - parked.Id.Clock : 0;

      if (written.Count == 0)
      {
        start = parked.Id.Clock + offset;
      }

      written.Add((parked, (int)offset));
      covered = end;
    }

    return start;
  }

  /// <summary>
  /// Parked structs per client, sorted by clock and filtered to what the
  /// target has not seen. A parked <see cref="YSkip"/> is dropped: it names a
  /// hole, and the gap filling below writes holes anyway.
  /// </summary>
  private static Dictionary<ulong, List<YStruct>> ParkedByClient(
      StructStore store, StateVector target)
  {
    var parked = new Dictionary<ulong, List<YStruct>>();

    foreach (var waiting in store.PendingStructs ?? [])
    {
      var client = waiting.Id.Client;

      if (waiting is YSkip ||
          waiting.Id.Clock + (ulong)waiting.Length <= target.Get(client))
      {
        continue;
      }

      if (!parked.TryGetValue(client, out var run))
      {
        run = [];
        parked[client] = run;
      }

      run.Add(waiting);
    }

    foreach (var run in parked.Values)
    {
      run.Sort((left, right) => left.Id.Clock.CompareTo(right.Id.Clock));
    }

    return parked;
  }

  private static ulong End((YStruct Struct, int Offset) written)
  {
    return written.Struct.Id.Clock + (ulong)written.Struct.Length;
  }
}
