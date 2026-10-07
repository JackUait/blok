using System.Globalization;

namespace Blok.Server.Yjs;

/// <summary>One op of <see cref="YTextBase.ToDelta"/>: a run of characters, an embed or a nested type, and the marks on it.</summary>
/// <param name="Insert">
/// A string, an embed value, or a <see cref="YAbstractType"/>. Null for an
/// embed whose JSON is null, which no yjs API writes but the wire allows.
/// </param>
/// <param name="Attributes">Null when no mark is in force.</param>
internal sealed record YTextDelta(object? Insert, AnyObject? Attributes);

/// <summary>
/// The item-chain text logic Y.Text and Y.XmlText share: yjs's YText.js
/// insertText / formatText / deleteText and their helpers, ported line for
/// line because each decides which neighbours a new item names, and so its
/// bytes.
///
/// Attribute values are engine values (null, bool, double, string,
/// <see cref="AnyObject"/>, <see cref="AnyArray"/>); a null value in a format
/// call removes the mark. yjs's after-transaction format cleanup is NOT
/// ported: Blok clients run it and send the result.
/// </summary>
internal abstract class YTextBase : YAbstractType
{
  private List<Action<YTransaction>>? pending = [];

  /// <summary>yjs's <c>new Y.Text(string)</c>: inserted at 0 when the type integrates.</summary>
  private protected YTextBase(string? text)
  {
    if (text is not null)
    {
      pending!.Add(transaction => Insert(transaction, 0, text));
    }
  }

  public override string ToString()
  {
    return ConcatenateStrings(Start);
  }

  /// <summary>
  /// yjs's YText.insert. Null <paramref name="attributes"/> inherits the marks
  /// in force at the index; an object (even empty) sets exactly those marks.
  /// On a text that is not in a document yet, the write is queued and
  /// <paramref name="transaction"/> may be null.
  /// </summary>
  public void Insert(YTransaction? transaction, int index, string chunk, AnyObject? attributes = null)
  {
    ArgumentNullException.ThrowIfNull(chunk);
    ArgumentOutOfRangeException.ThrowIfNegative(index);

    if (chunk.Length == 0)
    {
      return;
    }

    var given = attributes is null ? null : Marks(attributes);

    if (Queue(transaction, attached => Insert(attached, index, chunk, attributes)) is not { } live)
    {
      return;
    }

    var position = FindPosition(live, index);
    var marks = given ??
        new OrderedDictionary<string, object?>(position.CurrentAttributes, StringComparer.Ordinal);

    InsertText(live, position, new ContentString(chunk), marks);
  }

  /// <summary>
  /// yjs's YText.insertEmbed: one countable item holding
  /// <c>JSON.stringify(embed)</c>. Null <paramref name="attributes"/> means no
  /// marks, NOT inherited ones.
  /// </summary>
  public void InsertEmbed(YTransaction? transaction, int index, object embed, AnyObject? attributes = null)
  {
    ArgumentNullException.ThrowIfNull(embed);

    ArgumentOutOfRangeException.ThrowIfNegative(index);

    if (embed is string or YAbstractType)
    {
      throw new ArgumentException("yjs: an embed is a JSON value other than a string.", nameof(embed));
    }

    var json = JsJson.Stringify(embed);
    var marks = attributes is null ? new(StringComparer.Ordinal) : Marks(attributes);

    if (Queue(transaction, attached => InsertEmbed(attached, index, embed, attributes)) is not { } live)
    {
      return;
    }

    InsertText(live, FindPosition(live, index), new ContentEmbed(json), marks);
  }

  /// <summary>yjs's YText.format: set (or, with a null value, remove) marks over a range.</summary>
  public void Format(YTransaction? transaction, int index, int length, AnyObject attributes)
  {
    ArgumentNullException.ThrowIfNull(attributes);
    ArgumentOutOfRangeException.ThrowIfNegative(index);

    if (length == 0)
    {
      return;
    }

    var marks = Marks(attributes);

    if (Queue(transaction, attached => Format(attached, index, length, attributes)) is not { } live)
    {
      return;
    }

    var position = FindPosition(live, index);

    if (position.Right is null)
    {
      return;
    }

    FormatText(live, position, length, marks);
  }

  /// <summary>yjs's YText.delete: deleteText from the position at that index.</summary>
  public void Delete(YTransaction? transaction, int index, int length)
  {
    ArgumentOutOfRangeException.ThrowIfNegative(index);
    ArgumentOutOfRangeException.ThrowIfNegative(length);

    if (length == 0)
    {
      return;
    }

    if (Queue(transaction, attached => Delete(attached, index, length)) is not { } live)
    {
      return;
    }

    DeleteText(live, FindPosition(live, index), length);
  }

  /// <summary>
  /// yjs's YText.toDelta with no snapshot: runs of characters with the marks
  /// in force, an op per embed. Every mark item ends a run, so equal
  /// neighbouring runs are possible; merging them is the caller's job.
  /// </summary>
  public IReadOnlyList<YTextDelta> ToDelta()
  {
    var delta = new List<YTextDelta>();
    var attributes = new OrderedDictionary<string, object?>(StringComparer.Ordinal);
    var run = new System.Text.StringBuilder();

    void PackRun()
    {
      if (run.Length > 0)
      {
        delta.Add(new YTextDelta(run.ToString(), Snapshot(attributes)));
        run.Clear();
      }
    }

    for (var item = Start; item is not null; item = item.Right)
    {
      if (item.Deleted)
      {
        continue;
      }

      switch (item.Content)
      {
        case ContentString characters:
          // yjs's snapshot branch: with no snapshot, a "ychange" mark is
          // dropped at the next string.
          if (attributes.ContainsKey("ychange"))
          {
            PackRun();
            attributes.Remove("ychange");
          }

          run.Append(characters.Text);
          break;

        case ContentEmbed embed:
          PackRun();
          delta.Add(new YTextDelta(JsJson.Parse(embed.Json), Snapshot(attributes)));
          break;

        case ContentType nested:
          PackRun();
          delta.Add(new YTextDelta(nested.Type, Snapshot(attributes)));
          break;

        case ContentFormat format:
          PackRun();
          UpdateCurrentAttributes(attributes, format);
          break;

        default:
          break;
      }
    }

    PackRun();

    return delta;
  }

  internal override void IntegratePrelim(YTransaction transaction)
  {
    var queued = pending;

    pending = null;

    foreach (var write in queued ?? [])
    {
      write(transaction);
    }
  }

  /// <summary>
  /// yjs's pending queue: a text with no document stashes the write and
  /// replays it at integration. Answers the transaction to write in, or null
  /// when the write was queued.
  /// </summary>
  private YTransaction? Queue(YTransaction? transaction, Action<YTransaction> write)
  {
    if (Doc is null)
    {
      (pending ?? throw new InvalidOperationException("yjs: this text was integrated without a document."))
          .Add(write);

      return null;
    }

    ArgumentNullException.ThrowIfNull(transaction);

    return transaction;
  }

  private static AnyObject? Snapshot(OrderedDictionary<string, object?> attributes)
  {
    if (attributes.Count == 0)
    {
      return null;
    }

    var snapshot = new AnyObject();

    foreach (var (key, value) in attributes)
    {
      snapshot.Add(key, value);
    }

    return snapshot;
  }

  /// <summary>A caller's attributes as the JS object yjs iterates: array-index keys first.</summary>
  private static OrderedDictionary<string, object?> Marks(AnyObject attributes)
  {
    var marks = new OrderedDictionary<string, object?>(StringComparer.Ordinal);

    foreach (var (key, value) in attributes)
    {
      if (value is YUndefined)
      {
        throw new ArgumentException($"yjs: the mark \"{key}\" is undefined; use null to remove it.", nameof(attributes));
      }

      marks[key] = value;
    }

    return marks;
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
  /// yjs's insertText: every mark in force that the insert does not name is
  /// switched off for it, then the marks go in front of the content and
  /// their negations after it.
  /// </summary>
  private void InsertText(
      YTransaction transaction,
      TextPosition position,
      YContent content,
      OrderedDictionary<string, object?> attributes)
  {
    foreach (var key in position.CurrentAttributes.Keys)
    {
      attributes.TryAdd(key, null);
    }

    MinimizeAttributeChanges(position, attributes);

    var negated = InsertAttributes(transaction, position, attributes);
    var item = NewItem(transaction, position.Left, position.Right, null, content);

    item.Integrate(transaction, 0);
    position.Right = item;
    position.Forward();
    InsertNegatedAttributes(transaction, position, negated);
  }

  /// <summary>
  /// yjs's formatText: write the marks, then walk the range deleting every
  /// mark it overrides and remembering what to restore at its end.
  /// </summary>
  private void FormatText(
      YTransaction transaction,
      TextPosition position,
      int length,
      OrderedDictionary<string, object?> attributes)
  {
    MinimizeAttributeChanges(position, attributes);

    var negated = InsertAttributes(transaction, position, attributes);

    while (position.Right is { } right &&
        (length > 0 || (negated.Count > 0 && (right.Deleted || right.Content is ContentFormat))))
    {
      if (!right.Deleted)
      {
        if (right.Content is ContentFormat format)
        {
          if (attributes.TryGetValue(format.Key, out var wanted))
          {
            if (EqualAttrs(wanted, format.Value))
            {
              negated.Remove(format.Key);
            }
            else
            {
              if (length == 0)
              {
                break;
              }

              negated[format.Key] = format.Value;
            }

            right.Delete(transaction);
          }
          else
          {
            position.CurrentAttributes[format.Key] = format.Value;
          }
        }
        else
        {
          if (length < right.Length)
          {
            transaction.Doc.Store.GetItemCleanStart(
                transaction, new YId(right.Id.Client, right.Id.Clock + (ulong)length));
          }

          length -= right.Length;
        }
      }

      position.Forward();
    }

    // yjs pads with newlines when the range runs past the end (a Quill rule).
    if (length > 0)
    {
      var newlines = NewItem(
          transaction, position.Left, position.Right, null, new ContentString(new string('\n', length)));

      newlines.Integrate(transaction, 0);
      position.Right = newlines;
      position.Forward();
    }

    InsertNegatedAttributes(transaction, position, negated);
  }

  /// <summary>
  /// yjs's minimizeAttributeChanges: forward past deleted items and past
  /// marks that already say what the insert wants, so the new item goes
  /// after them rather than in front of them.
  /// </summary>
  private static void MinimizeAttributeChanges(
      TextPosition position, OrderedDictionary<string, object?> attributes)
  {
    while (position.Right is { } right)
    {
      if (!right.Deleted &&
          !(right.Content is ContentFormat format &&
              EqualAttrs(attributes.GetValueOrDefault(format.Key), format.Value)))
      {
        break;
      }

      position.Forward();
    }
  }

  /// <summary>
  /// yjs's insertAttributes: one mark item per attribute that differs from
  /// the marks in force, in JS key order. Answers what was in force before,
  /// to restore after the content.
  /// </summary>
  private OrderedDictionary<string, object?> InsertAttributes(
      YTransaction transaction, TextPosition position, OrderedDictionary<string, object?> attributes)
  {
    var negated = new OrderedDictionary<string, object?>(StringComparer.Ordinal);

    foreach (var (key, value) in JsJson.KeyOrder(attributes))
    {
      var current = position.CurrentAttributes.GetValueOrDefault(key);

      if (!EqualAttrs(current, value))
      {
        negated[key] = current;
        WriteMark(transaction, position, key, value);
      }
    }

    return negated;
  }

  /// <summary>
  /// yjs's insertNegatedAttributes: skip marks that already restore what is
  /// needed, then write the rest in the order they were collected.
  /// </summary>
  private void InsertNegatedAttributes(
      YTransaction transaction, TextPosition position, OrderedDictionary<string, object?> negated)
  {
    // A key missing from the map is undefined in yjs, never equal to a mark.
    while (position.Right is { } right &&
        (right.Deleted ||
            (right.Content is ContentFormat format &&
                negated.TryGetValue(format.Key, out var wanted) &&
                EqualAttrs(wanted, format.Value))))
    {
      if (!right.Deleted)
      {
        negated.Remove(((ContentFormat)right.Content).Key);
      }

      position.Forward();
    }

    foreach (var (key, value) in negated)
    {
      WriteMark(transaction, position, key, value);
    }
  }

  private void WriteMark(YTransaction transaction, TextPosition position, string key, object? value)
  {
    var mark = NewItem(transaction, position.Left, position.Right, null, ContentFormat.Local(key, value));

    mark.Integrate(transaction, 0);
    position.Right = mark;
    position.Forward();
  }

  /// <summary>
  /// yjs's deleteText: delete content forward from the position, splitting
  /// where the count runs out, then clean up the marks the deletion stranded.
  /// </summary>
  private static void DeleteText(YTransaction transaction, TextPosition position, int length)
  {
    var startAttributes = new OrderedDictionary<string, object?>(
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
  /// yjs compares with <c>===</c> here, not equalAttrs.
  /// </summary>
  private static void CleanupFormattingGap(
      YTransaction transaction,
      YItem start,
      YItem? current,
      OrderedDictionary<string, object?> startAttributes,
      OrderedDictionary<string, object?> currentAttributes)
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

      var value = mark.Value;
      var startValue = startAttributes.GetValueOrDefault(mark.Key);
      var startedTrue = StrictEquals(startValue, value);

      if (!ReferenceEquals(endFormats.GetValueOrDefault(mark.Key), mark) || startedTrue)
      {
        walked.Delete(transaction);

        if (!reachedCurrent && !startedTrue &&
            StrictEquals(currentAttributes.GetValueOrDefault(mark.Key), value))
        {
          if (startValue is null)
          {
            currentAttributes.Remove(mark.Key);
          }
          else
          {
            currentAttributes[mark.Key] = startValue;
          }
        }
      }

      if (!reachedCurrent && !walked.Deleted)
      {
        UpdateCurrentAttributes(currentAttributes, mark);
      }
    }
  }

  /// <summary>
  /// yjs's updateCurrentAttributes: a mark whose value is null switches the
  /// attribute off, so an absent key and a null-valued one are the same thing.
  /// </summary>
  private static void UpdateCurrentAttributes(
      OrderedDictionary<string, object?> attributes, ContentFormat format)
  {
    if (format.Value is null)
    {
      attributes.Remove(format.Key);
    }
    else
    {
      attributes[format.Key] = format.Value;
    }
  }

  /// <summary>
  /// yjs's equalAttrs: <c>===</c>, or two objects with the same keys whose
  /// values are <c>===</c> (lib0 equalFlat). Key order does not matter, and a
  /// nested object only equals itself.
  /// </summary>
  private static bool EqualAttrs(object? left, object? right)
  {
    return StrictEquals(left, right) ||
        (Members(left) is { } leftMembers && Members(right) is { } rightMembers &&
            leftMembers.Count == rightMembers.Count &&
            leftMembers.All(entry => rightMembers.TryGetValue(entry.Key, out var other) &&
                StrictEquals(other, entry.Value)));
  }

  /// <summary>JS <c>===</c>: scalars by value (NaN unequal, -0 equal to 0), objects by identity.</summary>
  private static bool StrictEquals(object? left, object? right)
  {
    return (left, right) switch
    {
      (null, null) => true,
      (bool a, bool b) => a == b,
      (double a, double b) => a == b,
      (string a, string b) => string.Equals(a, b, StringComparison.Ordinal),
      _ => left is not null && ReferenceEquals(left, right),
    };
  }

  /// <summary>An object's or array's own keys, as JS enumerates them; null for a scalar.</summary>
  private static Dictionary<string, object?>? Members(object? value)
  {
    return value switch
    {
      AnyObject members => members.ToDictionary(StringComparer.Ordinal),
      AnyArray items => items
          .Select((item, index) => KeyValuePair.Create(index.ToString(CultureInfo.InvariantCulture), item))
          .ToDictionary(StringComparer.Ordinal),
      _ => null,
    };
  }

  /// <summary>
  /// yjs's ItemTextListPosition: the gap between two items, the text index it
  /// sits at, and the formatting marks in force there, in JS Map order.
  /// </summary>
  private sealed class TextPosition
  {
    public YItem? Left { get; set; }

    public YItem? Right { get; set; }

    public int Index { get; set; }

    public OrderedDictionary<string, object?> CurrentAttributes { get; } = new(StringComparer.Ordinal);

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
