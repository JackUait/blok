namespace Blok.Server.Yjs;

/// <summary>
/// One YATA insertion. <see cref="Origin"/> and <see cref="RightOrigin"/> are
/// the ids the author saw around it and never change; <see cref="Left"/> and
/// <see cref="Right"/> are the live neighbours after integration.
/// </summary>
internal sealed class YItem : YStruct
{
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

  public required YContent Content { get; set; }

  public bool Deleted { get; set; }

  public override bool IsDeleted => Deleted;

  public bool Countable => Content.IsCountable;

  /// <summary>Set by the undo/GC machinery to hold an item's content; unused until GC lands.</summary>
  public bool Keep { get; set; }

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
