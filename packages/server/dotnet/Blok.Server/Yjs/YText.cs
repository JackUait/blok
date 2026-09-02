namespace Blok.Server.Yjs;

/// <summary>
/// A Y.Text with the minimal write API of Locked Decision 8: insert, delete
/// and the string. There is no formatting, no embed and no attribute
/// argument; a peer's <see cref="ContentFormat"/> and <see cref="ContentEmbed"/>
/// items are stored, walked over, and left out of <see cref="ToString"/>.
///
/// Cutting formatting out does NOT mean ignoring it. A position is found the
/// way yjs finds one — carrying the marks in force, forwarding past deleted
/// items and past marks the insert would restate — because that is what
/// decides which neighbours the new item names, and therefore its bytes.
/// What IS cut is yjs's insertAttributes / insertNegatedAttributes pair:
/// without an attribute argument, the attributes an insert carries ARE the
/// ones already in force, so both reduce to writing nothing.
/// </summary>
internal sealed class YText : YAbstractType
{
  /// <summary>JSON.stringify(null): the value a mark uses to switch itself off.</summary>
  private const string NullMark = "null";

  private string prelim;

  public YText()
  {
    prelim = string.Empty;
  }

  /// <summary>yjs's <c>new Y.Text(string)</c>: inserted at 0 when the type integrates.</summary>
  public YText(string text)
  {
    prelim = text ?? string.Empty;
  }

  public override string ToString()
  {
    return ConcatenateStrings(Start);
  }

  /// <summary>
  /// yjs's YText.insert with no attributes: one <see cref="ContentString"/>
  /// item, counted in UTF-16 code units.
  /// </summary>
  public void Insert(YTransaction transaction, int index, string chunk)
  {
    ArgumentNullException.ThrowIfNull(chunk);
    ArgumentNullException.ThrowIfNull(transaction);
    RequireAttached();

    if (chunk.Length == 0)
    {
      return;
    }

    var position = FindPosition(transaction, index);

    MinimizeAttributeChanges(position);
    NewItem(transaction, position.Left, position.Right, null, new ContentString(chunk))
        .Integrate(transaction, 0);
  }

  /// <summary>yjs's YText.delete: deleteText from the position at that index.</summary>
  public void Delete(YTransaction transaction, int index, int length)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentOutOfRangeException.ThrowIfNegative(length);
    RequireAttached();

    if (length == 0)
    {
      return;
    }

    DeleteText(transaction, FindPosition(transaction, index), length);
  }

  internal override void IntegratePrelim(YTransaction transaction)
  {
    var text = prelim;

    prelim = string.Empty;

    if (text.Length > 0)
    {
      Insert(transaction, 0, text);
    }
  }

  /// <summary>
  /// yjs's findPosition without the search marker: the marker is a cache, and
  /// the walk it short-circuits lands on the same item.
  /// </summary>
  private TextPosition FindPosition(YTransaction transaction, int index)
  {
    ArgumentOutOfRangeException.ThrowIfNegative(index);

    var position = new TextPosition { Right = Start };

    return FindNextPosition(transaction, position, index);
  }

  /// <summary>
  /// yjs's findNextPosition: forward <paramref name="count"/> countable ticks,
  /// splitting the item the count lands inside so the position is a boundary.
  /// A formatting mark costs no tick but does change the marks in force.
  /// </summary>
  private static TextPosition FindNextPosition(
      YTransaction transaction, TextPosition position, int count)
  {
    while (position.Right is { } right && count > 0)
    {
      if (right.Content is ContentFormat format)
      {
        if (!right.Deleted)
        {
          UpdateCurrentAttributes(position.CurrentAttributes, format);
        }
      }
      else if (!right.Deleted)
      {
        if (count < right.Length)
        {
          transaction.Doc.Store.GetItemCleanStart(
              transaction, new YId(right.Id.Client, right.Id.Clock + (ulong)count));
        }

        position.Index += right.Length;
        count -= right.Length;
      }

      position.Left = right;
      position.Right = right.Right;
    }

    return position;
  }

  /// <summary>
  /// yjs's minimizeAttributeChanges, with the attributes an insert carries
  /// being the ones already in force: forward past deleted items and past
  /// marks that would restate what is already true, so the new item goes
  /// after them rather than in front of them.
  /// </summary>
  private static void MinimizeAttributeChanges(TextPosition position)
  {
    // The snapshot matters: forwarding updates the live marks, and yjs
    // compares against the set captured before the walk.
    var attributes = new Dictionary<string, string>(
        position.CurrentAttributes, StringComparer.Ordinal);

    while (position.Right is { } right)
    {
      if (!right.Deleted &&
          !(right.Content is ContentFormat format && SameMark(attributes, format.Key, format.Json)))
      {
        break;
      }

      position.Forward();
    }
  }

  /// <summary>
  /// yjs's deleteText: delete content forward from the position, splitting
  /// where the count runs out, then clean up the marks the deletion stranded.
  /// </summary>
  private static void DeleteText(YTransaction transaction, TextPosition position, int length)
  {
    var startAttributes = new Dictionary<string, string>(
        position.CurrentAttributes, StringComparer.Ordinal);
    var start = position.Right;

    while (length > 0 && position.Right is { } right)
    {
      if (!right.Deleted && right.Content is ContentString or ContentEmbed or ContentType)
      {
        if (length < right.Length)
        {
          transaction.Doc.Store.GetItemCleanStart(
              transaction, new YId(right.Id.Client, right.Id.Clock + (ulong)length));
        }

        length -= right.Length;
        right.Delete(transaction);
      }

      position.Forward();
    }

    if (start is not null)
    {
      CleanupFormattingGap(
          transaction, start, position.Right, startAttributes, position.CurrentAttributes);
    }
  }

  /// <summary>
  /// yjs's cleanupFormattingGap. A deletion can leave a mark that is either
  /// overwritten by a later one in the same gap, or already true where it
  /// sits; both are deleted so the delta a peer reads has no dead marks.
  /// </summary>
  private static void CleanupFormattingGap(
      YTransaction transaction,
      YItem start,
      YItem? current,
      Dictionary<string, string> startAttributes,
      Dictionary<string, string> currentAttributes)
  {
    var endFormats = new Dictionary<string, ContentFormat>(StringComparer.Ordinal);
    YItem? end = start;

    while (end is not null && (!end.Countable || end.Deleted))
    {
      if (!end.Deleted && end.Content is ContentFormat format)
      {
        endFormats[format.Key] = format;
      }

      end = end.Right;
    }

    var reachedCurrent = false;

    for (YItem? walked = start; !ReferenceEquals(walked, end); walked = walked?.Right)
    {
      if (walked is null)
      {
        throw new InvalidOperationException("yjs: the text chain ended before its gap did.");
      }

      if (ReferenceEquals(current, walked))
      {
        reachedCurrent = true;
      }

      if (walked.Deleted || walked.Content is not ContentFormat mark)
      {
        continue;
      }

      var startedTrue = SameMark(startAttributes, mark.Key, mark.Json);

      if (!ReferenceEquals(endFormats.GetValueOrDefault(mark.Key), mark) || startedTrue)
      {
        walked.Delete(transaction);

        if (!reachedCurrent && !startedTrue && SameMark(currentAttributes, mark.Key, mark.Json))
        {
          Restore(currentAttributes, startAttributes, mark.Key);
        }
      }

      if (!reachedCurrent && !walked.Deleted)
      {
        UpdateCurrentAttributes(currentAttributes, mark);
      }
    }
  }

  private static void Restore(
      Dictionary<string, string> currentAttributes,
      Dictionary<string, string> startAttributes,
      string key)
  {
    if (startAttributes.TryGetValue(key, out var was))
    {
      currentAttributes[key] = was;
    }
    else
    {
      currentAttributes.Remove(key);
    }
  }

  /// <summary>
  /// yjs's updateCurrentAttributes: a mark whose value is null switches the
  /// attribute off, so an absent key and a null-valued one are the same thing.
  /// </summary>
  private static void UpdateCurrentAttributes(
      Dictionary<string, string> attributes, ContentFormat format)
  {
    if (string.Equals(format.Json, NullMark, StringComparison.Ordinal))
    {
      attributes.Remove(format.Key);
    }
    else
    {
      attributes[format.Key] = format.Json;
    }
  }

  /// <summary>
  /// Whether a mark states what <paramref name="attributes"/> already says.
  /// Values compare by their raw wire JSON; yjs compares the PARSED values
  /// with <c>===</c>, so two structurally equal OBJECT marks are unequal there
  /// and equal here. No Blok client writes an object-valued mark.
  /// </summary>
  private static bool SameMark(Dictionary<string, string> attributes, string key, string json)
  {
    return attributes.TryGetValue(key, out var current)
        ? string.Equals(current, json, StringComparison.Ordinal)
        : string.Equals(json, NullMark, StringComparison.Ordinal);
  }

  /// <summary>
  /// yjs's ItemTextListPosition: the gap between two items, the text index it
  /// sits at, and the formatting marks in force there.
  /// </summary>
  private sealed class TextPosition
  {
    public YItem? Left { get; set; }

    public YItem? Right { get; set; }

    public int Index { get; set; }

    public Dictionary<string, string> CurrentAttributes { get; } = new(StringComparer.Ordinal);

    /// <summary>Steps over the item on the right, which must exist.</summary>
    public void Forward()
    {
      var right = Right ??
          throw new InvalidOperationException("yjs: nothing to the right to step over.");

      if (right.Content is ContentFormat format)
      {
        if (!right.Deleted)
        {
          UpdateCurrentAttributes(CurrentAttributes, format);
        }
      }
      else if (!right.Deleted)
      {
        Index += right.Length;
      }

      Left = right;
      Right = right.Right;
    }
  }
}
