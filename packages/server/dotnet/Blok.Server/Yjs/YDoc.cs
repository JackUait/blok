using System.Security.Cryptography;

namespace Blok.Server.Yjs;

/// <summary>
/// A Yjs document: the struct store, the named roots, and the transaction
/// that turns applied bytes or local writes into exactly one emitted update.
///
/// It holds no native resource and is not disposable; a subscriber to
/// <see cref="UpdateEmitted"/> unsubscribes with <c>-=</c>.
/// </summary>
internal sealed class YDoc
{
  private readonly Dictionary<string, YAbstractType> share = new(StringComparer.Ordinal);

  public YDoc(uint? clientId = null)
  {
    ClientId = clientId ?? NewClientId();
    UpdateEncoder = UpdateV1Encoder.FromTransaction;
  }

  /// <summary>Raised once per transaction that changed anything.</summary>
  public event Action<YUpdateEvent>? UpdateEmitted;

  /// <summary>
  /// Regenerated when a remote transaction advances this client's own clock:
  /// another writer is using the same id, and keeping it would fork history.
  /// </summary>
  public ulong ClientId { get; private set; }

  public StructStore Store { get; } = new();

  /// <summary>Content GC of deleted items; on by default (Global Constraints).</summary>
  public bool Gc { get; init; } = true;

  /// <summary>The health signal: structs or deletions this document cannot apply yet.</summary>
  public bool HasPending => Store.PendingStructs is not null || Store.PendingDs is not null;

  /// <summary>
  /// What a finished transaction is turned into; the v1 encoder by default.
  /// A test replaces it to watch a transaction without an update being built.
  /// </summary>
  internal Func<YTransaction, byte[]?>? UpdateEncoder { get; set; }

  /// <summary>The open transaction; a nested Transact reuses it, as yjs does.</summary>
  internal YTransaction? CurrentTransaction { get; private set; }

  /// <summary>
  /// The root under <paramref name="name"/>, untyped when nothing has asked
  /// for a kind yet. Integration goes through here, so a root an update
  /// mentions exists before anything decides what it is.
  /// </summary>
  public YAbstractType Get(string name)
  {
    if (share.TryGetValue(name, out var existing))
    {
      return existing;
    }

    var placeholder = new YUntypedType { RootName = name };

    placeholder.Integrate(this, null);
    share[name] = placeholder;

    return placeholder;
  }

  public YMap GetMap(string name)
  {
    return GetTyped(name, static () => new YMap());
  }

  public YArray GetArray(string name)
  {
    return GetTyped(name, static () => new YArray());
  }

  public YText GetText(string name)
  {
    return GetTyped(name, static () => new YText());
  }

  public byte[] EncodeStateVector()
  {
    return Store.GetStateVector().Encode();
  }

  /// <summary>
  /// Everything <paramref name="targetStateVector"/> has not seen, as one v1
  /// update — yjs's encodeStateAsUpdate. An empty span means "has seen
  /// nothing", which is also what yjs's one-byte empty vector means.
  ///
  /// Parked structs are part of the answer (Locked Decision 4), and the
  /// delete set is the store's whole history plus what is parked, regardless
  /// of the target: a deletion names clocks the target may already hold.
  /// </summary>
  public byte[] EncodeStateAsUpdate(ReadOnlySpan<byte> targetStateVector = default)
  {
    var target = targetStateVector.IsEmpty
        ? StateVector.Empty
        : StateVector.Decode(targetStateVector);
    var writer = new Lib0Writer();

    UpdateV1Encoder.WriteRuns(writer, PendingNormalizer.AllRuns(Store, target));
    DeletedSoFar().Write(writer);

    return writer.ToArray();
  }

  /// <summary>
  /// Decodes and applies. Malformed bytes are reported rather than thrown,
  /// and nothing has touched the document by the time they are: the decoder
  /// reads the whole update before anything is integrated.
  /// </summary>
  public ApplyResult ApplyUpdate(ReadOnlySpan<byte> update)
  {
    DecodedUpdate decoded;

    try
    {
      decoded = UpdateV1Decoder.Decode(update);
    }
    catch (Lib0FormatException failure)
    {
      return new ApplyResult(ApplyOutcome.Malformed, HasPending, Changed: false, failure.Message);
    }

    return ApplyUpdate(decoded);
  }

  /// <summary>One transaction, marked remote, for the whole update.</summary>
  public ApplyResult ApplyUpdate(DecodedUpdate update)
  {
    ArgumentNullException.ThrowIfNull(update);

    var parkedBefore = ParkedCoverage();

    Transact(
        transaction =>
        {
          transaction.Local = false;
          ApplyDecoded(transaction, Integrator.ToRuntimeStructs(update), update.DeleteSet);
        },
        local: false,
        out var moved);

    return new ApplyResult(
        ApplyOutcome.Applied,
        HasPending,
        moved || ParkedCoverage() != parkedBefore,
        null);
  }

  /// <summary>
  /// Runs <paramref name="body"/> in a local transaction and returns the
  /// update it emitted, or null when it changed nothing (or when no encoder
  /// is installed yet). A nested call joins the open transaction and returns
  /// null, because only the outermost one emits.
  /// </summary>
  public byte[]? Transact(Action<YTransaction> body)
  {
    return Transact(body, local: true);
  }

  /// <summary>
  /// yjs's createDeleteSetFromStructStore plus whatever deletions are still
  /// parked. Built fresh on every call so nothing here can mutate PendingDs.
  /// </summary>
  private DeleteSet DeletedSoFar()
  {
    var deletions = new DeleteSet();

    foreach (var (client, structs) in Store.Clients)
    {
      foreach (var current in structs)
      {
        if (current.IsDeleted)
        {
          deletions.Add(client, current.Id.Clock, (ulong)current.Length);
        }
      }
    }

    if (Store.PendingDs is { } parked)
    {
      CopyRanges(parked, deletions);
    }

    deletions.SortAndMerge();

    return deletions;
  }

  private static ulong NewClientId()
  {
    return BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4));
  }

  private static DeleteSet? MergeDeleteSets(DeleteSet? left, DeleteSet? right)
  {
    if (left is null || right is null)
    {
      return left ?? right;
    }

    var merged = new DeleteSet();

    CopyRanges(left, merged);
    CopyRanges(right, merged);
    merged.SortAndMerge();

    return merged;
  }

  private byte[]? Transact(Action<YTransaction> body, bool local)
  {
    return Transact(body, local, out _);
  }

  private byte[]? Transact(Action<YTransaction> body, bool local, out bool moved)
  {
    ArgumentNullException.ThrowIfNull(body);

    if (CurrentTransaction is { } open)
    {
      body(open);

      // A nested run reports through the outermost transaction, which is the
      // one that will be cleaned up and measured.
      moved = false;

      return null;
    }

    var transaction = new YTransaction(this, local);

    CurrentTransaction = transaction;

    try
    {
      body(transaction);
    }
    finally
    {
      CurrentTransaction = null;
    }

    var update = Cleanup(transaction);
    moved = Moved(transaction);

    return update;
  }

  /// <summary>
  /// How much the store has PARKED: the clocks covered by waiting structs,
  /// plus the clocks covered by waiting deletions. Each half is a union, and
  /// the two are ADDED — a clock parked as a struct and also named by a
  /// parked deletion counts once on each side, deliberately.
  /// </summary>
  /// <remarks>
  /// <para>
  /// Compared across an apply, this is what separates "this update parked
  /// something new" from "this update merely touched the parked state".
  /// Nothing cheaper works. <see cref="DeleteSet.Apply"/> opens with
  /// <c>new DeleteSet()</c> and ALWAYS allocates, and
  /// <c>MergeDeleteSets(null, X)</c> returns that fresh object, so while
  /// anything is parked <see cref="StructStore.PendingDs"/> gets a new
  /// identity on every apply — including one that decoded to nothing at all.
  /// Reference identity and object counts both answer "yes, changed" there.
  /// </para>
  /// <para>
  /// BOTH halves must be a union, and neither may be a sum of lengths.
  /// Overlapping runs really do park: <c>MergeParked</c> drops only a run
  /// FULLY covered by one kept before it, so two partially overlapping runs
  /// are both kept; and a parked delete set is stored exactly as it arrived
  /// (<c>PendingDs = unappliedNow</c>), while <see cref="DeleteSet.Read"/>
  /// appends when a client is listed twice. A length sum then counts shared
  /// clocks twice, and an arrival that unions those runs — covering MORE
  /// clocks with the SAME total — reads as "nothing new". That is a false
  /// negative: the update is applied to the live document and then journalled
  /// nowhere and relayed to nobody.
  /// </para>
  /// <para>
  /// The merge runs on a COPY. Merging the stored collections in place would
  /// edit the document's own parked state from what is supposed to be a read.
  /// </para>
  /// </remarks>
  private ulong ParkedCoverage()
  {
    var structs = new DeleteSet();

    foreach (var waiting in Store.PendingStructs ?? [])
    {
      structs.Add(waiting.Id.Client, waiting.Id.Clock, (ulong)waiting.Length);
    }

    var deletions = new DeleteSet();

    if (Store.PendingDs is { } parked)
    {
      CopyRanges(parked, deletions);
    }

    // Two unions, added — never one. A clock can be parked as a struct AND as
    // a deletion, and those are different facts; folding them together would
    // let an arriving deletion of an already-parked clock read as nothing new.
    return UnionLength(structs) + UnionLength(deletions);
  }

  /// <summary>
  /// Total clocks the ranges cover, overlaps counted once. MUTATES what it is
  /// handed — <see cref="DeleteSet.SortAndMerge"/> runs in place — so it may
  /// only ever be passed a scratch set. Handing it
  /// <see cref="StructStore.PendingDs"/> would rewrite the document's parked
  /// state from what reads as a measurement.
  /// </summary>
  private static ulong UnionLength(DeleteSet ranges)
  {
    ranges.SortAndMerge();

    var length = 0UL;

    foreach (var (_, merged) in ranges.Clients)
    {
      foreach (var range in merged)
      {
        length += range.Length;
      }
    }

    return length;
  }

  /// <summary>
  /// Whether the transaction moved the document: it integrated a struct, or
  /// it deleted something that was not already deleted.
  /// </summary>
  /// <remarks>
  /// This MUST agree with <see cref="UpdateV1Encoder.FromTransaction"/>'s
  /// "nothing to emit" test — the two say the same thing, and a caller that
  /// trusted one while the other drifted would relay an update the document
  /// never made, or drop one it did. They are written apart because
  /// <see cref="UpdateEncoder"/> is a swappable hook and this is not:
  /// deriving the answer from whether that hook produced bytes would make
  /// correctness depend on which encoder happens to be installed.
  /// </remarks>
  private static bool Moved(YTransaction transaction)
  {
    if (transaction.DeleteSet.Count != 0)
    {
      return true;
    }

    var after = transaction.AfterState ?? transaction.Doc.Store.GetStateVector();

    foreach (var (client, clock) in after)
    {
      if (transaction.BeforeState.Get(client) != clock)
      {
        return true;
      }
    }

    return false;
  }

  /// <summary>
  /// yjs's readUpdateV2 body. The retry is a nested run over what is already
  /// parked, and it happens INSIDE this transaction: an update that closes a
  /// gap must land together with the structs it unblocks, or the emitted
  /// update would describe half a change.
  /// </summary>
  private void ApplyDecoded(
      YTransaction transaction,
      Dictionary<ulong, List<YStruct>> structs,
      DeleteSet deleteSet)
  {
    var retry = false;
    var rest = Integrator.IntegrateStructs(transaction, Store, structs);

    if (Store.PendingStructs is not null)
    {
      // A dictionary rather than the vector: "no entry" and "waiting for
      // clock 0" are different answers, and Get cannot tell them apart.
      var missing = ToDictionary(Store.PendingMissing);

      foreach (var (client, clock) in missing)
      {
        if (clock < Store.GetState(client))
        {
          retry = true;

          break;
        }
      }

      if (rest is not null)
      {
        foreach (var (client, clock) in rest.Missing)
        {
          if (!missing.TryGetValue(client, out var known) || known > clock)
          {
            missing[client] = clock;
          }
        }

        Store.PendingMissing = ToStateVector(missing);
        Store.PendingStructs = MergeParked(Store.PendingStructs, rest.Structs);
      }
    }
    else if (rest is not null)
    {
      Store.PendingStructs = Flatten(rest.Structs);
      Store.PendingMissing = ToStateVector(rest.Missing);
    }

    var unappliedNow = deleteSet.Apply(transaction, Store);

    if (Store.PendingDs is { } parkedDeletes)
    {
      Store.PendingDs = MergeDeleteSets(unappliedNow, parkedDeletes.Apply(transaction, Store));
    }
    else
    {
      Store.PendingDs = unappliedNow;
    }

    if (!retry)
    {
      return;
    }

    var parked = Store.PendingStructs ?? [];

    Store.PendingStructs = null;
    Store.PendingMissing = null;

    // The parked set carries no deletions of its own; the store's pending
    // delete set is retried above, on this pass and on the nested one.
    ApplyDecoded(transaction, Group(parked), new DeleteSet());
  }

  /// <summary>
  /// Union per client in clock order, dropping a struct whose whole run is
  /// already parked: the same update is delivered more than once by design,
  /// and a duplicate would be integrated twice on the retry.
  /// </summary>
  private static List<YStruct> MergeParked(
      List<YStruct> parked, Dictionary<ulong, List<YStruct>> arriving)
  {
    var byClient = Group(parked);

    foreach (var (client, structs) in arriving)
    {
      if (!byClient.TryGetValue(client, out var known))
      {
        byClient[client] = [.. structs];

        continue;
      }

      known.AddRange(structs);
      known.Sort((left, right) => left.Id.Clock.CompareTo(right.Id.Clock));

      var kept = new List<YStruct>(known.Count);
      var covered = 0UL;

      foreach (var candidate in known)
      {
        if (kept.Count > 0 && candidate.Id.Clock + (ulong)candidate.Length <= covered)
        {
          continue;
        }

        kept.Add(candidate);
        covered = Math.Max(covered, candidate.Id.Clock + (ulong)candidate.Length);
      }

      byClient[client] = kept;
    }

    return Flatten(byClient);
  }

  private static void CopyRanges(DeleteSet source, DeleteSet target)
  {
    foreach (var (client, ranges) in source.Clients)
    {
      foreach (var range in ranges)
      {
        target.Add(client, range.Clock, range.Length);
      }
    }
  }

  private static Dictionary<ulong, ulong> ToDictionary(StateVector? vector)
  {
    var clocks = new Dictionary<ulong, ulong>();

    foreach (var (client, clock) in vector ?? StateVector.Empty)
    {
      clocks[client] = clock;
    }

    return clocks;
  }

  private static Dictionary<ulong, List<YStruct>> Group(List<YStruct> structs)
  {
    var byClient = new Dictionary<ulong, List<YStruct>>();

    foreach (var parked in structs)
    {
      if (!byClient.TryGetValue(parked.Id.Client, out var run))
      {
        run = [];
        byClient[parked.Id.Client] = run;
      }

      run.Add(parked);
    }

    return byClient;
  }

  private static List<YStruct> Flatten(Dictionary<ulong, List<YStruct>> byClient)
  {
    var flat = new List<YStruct>();

    foreach (var client in byClient.OrderBy(entry => entry.Key))
    {
      flat.AddRange(client.Value);
    }

    return flat;
  }

  private static StateVector ToStateVector(Dictionary<ulong, ulong> missing)
  {
    var vector = new StateVector();

    foreach (var (client, clock) in missing)
    {
      vector.Set(client, clock);
    }

    return vector;
  }

  private T GetTyped<T>(string name, Func<T> create)
      where T : YAbstractType
  {
    var existing = Get(name);

    if (existing is T already)
    {
      return already;
    }

    if (existing is not YUntypedType)
    {
      throw new InvalidOperationException(
          $"Type with the name {name} has already been defined with a different constructor");
    }

    var upgraded = create();

    upgraded.RootName = name;

    // Every item still points at the placeholder, and a map key's older
    // values hang off its head to the LEFT, so both chains are re-pointed.
    foreach (var (key, head) in existing.Map)
    {
      upgraded.Map[key] = head;

      for (YItem? item = head; item is not null; item = item.Left)
      {
        item.Parent = upgraded;
      }
    }

    upgraded.Start = existing.Start;

    for (var item = upgraded.Start; item is not null; item = item.Right)
    {
      item.Parent = upgraded;
    }

    upgraded.Length = existing.Length;
    share[name] = upgraded;
    upgraded.Integrate(this, null);

    return upgraded;
  }

  /// <summary>
  /// yjs's cleanupTransactions, minus the observers and minus item merging
  /// (Global Constraints): fold the delete set, snapshot the after state,
  /// collect deleted content, re-mint the client id if a remote writer used
  /// it, then emit one update.
  /// </summary>
  private byte[]? Cleanup(YTransaction transaction)
  {
    transaction.DeleteSet.SortAndMerge();
    transaction.AfterState = Store.GetStateVector();

    if (Gc)
    {
      CollectDeleted(transaction.DeleteSet);
    }

    if (!transaction.Local &&
        transaction.AfterState.Get(ClientId) != transaction.BeforeState.Get(ClientId))
    {
      ClientId = NewClientId();
    }

    var update = UpdateEncoder?.Invoke(transaction);

    if (update is not null)
    {
      UpdateEmitted?.Invoke(new YUpdateEvent(update, transaction.Local));
    }

    return update;
  }

  /// <summary>
  /// yjs's tryGcDeleteSet. The struct at an index is re-read every step
  /// because collecting a subtree replaces entries in the same list.
  /// </summary>
  private void CollectDeleted(DeleteSet deleted)
  {
    foreach (var (client, ranges) in deleted.Clients)
    {
      if (!Store.Clients.TryGetValue(client, out var structs))
      {
        continue;
      }

      for (var range = ranges.Count - 1; range >= 0; range--)
      {
        var end = ranges[range].Clock + ranges[range].Length;

        for (var index = Store.FindIndex(client, ranges[range].Clock);
            index < structs.Count && structs[index].Id.Clock < end;
            index++)
        {
          if (structs[index] is YItem { Deleted: true, Keep: false } collectable)
          {
            collectable.Gc(Store, false);
          }
        }
      }
    }
  }
}
