namespace Blok.Server.Yjs;

internal enum DecodedStructKind
{
  Item,
  Gc,
  Skip,
}

/// <summary>
/// One struct as the wire spelled it, before anything is integrated.
///
/// <paramref name="Info"/> is the raw info byte, kept because it is not
/// recomputable: yjs sets the parentSub bit whenever its item has a
/// parentSub, including when an origin bit suppresses the parent and
/// parentSub bytes, so an item can arrive flagged with a parentSub it does
/// not carry. Rebuilding the byte from the parsed fields loses that bit and a
/// decode then re-encode stops being byte-identical.
/// </summary>
internal sealed record DecodedStruct(
    YId Id,
    int Length,
    DecodedStructKind Kind,
    YId? Origin,
    YId? RightOrigin,
    string? ParentRoot,
    YId? ParentId,
    string? ParentSub,
    YContent? Content,
    byte Info);

/// <summary>
/// A v1 update, fully parsed and not yet applied to anything: the room can
/// look at it, refuse it, and hand the same object to the document.
/// </summary>
internal sealed class DecodedUpdate
{
  private readonly Dictionary<ulong, IReadOnlyList<DecodedStruct>> structs;

  internal DecodedUpdate(
      Dictionary<ulong, IReadOnlyList<DecodedStruct>> structs,
      DeleteSet deleteSet)
  {
    this.structs = structs;
    DeleteSet = deleteSet;
    MaxNestingDepth = MeasureNesting(structs);
  }

  /// <summary>
  /// Per client, the client's structs in ascending clock order. Nothing is
  /// ever removed from the dictionary, which is what keeps its enumeration in
  /// the update's own order of client groups.
  /// </summary>
  public IReadOnlyDictionary<ulong, IReadOnlyList<DecodedStruct>> Structs => structs;

  public DeleteSet DeleteSet { get; }

  /// <summary>Deepest plain-value nesting anywhere in the update; a scalar is 0.</summary>
  public int MaxNestingDepth { get; }

  /// <summary>
  /// Whether a NUL appears in any string the update carries — root names,
  /// parentSubs, text, format keys, raw JSON and every Any leaf and object
  /// key. The engine treats NUL as ordinary data; callers that cannot ask
  /// here rather than being surprised downstream.
  /// </summary>
  public bool ContainsNul()
  {
    foreach (var client in structs)
    {
      foreach (var decoded in client.Value)
      {
        if (HasNul(decoded.ParentRoot) ||
            HasNul(decoded.ParentSub) ||
            (decoded.Content is { } content && ContentHasNul(content)))
        {
          return true;
        }
      }
    }

    return false;
  }

  private static bool ContentHasNul(YContent content)
  {
    return content switch
    {
      ContentString text => HasNul(text.Text),
      ContentFormat format => HasNul(format.Key) || HasNul(format.Json),
      ContentEmbed embed => HasNul(embed.Json),
      ContentJson json => json.Values.Any(HasNul),
      ContentType type => HasNul(type.Name),
      ContentDoc doc => HasNul(doc.Guid) || AnyHasNul(doc.Options),
      ContentAny any => any.Values.Any(AnyHasNul),
      _ => false,
    };
  }

  private static bool HasNul(string? value)
  {
    return value?.Contains('\0', StringComparison.Ordinal) == true;
  }

  /// <summary>Walks with an explicit stack: an Any may nest thousands deep.</summary>
  private static bool AnyHasNul(object? value)
  {
    var pending = new Stack<object?>();

    pending.Push(value);

    while (pending.Count > 0)
    {
      switch (pending.Pop())
      {
        case string text when HasNul(text):
          return true;

        case AnyObject members:
          foreach (var pair in members)
          {
            if (HasNul(pair.Key))
            {
              return true;
            }

            pending.Push(pair.Value);
          }

          break;

        case AnyArray items:
          foreach (var item in items)
          {
            pending.Push(item);
          }

          break;

        default:
          break;
      }
    }

    return false;
  }

  private static int MeasureNesting(
      Dictionary<ulong, IReadOnlyList<DecodedStruct>> structs)
  {
    var deepest = 0;

    foreach (var client in structs)
    {
      foreach (var decoded in client.Value)
      {
        switch (decoded.Content)
        {
          case ContentAny any:
            foreach (var value in any.Values)
            {
              deepest = Math.Max(deepest, AnyDepth(value));
            }

            break;

          case ContentDoc doc:
            deepest = Math.Max(deepest, AnyDepth(doc.Options));
            break;

          default:
            break;
        }
      }
    }

    return deepest;
  }

  private static int AnyDepth(object? value)
  {
    var deepest = 0;
    var pending = new Stack<(object? Value, int Depth)>();

    pending.Push((value, 0));

    while (pending.Count > 0)
    {
      var (current, depth) = pending.Pop();

      switch (current)
      {
        case AnyObject members:
          deepest = Math.Max(deepest, depth + 1);

          foreach (var pair in members)
          {
            pending.Push((pair.Value, depth + 1));
          }

          break;

        case AnyArray items:
          deepest = Math.Max(deepest, depth + 1);

          foreach (var item in items)
          {
            pending.Push((item, depth + 1));
          }

          break;

        default:
          break;
      }
    }

    return deepest;
  }
}
