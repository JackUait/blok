using System.Text;
using Blok.Server.Documents;

namespace Blok.Server.Runtime;

/*
 * Makes the text the bundle hands to Jint's JSON.parse read the way goja (the
 * Go server) reads it:
 *
 * - A repeated key keeps its first position and takes the last value. Jint
 *   4.17 keeps the FIRST value once the bundle is loaded: the bundle fills the
 *   shape tree of Object.prototype, JSON.parse then falls back to a property
 *   list that skips its duplicate check, and the object holds the key twice.
 * - A lone UTF-16 surrogate becomes U+FFFD. A high unit right before a low
 *   unit is a pair and stays as written.
 *
 * Text that needs neither comes back as the same instance. Text that is not
 * strict JSON comes back unchanged, so Jint still reports its own SyntaxError.
 * Numbers and literals are copied verbatim. Both passes use explicit stacks,
 * never recursion: a deep document must not overflow the native stack.
 *
 * It runs on the host, so it keeps the call's limits: `check` (cancellation
 * and the deadline) runs every few thousand steps, and a rewrite that would
 * outgrow the allocation budget is refused as DocumentTooLarge.
 */
internal static class JsonInputNormalizer
{
  // Past this many keys, an object's keys go into a set instead of a scan.
  private const int LinearKeyLimit = 16;

  // Jint's default JSON.parse depth (Options.Json.MaxParseDepth); the engines
  // keep the default. Deeper text is refused by Jint, so it is left alone.
  private const int MaxDepth = 64;

  private const int CheckEvery = 4096;

  // A rough upper bound per value, not a measurement: a tree node, its slot,
  // and an object member's index entry.
  private const long BytesPerValue = 128;

  private static readonly string[] Literals = ["true", "false", "null"];

  internal static string Normalize(string text, long allocationBudgetBytes, Action check)
  {
    if (!NeedsRewrite(text, check, out var values))
    {
      return text;
    }

    // The output and its builder, UTF-16, plus the tree.
    var estimate = (text.Length * 3L * sizeof(char)) + (values * BytesPerValue);

    if (estimate > allocationBudgetBytes)
    {
      throw new BlokDocumentConversionException(
          BlokConversionFailure.DocumentTooLarge,
          new InsufficientMemoryException(
              $"Rewriting this input would allocate about {estimate} bytes, over the {allocationBudgetBytes}-byte budget."));
    }

    return Rewrite(text, check);
  }

  private readonly record struct KeyRef(int Start, int Length, bool Plain);

  private sealed class ObjectFrame
  {
    internal readonly List<KeyRef> Keys = [];
    internal HashSet<string>? Set;
  }

  /*
   * Validates strict JSON and reports whether any object repeats a key or any
   * string holds a lone surrogate. Invalid JSON reports false.
   */
  private static bool NeedsRewrite(string text, Action check, out long values)
  {
    var frames = new Stack<ObjectFrame?>();
    var spare = new Stack<ObjectFrame>();
    var needed = false;
    var i = SkipSpace(text, 0);
    values = 0;

    while (true)
    {
      // A value starts at i.
      if (values++ % CheckEvery == 0)
      {
        check();
      }

      if (i >= text.Length)
      {
        return false;
      }

      var c = text[i];

      if (c == '{' || c == '[')
      {
        var isObject = c == '{';

        if (frames.Count == MaxDepth)
        {
          return false;
        }

        frames.Push(isObject ? Take(spare) : null);
        i = SkipSpace(text, i + 1);

        if (i < text.Length && text[i] == (isObject ? '}' : ']'))
        {
          Release(spare, frames.Pop());
          i++;
        }
        else if (isObject)
        {
          if (!ReadKey(text, ref i, frames.Peek()!, ref needed))
          {
            return false;
          }

          continue;
        }
        else
        {
          continue;
        }
      }
      else if (c == '"')
      {
        if (!ScanString(text, ref i, out var lone, out _))
        {
          return false;
        }

        needed |= lone;
      }
      else if (!ScanLiteralOrNumber(text, ref i))
      {
        return false;
      }

      // A value ended at i: close containers or move to the next member.
      while (true)
      {
        i = SkipSpace(text, i);

        if (frames.Count == 0)
        {
          return i == text.Length && needed;
        }

        if (i >= text.Length)
        {
          return false;
        }

        var frame = frames.Peek();
        c = text[i];

        if (c == ',')
        {
          i = SkipSpace(text, i + 1);

          if (frame is not null && !ReadKey(text, ref i, frame, ref needed))
          {
            return false;
          }

          break;
        }

        if (c != (frame is null ? ']' : '}'))
        {
          return false;
        }

        Release(spare, frames.Pop());
        i++;
      }
    }
  }

  // Frames are reused so the scan allocates per depth, not per object.
  private static ObjectFrame Take(Stack<ObjectFrame> spare) =>
      spare.Count > 0 ? spare.Pop() : new ObjectFrame();

  private static void Release(Stack<ObjectFrame> spare, ObjectFrame? frame)
  {
    if (frame is not null)
    {
      frame.Keys.Clear();
      frame.Set = null;
      spare.Push(frame);
    }
  }

  // Reads `"key" :` and leaves i at the value.
  private static bool ReadKey(string text, ref int i, ObjectFrame frame, ref bool needed)
  {
    if (i >= text.Length || text[i] != '"')
    {
      return false;
    }

    var start = i;

    if (!ScanString(text, ref i, out var lone, out var plain))
    {
      return false;
    }

    needed |= lone;

    var key = new KeyRef(start + 1, i - start - 2, plain);

    if (!needed)
    {
      needed = IsRepeat(text, frame, key);
    }

    i = SkipSpace(text, i);

    if (i >= text.Length || text[i] != ':')
    {
      return false;
    }

    i = SkipSpace(text, i + 1);

    return true;
  }

  private static bool IsRepeat(string text, ObjectFrame frame, KeyRef key)
  {
    if (frame.Set is not null)
    {
      return !frame.Set.Add(KeyName(text, key));
    }

    foreach (var seen in frame.Keys)
    {
      if (seen.Plain && key.Plain
          ? text.AsSpan(seen.Start, seen.Length).SequenceEqual(text.AsSpan(key.Start, key.Length))
          : KeyName(text, seen) == KeyName(text, key))
      {
        return true;
      }
    }

    frame.Keys.Add(key);

    if (frame.Keys.Count > LinearKeyLimit)
    {
      frame.Set = new HashSet<string>(StringComparer.Ordinal);

      foreach (var seen in frame.Keys)
      {
        frame.Set.Add(KeyName(text, seen));
      }
    }

    return false;
  }

  private static string KeyName(string text, KeyRef key)
  {
    return key.Plain ? text.Substring(key.Start, key.Length) : Decode(text, key.Start, key.Start + key.Length);
  }

  /*
   * Scans a string token from the opening quote; i ends past the closing one.
   * `plain` is false when the token holds an escape or a surrogate unit.
   */
  private static bool ScanString(string text, ref int i, out bool lone, out bool plain)
  {
    lone = false;
    plain = true;
    var highPending = false;
    i++;

    while (true)
    {
      if (i >= text.Length)
      {
        return false;
      }

      var c = text[i];
      int unit;

      if (c == '"')
      {
        lone |= highPending;
        i++;
        return true;
      }

      if (c < 0x20)
      {
        return false;
      }

      if (c == '\\')
      {
        plain = false;

        if (i + 1 >= text.Length)
        {
          return false;
        }

        var e = text[i + 1];

        if (e == 'u')
        {
          if (!TryHex(text, i + 2, out unit))
          {
            return false;
          }

          i += 6;
        }
        else if (e is '"' or '\\' or '/' or 'b' or 'f' or 'n' or 'r' or 't')
        {
          unit = e;
          i += 2;
        }
        else
        {
          return false;
        }
      }
      else
      {
        unit = c;
        i++;
      }

      if (char.IsHighSurrogate((char)unit))
      {
        plain = false;
        lone |= highPending;
        highPending = true;
      }
      else if (char.IsLowSurrogate((char)unit))
      {
        plain = false;
        lone |= !highPending;
        highPending = false;
      }
      else
      {
        lone |= highPending;
        highPending = false;
      }
    }
  }

  private static bool ScanLiteralOrNumber(string text, ref int i)
  {
    foreach (var literal in Literals)
    {
      if (text.AsSpan(i).StartsWith(literal, StringComparison.Ordinal))
      {
        i += literal.Length;
        return true;
      }
    }

    var start = i;

    if (i < text.Length && text[i] == '-')
    {
      i++;
    }

    if (i >= text.Length)
    {
      return false;
    }

    if (text[i] == '0')
    {
      i++;
    }
    else if (text[i] is >= '1' and <= '9')
    {
      i = SkipDigits(text, i);
    }
    else
    {
      return false;
    }

    if (i < text.Length && text[i] == '.')
    {
      var digits = i + 1;
      i = SkipDigits(text, digits);

      if (i == digits)
      {
        return false;
      }
    }

    if (i < text.Length && text[i] is 'e' or 'E')
    {
      i++;

      if (i < text.Length && text[i] is '+' or '-')
      {
        i++;
      }

      var digits = i;
      i = SkipDigits(text, digits);

      if (i == digits)
      {
        return false;
      }
    }

    return i > start;
  }

  private static int SkipDigits(string text, int i)
  {
    while (i < text.Length && text[i] is >= '0' and <= '9')
    {
      i++;
    }

    return i;
  }

  private static int SkipSpace(string text, int i)
  {
    while (i < text.Length && text[i] is ' ' or '\t' or '\n' or '\r')
    {
      i++;
    }

    return i;
  }

  private static bool TryHex(string text, int at, out int value)
  {
    value = 0;

    if (at + 4 > text.Length)
    {
      return false;
    }

    for (var k = 0; k < 4; k++)
    {
      var digit = HexValue(text[at + k]);

      if (digit < 0)
      {
        return false;
      }

      value = (value << 4) | digit;
    }

    return true;
  }

  private static int HexValue(char c)
  {
    return c switch
    {
      >= '0' and <= '9' => c - '0',
      >= 'a' and <= 'f' => c - 'a' + 10,
      >= 'A' and <= 'F' => c - 'A' + 10,
      _ => -1,
    };
  }

  /*
   * One UTF-16 unit of a string body at i (raw or escaped), with how many
   * source chars it spans. Only called on text the scan already validated.
   */
  private static int UnitAt(string text, int i, out int width)
  {
    if (text[i] != '\\')
    {
      width = 1;
      return text[i];
    }

    if (text[i + 1] == 'u')
    {
      width = 6;
      TryHex(text, i + 2, out var unit);
      return unit;
    }

    width = 2;

    return text[i + 1] switch
    {
      'b' => '\b',
      'f' => '\f',
      'n' => '\n',
      'r' => '\r',
      't' => '\t',
      var other => other,
    };
  }

  // A string body's value, lone surrogates read as U+FFFD.
  private static string Decode(string text, int start, int end)
  {
    var value = new StringBuilder(end - start);

    for (var i = start; i < end;)
    {
      var unit = UnitAt(text, i, out var width);

      if (char.IsHighSurrogate((char)unit) && i + width < end
          && char.IsLowSurrogate((char)UnitAt(text, i + width, out var next)))
      {
        value.Append((char)unit).Append((char)UnitAt(text, i + width, out _));
        i += width + next;
        continue;
      }

      value.Append(char.IsSurrogate((char)unit) ? '�' : (char)unit);
      i += width;
    }

    return value.ToString();
  }

  // A string body as written, each lone surrogate replaced with U+FFFD.
  private static void AppendString(StringBuilder output, string text, int start, int end)
  {
    output.Append('"');

    for (var i = start; i < end;)
    {
      var unit = UnitAt(text, i, out var width);

      if (char.IsHighSurrogate((char)unit) && i + width < end
          && char.IsLowSurrogate((char)UnitAt(text, i + width, out var next)))
      {
        output.Append(text, i, width + next);
        i += width + next;
        continue;
      }

      if (char.IsSurrogate((char)unit))
      {
        output.Append('�');
      }
      else
      {
        output.Append(text, i, width);
      }

      i += width;
    }

    output.Append('"');
  }

  private abstract class Node;

  // A string, number or literal: [Start, End) of the source token.
  private sealed class Scalar(int start, int end, bool isString) : Node
  {
    internal readonly int Start = start;
    internal readonly int End = end;
    internal readonly bool IsString = isString;
  }

  private sealed class ArrayNode : Node
  {
    internal readonly List<Node> Items = [];
  }

  private sealed class ObjectNode : Node
  {
    internal readonly List<(int KeyStart, int KeyEnd, Node Value)> Members = [];
    internal readonly Dictionary<string, int> Index = new(StringComparer.Ordinal);
    internal int PendingKeyStart;
    internal int PendingKeyEnd;

    // A repeated key keeps its first slot and takes the new value.
    internal void Add(string text, Node value)
    {
      var name = Decode(text, PendingKeyStart, PendingKeyEnd);

      if (Index.TryGetValue(name, out var slot))
      {
        Members[slot] = (Members[slot].KeyStart, Members[slot].KeyEnd, value);
        return;
      }

      Index[name] = Members.Count;
      Members.Add((PendingKeyStart, PendingKeyEnd, value));
    }
  }

  // Only called on text NeedsRewrite validated.
  private static string Rewrite(string text, Action check)
  {
    var containers = new Stack<Node>();
    Node? root = null;
    var i = SkipSpace(text, 0);
    var steps = 0L;

    while (true)
    {
      if (steps++ % CheckEvery == 0)
      {
        check();
      }

      Node value;
      var c = text[i];

      if (c == '{' || c == '[')
      {
        Node container = c == '{' ? new ObjectNode() : new ArrayNode();
        i = SkipSpace(text, i + 1);

        if (text[i] == (c == '{' ? '}' : ']'))
        {
          i++;
          value = container;
        }
        else
        {
          containers.Push(container);

          if (container is ObjectNode opened)
          {
            i = ReadPendingKey(text, i, opened);
          }

          continue;
        }
      }
      else
      {
        var start = i;

        if (c == '"')
        {
          ScanString(text, ref i, out _, out _);
        }
        else
        {
          ScanLiteralOrNumber(text, ref i);
        }

        value = new Scalar(start, i, c == '"');
      }

      while (true)
      {
        if (containers.Count == 0)
        {
          root = value;
          break;
        }

        var parent = containers.Peek();

        if (parent is ObjectNode members)
        {
          members.Add(text, value);
        }
        else
        {
          ((ArrayNode)parent).Items.Add(value);
        }

        i = SkipSpace(text, i);

        if (text[i] == ',')
        {
          i = SkipSpace(text, i + 1);

          if (parent is ObjectNode next)
          {
            i = ReadPendingKey(text, i, next);
          }

          break;
        }

        i++;
        value = containers.Pop();
      }

      if (root is not null)
      {
        return Emit(text, root, check);
      }
    }
  }

  private static int ReadPendingKey(string text, int i, ObjectNode node)
  {
    var start = i;
    ScanString(text, ref i, out _, out _);
    node.PendingKeyStart = start + 1;
    node.PendingKeyEnd = i - 1;
    i = SkipSpace(text, i);

    return SkipSpace(text, i + 1);
  }

  private static string Emit(string text, Node root, Action check)
  {
    var output = new StringBuilder(text.Length);
    var stack = new Stack<(Node Node, int Next)>();
    var steps = 0L;
    stack.Push((root, -1));

    while (stack.Count > 0)
    {
      if (++steps % CheckEvery == 0)
      {
        check();
      }

      var (node, next) = stack.Pop();

      switch (node)
      {
        case Scalar scalar when scalar.IsString:
          AppendString(output, text, scalar.Start + 1, scalar.End - 1);
          break;
        case Scalar scalar:
          output.Append(text, scalar.Start, scalar.End - scalar.Start);
          break;
        case ArrayNode array:
          if (next == -1)
          {
            output.Append('[');
            next = 0;
          }

          if (next == array.Items.Count)
          {
            output.Append(']');
            break;
          }

          if (next > 0)
          {
            output.Append(',');
          }

          stack.Push((array, next + 1));
          stack.Push((array.Items[next], -1));
          break;
        case ObjectNode obj:
          if (next == -1)
          {
            output.Append('{');
            next = 0;
          }

          if (next == obj.Members.Count)
          {
            output.Append('}');
            break;
          }

          if (next > 0)
          {
            output.Append(',');
          }

          var member = obj.Members[next];
          AppendString(output, text, member.KeyStart, member.KeyEnd);
          output.Append(':');
          stack.Push((obj, next + 1));
          stack.Push((member.Value, -1));
          break;
      }
    }

    return output.ToString();
  }
}
