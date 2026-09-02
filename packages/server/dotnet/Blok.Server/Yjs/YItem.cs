namespace Blok.Server.Yjs;

/// <summary>
/// One YATA insertion. <see cref="Origin"/> and <see cref="RightOrigin"/> are
/// the ids the author saw around it and never change; <see cref="Left"/> and
/// <see cref="Right"/> are the live neighbours after integration.
/// </summary>
internal sealed class YItem : YStruct
{
  private const byte OriginBit = 0x80;

  private const byte RightOriginBit = 0x40;

  private const byte ParentSubBit = 0x20;

  private const byte ContentRefMask = 0x1F;

  /// <summary>Parent info: 1 names a root by string, 0 names an item by id.</summary>
  private const ulong RootParentInfo = 1;

  private const ulong NestedParentInfo = 0;

  public YId? Origin { get; set; }

  public YId? RightOrigin { get; set; }

  public YItem? Left { get; set; }

  public YItem? Right { get; set; }

  /// <summary>
  /// <see cref="YAbstractType"/> once resolved, otherwise the root name or the
  /// parent item's <see cref="YId"/> as the wire spelled it. It stays
  /// unresolved while the item is parked, so a root created later cannot
  /// orphan it.
  /// </summary>
  public object? Parent { get; set; }

  /// <summary>The map key this item is a value for; null for list content.</summary>
  public string? ParentSub { get; set; }

  /// <summary>
  /// The info byte's parentSub bit as the wire spelled it. yjs takes the bit
  /// from the WRITER's item and an origin suppresses the parentSub bytes, so a
  /// decoded item can be flagged for a parentSub it does not carry; without
  /// the flag a decode then re-encode drops the bit.
  /// </summary>
  public bool WireParentSubBit { get; set; }

  public required YContent Content { get; set; }

  public bool Deleted { get; set; }

  public override bool IsDeleted => Deleted;

  public bool Countable => Content.IsCountable;

  /// <summary>Set by the undo/GC machinery to hold an item's content; unused until GC lands.</summary>
  public bool Keep { get; set; }

  public void MarkDeleted()
  {
    Deleted = true;
  }

  /// <summary>
  /// yjs's Item.write. An <paramref name="offset"/> re-origins the item onto
  /// the tick before it, which is what lets a reader that already holds the
  /// head of a run take only the tail.
  ///
  /// The parent and the parentSub are on the wire only when NEITHER origin is:
  /// with a neighbour to inherit from, a reader copies them at integration.
  /// </summary>
  public void Write(Lib0Writer writer, int offset)
  {
    ArgumentNullException.ThrowIfNull(writer);

    var origin = offset > 0
        ? new YId(Id.Client, Id.Clock + (ulong)offset - 1)
        : Origin;

    writer.WriteUint8((byte)(
        (Content.Ref & ContentRefMask) |
        (origin is null ? 0 : OriginBit) |
        (RightOrigin is null ? 0 : RightOriginBit) |
        (ParentSub is null && !WireParentSubBit ? 0 : ParentSubBit)));

    if (origin is { } left)
    {
      WriteId(writer, left);
    }

    if (RightOrigin is { } right)
    {
      WriteId(writer, right);
    }

    if (origin is null && RightOrigin is null)
    {
      WriteParent(writer);

      if (ParentSub is { } key)
      {
        writer.WriteVarString(key);
      }
    }

    Content.Write(writer, offset);
  }

  /// <summary>
  /// The client whose structs must arrive before this one can be integrated,
  /// or null once every neighbour and the parent are in the store — in which
  /// case the neighbours are resolved here, splitting where needed.
  ///
  /// Nothing is mutated before all three checks pass, which is what lets the
  /// integrator park a struct and retry it later untouched. A root parent
  /// stays the wire's name until the very last step, so a root typed between
  /// two attempts cannot leave a parked struct pointing at a stale placeholder.
  /// </summary>
  public ulong? GetMissing(YTransaction transaction, StructStore store)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentNullException.ThrowIfNull(store);

    // yjs skips the store lookup when the dependency names the item's own
    // client, because a well-formed update always carries the earlier clock
    // first. Bytes that are well formed but dishonest need not, and the
    // lookup below would then throw mid-integration and leave the document
    // half-changed. Checking the clock costs nothing in the honest case: a
    // same-client dependency the store already holds is always behind its
    // state.
    if (Origin is { } origin && origin.Clock >= store.GetState(origin.Client))
    {
      return origin.Client;
    }

    if (RightOrigin is { } rightOrigin &&
        rightOrigin.Clock >= store.GetState(rightOrigin.Client))
    {
      return rightOrigin.Client;
    }

    if (Parent is YId parentId && parentId.Clock >= store.GetState(parentId.Client))
    {
      return parentId.Client;
    }

    YStruct? left = null;
    YStruct? right = null;

    if (Origin is { } originId)
    {
      left = store.GetItemCleanEnd(transaction, originId);
      Origin = left.LastId;
    }

    if (RightOrigin is { } rightOriginId)
    {
      right = store.GetStructCleanStart(transaction, rightOriginId);
      RightOrigin = right.Id;
    }

    Left = left as YItem;
    Right = right as YItem;

    if (left is YGc || right is YGc)
    {
      // A collected neighbour means the run this item belongs to is gone;
      // integration turns it into a GC of its own instead of placing it.
      Parent = null;
    }
    else if (Parent is null)
    {
      if (Left is { } inheritLeft)
      {
        Parent = inheritLeft.Parent;
        ParentSub = inheritLeft.ParentSub;
      }
      else if (Right is { } inheritRight)
      {
        Parent = inheritRight.Parent;
        ParentSub = inheritRight.ParentSub;
      }
    }
    else if (Parent is YId parent)
    {
      Parent = store.Find(parent) is YItem { Content: ContentType nested }
          ? nested.Type
          : null;
    }
    else if (Parent is string rootName)
    {
      Parent = transaction.Doc.Get(rootName);
    }

    return null;
  }

  /// <summary>
  /// YATA. <paramref name="offset"/> trims the clocks this store already has,
  /// then the conflict scan decides where among the concurrent insertions at
  /// the same point this one belongs — that scan is the whole of convergence.
  /// </summary>
  public void Integrate(YTransaction transaction, int offset)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    var store = transaction.Doc.Store;

    if (offset > 0)
    {
      Id = new YId(Id.Client, Id.Clock + (ulong)offset);

      var trimmed = store.GetItemCleanEnd(transaction, new YId(Id.Client, Id.Clock - 1));

      Left = trimmed as YItem;
      Origin = trimmed.LastId;
      Content = Content.Splice(offset);
      Length -= offset;

      if (trimmed is not YItem)
      {
        // Our own prefix was collected; yjs walks into the GC and crashes.
        Parent = null;
      }
    }

    if (Parent is null)
    {
      new YGc { Id = Id, Length = Length }.Integrate(transaction, 0);

      return;
    }

    if (Parent is not YAbstractType parent)
    {
      throw new InvalidOperationException(
          $"yjs: {Id.Client}:{Id.Clock} was integrated with an unresolved parent " +
          $"({Parent}); GetMissing resolves it first.");
    }

    if ((Left is null && (Right is null || Right.Left is not null)) ||
        (Left is not null && !ReferenceEquals(Left.Right, Right)))
    {
      ScanForConflicts(store, parent);
    }

    if (Left is { } placedAfter)
    {
      Right = placedAfter.Right;
      placedAfter.Right = this;
    }
    else
    {
      Right = FirstAt(parent, ParentSub);

      if (ParentSub is null)
      {
        parent.Start = this;
      }
    }

    if (Right is { } placedBefore)
    {
      placedBefore.Left = this;
    }
    else if (ParentSub is { } key)
    {
      // Last one written for the key wins; the value it replaces dies here.
      parent.Map[key] = this;
      Left?.Delete(transaction);
    }

    if (ParentSub is null && Countable && !Deleted)
    {
      parent.Length += Length;
    }

    store.AddStruct(this);
    Content.Integrate(transaction, this);

    if (parent.Item is { Deleted: true } || (ParentSub is not null && Right is not null))
    {
      Delete(transaction);
    }
  }

  /// <summary>
  /// Marks this item deleted and records the range in the transaction. The
  /// parent's length is adjusted BEFORE the mark, because the mark is what
  /// stops the item from counting.
  /// </summary>
  public void Delete(YTransaction transaction)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    if (DeleteHere(transaction))
    {
      Content.Delete(transaction);
    }
  }

  /// <summary>
  /// The delete without the cascade a nested type would run, and false when
  /// the item was already deleted.
  ///
  /// <see cref="ContentType"/> deletes its children through this and walks
  /// their subtrees from a work stack of its own: nesting depth belongs to the
  /// document, and a chain deep enough would exhaust the CLR stack — which,
  /// unlike a browser's, takes the process with it.
  /// </summary>
  internal bool DeleteHere(YTransaction transaction)
  {
    if (Deleted)
    {
      return false;
    }

    if (Parent is not YAbstractType parent)
    {
      throw new InvalidOperationException(
          $"yjs: {Id.Client}:{Id.Clock} was deleted before its parent was resolved.");
    }

    if (Countable && ParentSub is null)
    {
      parent.Length -= Length;
    }

    MarkDeleted();
    transaction.DeleteSet.Add(Id.Client, Id.Clock, (ulong)Length);

    return true;
  }

  /// <summary>
  /// Drops a deleted item's payload. Inside a collected subtree the struct
  /// itself becomes a <see cref="YGc"/>; on its own it keeps its place and
  /// only its content collapses to a tombstone.
  /// </summary>
  public void Gc(StructStore store, bool parentCollected)
  {
    ArgumentNullException.ThrowIfNull(store);

    // Checked before the cascade, not only in CollectHere: a live item must
    // not collect its subtree on the way to being refused.
    RequireDeleted();
    Content.Gc(store);
    CollectHere(store, parentCollected);
  }

  /// <inheritdoc cref="DeleteHere"/>
  internal void CollectHere(StructStore store, bool parentCollected)
  {
    RequireDeleted();

    if (parentCollected)
    {
      store.ReplaceStruct(this, new YGc { Id = Id, Length = Length });
    }
    else
    {
      Content = new ContentDeleted(Length);
    }
  }

  private void RequireDeleted()
  {
    if (!Deleted)
    {
      throw new InvalidOperationException(
          $"yjs: {Id.Client}:{Id.Clock} is still live and cannot be collected.");
    }
  }

  /// <summary>
  /// yjs's integration conflict scan: walk the items already sitting between
  /// this item's origin and its right origin, and move left past the ones
  /// that must come first. Case 1 is a tie at the same origin, broken by
  /// client id; case 2 is an item whose own origin sits before ours.
  /// </summary>
  private void ScanForConflicts(StructStore store, YAbstractType parent)
  {
    var left = Left;
    var current = left is not null ? left.Right : FirstAt(parent, ParentSub);
    var conflicting = new HashSet<YItem>();
    var beforeOrigin = new HashSet<YItem>();

    while (current is not null && !ReferenceEquals(current, Right))
    {
      beforeOrigin.Add(current);
      conflicting.Add(current);

      if (SameId(Origin, current.Origin))
      {
        if (current.Id.Client < Id.Client)
        {
          left = current;
          conflicting.Clear();
        }
        else if (SameId(RightOrigin, current.RightOrigin))
        {
          break;
        }
      }
      else if (current.Origin is { } currentOrigin &&
          store.Find(currentOrigin) is YItem origin &&
          beforeOrigin.Contains(origin))
      {
        if (!conflicting.Contains(origin))
        {
          left = current;
          conflicting.Clear();
        }
      }
      else
      {
        break;
      }

      current = current.Right;
    }

    Left = left;
  }

  /// <summary>
  /// A root parent is its name, a nested one its owning item's id. A parked
  /// item still holds the wire's spelling, which is the normal case rather
  /// than an edge one: nothing resolves a parent until integration.
  /// </summary>
  private void WriteParent(Lib0Writer writer)
  {
    switch (Parent)
    {
      case YAbstractType { Item: null } root:
        writer.WriteVarUint(RootParentInfo);
        writer.WriteVarString(
            root.RootName ??
            throw new InvalidOperationException(
                $"yjs: {Id.Client}:{Id.Clock} has a root parent with no name."));
        break;

      case YAbstractType nested:
        writer.WriteVarUint(NestedParentInfo);
        WriteId(writer, nested.Item.Id);
        break;

      case string name:
        writer.WriteVarUint(RootParentInfo);
        writer.WriteVarString(name);
        break;

      case YId parent:
        writer.WriteVarUint(NestedParentInfo);
        WriteId(writer, parent);
        break;

      default:
        throw new InvalidOperationException(
            $"yjs: {Id.Client}:{Id.Clock} has no parent to write.");
    }
  }

  private static void WriteId(Lib0Writer writer, YId id)
  {
    writer.WriteVarUint(id.Client);
    writer.WriteVarUint(id.Clock);
  }

  /// <summary>Head of the chain a new item without a left neighbour joins.</summary>
  private static YItem? FirstAt(YAbstractType parent, string? parentSub)
  {
    if (parentSub is null)
    {
      return parent.Start;
    }

    var head = parent.Map.GetValueOrDefault(parentSub);

    while (head is { Left: not null })
    {
      head = head.Left;
    }

    return head;
  }

  private static bool SameId(YId? left, YId? right)
  {
    return left is null ? right is null : right is { } other && left.Value == other;
  }

  /// <summary>
  /// Cuts this item at <paramref name="diff"/> clocks, keeping the left half in
  /// place and returning the new right half — yjs's splitItem, minus the
  /// transaction's merge queue and the redone pointer.
  ///
  /// The map head is re-pointed when the right half becomes the last value for
  /// a key, because a map reads its head item and the head is the newest one.
  /// </summary>
  public YItem SplitAt(int diff)
  {
    if (diff <= 0 || diff >= Length)
    {
      throw new InvalidOperationException(
          $"yjs: cannot split a {Length}-clock item at {diff}.");
    }

    var clock = Id.Clock + (ulong)diff;
    var oldRight = Right;
    var right = new YItem
    {
      Id = new YId(Id.Client, clock),
      Length = Length - diff,
      Left = this,
      Origin = new YId(Id.Client, clock - 1),
      Right = oldRight,
      RightOrigin = RightOrigin,
      Parent = Parent,
      ParentSub = ParentSub,
      Content = Content.Splice(diff),
      Deleted = Deleted,
      Keep = Keep,
    };

    Right = right;
    Length = diff;

    if (oldRight is { } next)
    {
      next.Left = right;
    }

    if (right.ParentSub is { } key && oldRight is null)
    {
      if (right.Parent is not YAbstractType parent)
      {
        throw new InvalidOperationException(
            $"yjs: the map head for '{key}' has an unresolved parent " +
            $"({right.Parent?.ToString() ?? "null"}); resolve it before splitting.");
      }

      parent.Map[key] = right;
    }

    return right;
  }
}
