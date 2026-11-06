using Blok.Server.Yjs;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// yjs 13.6.33's Y.UndoManager (utils/UndoManager.js), with captureTimeout 0, no
/// delete filter and ignoreRemoteMapChanges off, as store-applier.ts builds it.
/// Each tracked transaction is one stack item of what it inserted and deleted;
/// undo deletes the insertions and re-inserts the deletions (Item.redoItem), so a
/// peer's concurrent text and map writes stay.
/// </summary>
internal sealed class LiveUndoManager
{
  private readonly YDoc doc;
  private readonly IReadOnlyList<YAbstractType> scope;
  private readonly Func<object, bool> tracks;
  private readonly Action<object, Action<YTransaction>> transact;
  private bool undoing;
  private bool redoing;
  private StackItem? current;

  // transact runs the body in one transaction under the origin; the owner then
  // calls AfterTransaction when it changed something.
  internal LiveUndoManager(
      YDoc doc, IReadOnlyList<YAbstractType> scope, Func<object, bool> tracks, Action<object, Action<YTransaction>> transact)
  {
    this.doc = doc;
    this.scope = scope;
    this.tracks = tracks;
    this.transact = transact;
  }

  internal sealed class StackItem(DeleteSet deletions, DeleteSet insertions)
  {
    internal DeleteSet Deletions { get; } = deletions;
    internal DeleteSet Insertions { get; } = insertions;
  }

  internal List<StackItem> UndoStack { get; } = [];

  internal List<StackItem> RedoStack { get; } = [];

  /// <summary>yjs's afterTransactionHandler. The manager's own replays are always tracked.</summary>
  internal void AfterTransaction(object origin, YTransaction transaction)
  {
    if (!ReferenceEquals(origin, this) && !tracks(origin))
    {
      return;
    }
    var stack = undoing ? RedoStack : UndoStack;

    if (!undoing && !redoing)
    {
      ClearRedo();
    }
    var insertions = new DeleteSet();

    foreach (var (client, end) in transaction.AfterState!)
    {
      var start = transaction.BeforeState.Get(client);

      if (end > start)
      {
        insertions.Add(client, start, end - start);
      }
    }
    // captureTimeout 0: never merged into the last item.
    stack.Add(new StackItem(transaction.DeleteSet, insertions));
    IterateDeletedStructs(null, transaction.DeleteSet, item =>
    {
      if (item is YItem deleted && InScope(deleted))
      {
        KeepItem(deleted, true);
      }
    });
  }

  internal StackItem? Undo()
  {
    undoing = true;
    try
    {
      return PopStackItem(UndoStack);
    }
    finally
    {
      undoing = false;
    }
  }

  internal StackItem? Redo()
  {
    redoing = true;
    try
    {
      return PopStackItem(RedoStack);
    }
    finally
    {
      redoing = false;
    }
  }

  private StackItem? PopStackItem(List<StackItem> stack)
  {
    transact(this, transaction =>
    {
      var store = doc.Store;

      while (stack.Count > 0 && current is null)
      {
        var stackItem = stack[^1];

        stack.RemoveAt(stack.Count - 1);
        var itemsToRedo = new List<YItem>();
        var toRedo = new HashSet<YItem>(ReferenceEqualityComparer.Instance);
        var itemsToDelete = new List<YItem>();
        var performedChange = false;

        IterateDeletedStructs(transaction, stackItem.Insertions, found =>
        {
          if (found is not YItem inserted)
          {
            return;
          }
          if (inserted.Redone is not null)
          {
            var (item, diff) = FollowRedone(store, inserted.Id);

            if (diff > 0)
            {
              item = store.GetItemCleanStart(transaction, new YId(item.Id.Client, item.Id.Clock + diff));
            }
            inserted = (YItem)item;
          }
          if (!inserted.Deleted && InScope(inserted))
          {
            itemsToDelete.Add(inserted);
          }
        });
        IterateDeletedStructs(transaction, stackItem.Deletions, found =>
        {
          // Never redo what this item also inserted: it was created and deleted in the same step.
          if (found is YItem deleted && InScope(deleted) && !IsDeleted(stackItem.Insertions, deleted.Id) && toRedo.Add(deleted))
          {
            itemsToRedo.Add(deleted);
          }
        });
        foreach (var item in itemsToRedo)
        {
          performedChange = RedoItem(transaction, item, toRedo, stackItem.Insertions) is not null || performedChange;
        }
        // Children before parents.
        for (var i = itemsToDelete.Count - 1; i >= 0; i--)
        {
          itemsToDelete[i].Delete(transaction);
          performedChange = true;
        }
        current = performedChange ? stackItem : null;
      }
    });
    var result = current;

    current = null;

    return result;
  }

  private void ClearRedo()
  {
    foreach (var item in RedoStack)
    {
      IterateDeletedStructs(null, item.Deletions, found =>
      {
        if (found is YItem deleted && InScope(deleted))
        {
          KeepItem(deleted, false);
        }
      });
    }
    RedoStack.Clear();
  }

  private bool InScope(YItem item) => scope.Any(type => IsParentOf(type, item));

  /// <summary>yjs's redoItem (structs/Item.js).</summary>
  private YItem? RedoItem(YTransaction transaction, YItem item, HashSet<YItem> redoItems, DeleteSet itemsToDelete)
  {
    var store = doc.Store;

    if (item.Redone is { } redone)
    {
      return store.GetItemCleanStart(transaction, redone);
    }
    var parentItem = ((YAbstractType)item.Parent!).Item;
    YItem? left = null;
    YItem? right;

    if (parentItem is { Deleted: true })
    {
      // Redo the parent first, if this step redoes it anyway.
      if (parentItem.Redone is null && (!redoItems.Contains(parentItem) || RedoItem(transaction, parentItem, redoItems, itemsToDelete) is null))
      {
        return null;
      }
      while (parentItem.Redone is { } next)
      {
        parentItem = store.GetItemCleanStart(transaction, next);
      }
    }
    var parentType = parentItem is null ? (YAbstractType)item.Parent! : ((ContentType)parentItem.Content).Type;

    if (item.ParentSub is null)
    {
      // An array item goes back at its old place.
      left = item.Left;
      right = item;
      while (left is not null)
      {
        var trace = left;

        while (trace is not null && !ReferenceEquals(ParentItemOf(trace), parentItem))
        {
          trace = trace.Redone is { } id ? store.GetItemCleanStart(transaction, id) : null;
        }
        if (trace is not null && ReferenceEquals(ParentItemOf(trace), parentItem))
        {
          left = trace;
          break;
        }
        left = left.Left;
      }
      while (right is not null)
      {
        var trace = right;

        while (trace is not null && !ReferenceEquals(ParentItemOf(trace), parentItem))
        {
          trace = trace.Redone is { } id ? store.GetItemCleanStart(transaction, id) : null;
        }
        if (trace is not null && ReferenceEquals(ParentItemOf(trace), parentItem))
        {
          right = trace;
          break;
        }
        right = right.Right;
      }
    }
    else
    {
      right = null;
      if (item.Right is not null)
      {
        left = item;
        // A right neighbour this step or a stack deletes is one the item should replace.
        while (left is not null && left.Right is { } next
            && (next.Redone is not null || IsDeleted(itemsToDelete, next.Id) || DeletedByStack(UndoStack, next.Id) || DeletedByStack(RedoStack, next.Id)))
        {
          left = next;
          while (left.Redone is { } id)
          {
            left = store.GetItemCleanStart(transaction, id);
          }
        }
        if (left is { Right: not null })
        {
          // A peer wrote the key since: their value stays.
          return null;
        }
      }
      else
      {
        left = parentType.Map.GetValueOrDefault(item.ParentSub);
      }
      // A cross-parent left would mislead the remote (yjs #757).
      if (left is not null && !ReferenceEquals(ParentItemOf(left), parentItem))
      {
        left = parentType.Map.GetValueOrDefault(item.ParentSub);
      }
    }
    var content = item.Content.Copy();
    var redoneItem = new YItem
    {
      Id = new YId(doc.ClientId, store.GetState(doc.ClientId)),
      Length = content.Length,
      Left = left,
      Origin = left?.LastId,
      Right = right,
      RightOrigin = right?.Id,
      Parent = parentType,
      ParentSub = item.ParentSub,
      WireParentSubBit = item.ParentSub is not null,
      Content = content,
    };

    item.Redone = redoneItem.Id;
    KeepItem(redoneItem, true);
    redoneItem.Integrate(transaction, 0);

    return redoneItem;
  }

  private static YItem? ParentItemOf(YItem item) => ((YAbstractType)item.Parent!).Item;

  private static bool DeletedByStack(List<StackItem> stack, YId id) => stack.Any(entry => IsDeleted(entry.Deletions, id));

  private static (YStruct Item, ulong Diff) FollowRedone(StructStore store, YId id)
  {
    YId? next = id;
    ulong diff = 0;
    YStruct item;

    do
    {
      var at = next!.Value;

      if (diff > 0)
      {
        at = new YId(at.Client, at.Clock + diff);
      }
      item = store.Find(at);
      diff = at.Clock - item.Id.Clock;
      next = (item as YItem)?.Redone;
    }
    while (next is not null && item is YItem);

    return (item, diff);
  }

  private static void KeepItem(YItem? item, bool keep)
  {
    while (item is not null && item.Keep != keep)
    {
      item.Keep = keep;
      item = ((YAbstractType)item.Parent!).Item;
    }
  }

  private static bool IsParentOf(YAbstractType parent, YItem? child)
  {
    while (child is not null)
    {
      if (ReferenceEquals(child.Parent, parent))
      {
        return true;
      }
      child = (child.Parent as YAbstractType)?.Item;
    }

    return false;
  }

  private static bool IsDeleted(DeleteSet set, YId id) =>
      set.Clients.Any(entry => entry.Key == id.Client && entry.Value.Any(range => range.Clock <= id.Clock && id.Clock < range.Clock + range.Length));

  /// <summary>yjs's iterateDeletedStructs: splits at both edges of each range, so only its clocks are visited.</summary>
  private void IterateDeletedStructs(YTransaction? transaction, DeleteSet set, Action<YStruct> visit)
  {
    foreach (var (client, ranges) in set.Clients.ToList())
    {
      if (!doc.Store.Clients.TryGetValue(client, out var structs) || structs.Count == 0)
      {
        continue;
      }
      var last = structs[^1];
      var clockState = last.Id.Clock + (ulong)last.Length;

      foreach (var range in ranges.ToList())
      {
        if (range.Clock >= clockState)
        {
          break;
        }
        IterateStructs(transaction, structs, range.Clock, range.Length, visit);
      }
    }
  }

  private static void IterateStructs(YTransaction? transaction, List<YStruct> structs, ulong clockStart, ulong length, Action<YStruct> visit)
  {
    if (length == 0)
    {
      return;
    }
    var clockEnd = clockStart + length;
    var index = FindIndexCleanStart(transaction, structs, clockStart);
    YStruct found;

    do
    {
      found = structs[index++];
      if (clockEnd < found.Id.Clock + (ulong)found.Length)
      {
        FindIndexCleanStart(transaction, structs, clockEnd);
      }
      visit(found);
    }
    while (index < structs.Count && structs[index].Id.Clock < clockEnd);
  }

  private static int FindIndexCleanStart(YTransaction? transaction, List<YStruct> structs, ulong clock)
  {
    var index = FindIndex(structs, clock);

    if (structs[index] is YItem item && item.Id.Clock < clock)
    {
      StructStore.Split(transaction, structs, index, item, (int)(clock - item.Id.Clock));

      return index + 1;
    }

    return index;
  }

  private static int FindIndex(List<YStruct> structs, ulong clock)
  {
    var left = 0;
    var right = structs.Count - 1;

    while (left <= right)
    {
      var middle = left + ((right - left) / 2);
      var current = structs[middle];

      if (clock < current.Id.Clock)
      {
        right = middle - 1;
      }
      else if (clock < current.Id.Clock + (ulong)current.Length)
      {
        return middle;
      }
      else
      {
        left = middle + 1;
      }
    }

    throw new InvalidOperationException($"yjs: no struct at clock {clock}.");
  }
}
