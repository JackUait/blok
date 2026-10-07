using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace Blok.Server.Yjs;

/// <summary>
/// JavaScript's JSON.stringify and JSON.parse over engine values (null, bool,
/// double, string, <see cref="AnyObject"/>, <see cref="AnyArray"/>). yjs writes
/// a format value and an embed as <c>JSON.stringify(value)</c>, so a peer
/// reads exactly these characters. Keys are NOT sorted: the caller owns the
/// order, and JS puts array-index keys first.
/// </summary>
internal static class JsJson
{
  public static string Stringify(object? value)
  {
    if (value is YUndefined)
    {
      throw new ArgumentException("yjs: JSON.stringify(undefined) writes nothing.", nameof(value));
    }

    var written = new StringBuilder();

    Write(value, written);

    return written.ToString();
  }

  /// <summary>
  /// JSON.parse: every number is a double, a repeated key keeps its first
  /// place and last value, and an escaped lone surrogate stays one (which
  /// System.Text.Json refuses to read, so values are read by hand once the
  /// text has been validated).
  /// </summary>
  public static object? Parse(string json)
  {
    ArgumentNullException.ThrowIfNull(json);

    // The hand reader below trusts its input to be well-formed JSON.
    JsonDocument.Parse(json, YContent.JsonLimits).Dispose();

    var position = 0;

    return ReadValue(json, ref position);
  }

  /// <summary>
  /// The order JS gives an object's own string keys: array indexes (canonical
  /// integers below 2^32 - 1) ascending, then the rest in insertion order.
  /// </summary>
  public static IEnumerable<KeyValuePair<string, TValue>> KeyOrder<TValue>(
      IEnumerable<KeyValuePair<string, TValue>> entries)
  {
    var indexes = new List<(uint Index, KeyValuePair<string, TValue> Entry)>();
    var rest = new List<KeyValuePair<string, TValue>>();

    foreach (var entry in entries)
    {
      if (IsArrayIndex(entry.Key, out var index))
      {
        indexes.Add((index, entry));
      }
      else
      {
        rest.Add(entry);
      }
    }

    return indexes.OrderBy(pair => pair.Index).Select(pair => pair.Entry).Concat(rest);
  }

  private static bool IsArrayIndex(string key, out uint index)
  {
    index = 0;

    return key.Length > 0 &&
        (key.Length == 1 || key[0] != '0') &&
        key.All(char.IsAsciiDigit) &&
        uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out index) &&
        index != uint.MaxValue;
  }

  private static void Write(object? value, StringBuilder written)
  {
    switch (value)
    {
      case null:
        written.Append("null");
        break;

      case bool flag:
        written.Append(flag ? "true" : "false");
        break;

      case double number:
        written.Append(FormatNumber(number));
        break;

      case string text:
        WriteString(text, written);
        break;

      case AnyObject members:
        written.Append('{');

        var first = true;

        foreach (var (key, member) in KeyOrder(members))
        {
          if (member is YUndefined)
          {
            continue;
          }

          if (!first)
          {
            written.Append(',');
          }

          first = false;
          WriteString(key, written);
          written.Append(':');
          Write(member, written);
        }

        written.Append('}');
        break;

      case AnyArray items:
        written.Append('[');

        for (var index = 0; index < items.Count; index++)
        {
          if (index > 0)
          {
            written.Append(',');
          }

          Write(items[index] is YUndefined ? null : items[index], written);
        }

        written.Append(']');
        break;

      // Uint8Array and BigInteger have no JSON form a peer reads back as the
      // same value (the first becomes an index object, the second throws).
      case byte[] or BigInteger:
      default:
        throw new ArgumentException(
            $"yjs: {value.GetType().Name} is not a value JSON can carry.", nameof(value));
    }
  }

  /// <summary>
  /// ECMAScript Number::toString on the shortest round-trip digits: plain
  /// notation for decimal exponents -7 &lt; n &lt;= 21, "1e+21" style otherwise.
  /// </summary>
  private static string FormatNumber(double number)
  {
    if (!double.IsFinite(number))
    {
      return "null";
    }

    if (number == 0)
    {
      return "0";
    }

    var shortest = Math.Abs(number).ToString("R", CultureInfo.InvariantCulture);
    var exponentAt = shortest.IndexOfAny(['E', 'e']);
    var mantissa = exponentAt < 0 ? shortest : shortest[..exponentAt];
    var exponent = exponentAt < 0
        ? 0
        : int.Parse(shortest[(exponentAt + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
    var point = mantissa.IndexOf('.', StringComparison.Ordinal);
    var digits = point < 0 ? mantissa : mantissa.Remove(point, 1);

    // n: where the decimal point sits relative to the first digit.
    var n = (point < 0 ? mantissa.Length : point) + exponent;
    var leading = digits.Length - digits.TrimStart('0').Length;

    digits = digits[leading..].TrimEnd('0');
    n -= leading;

    var k = digits.Length;
    var result = new StringBuilder(number < 0 ? "-" : string.Empty);

    if (k <= n && n <= 21)
    {
      result.Append(digits).Append('0', n - k);
    }
    else if (0 < n && n <= 21)
    {
      result.Append(digits, 0, n).Append('.').Append(digits, n, k - n);
    }
    else if (-6 < n && n <= 0)
    {
      result.Append("0.").Append('0', -n).Append(digits);
    }
    else
    {
      result.Append(digits[0]);

      if (k > 1)
      {
        result.Append('.').Append(digits, 1, k - 1);
      }

      result.Append('e').Append(n - 1 >= 0 ? "+" : "-").Append(Math.Abs(n - 1));
    }

    return result.ToString();
  }

  /// <summary>
  /// JSON.stringify's QuoteJSONString: the two structural characters, the
  /// five short control escapes, anything else below 0x20, and a lone
  /// surrogate. Everything else, non-ASCII included, is written as it is.
  /// </summary>
  private static void WriteString(string text, StringBuilder written)
  {
    written.Append('"');

    for (var index = 0; index < text.Length; index++)
    {
      var character = text[index];

      switch (character)
      {
        case '"':
          written.Append("\\\"");
          break;

        case '\\':
          written.Append("\\\\");
          break;

        case '\b':
          written.Append("\\b");
          break;

        case '\f':
          written.Append("\\f");
          break;

        case '\n':
          written.Append("\\n");
          break;

        case '\r':
          written.Append("\\r");
          break;

        case '\t':
          written.Append("\\t");
          break;

        default:
          var paired =
              (char.IsHighSurrogate(character) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1])) ||
              (char.IsLowSurrogate(character) && index > 0 && char.IsHighSurrogate(text[index - 1]));

          if (character < ' ' || (char.IsSurrogate(character) && !paired))
          {
            written.Append(CultureInfo.InvariantCulture, $"\\u{(int)character:x4}");
          }
          else
          {
            written.Append(character);
          }

          break;
      }
    }

    written.Append('"');
  }

  private static object? ReadValue(string json, ref int position)
  {
    SkipWhitespace(json, ref position);

    switch (json[position])
    {
      case '{':
        var members = new AnyObject();

        position++;
        SkipWhitespace(json, ref position);

        while (json[position] != '}')
        {
          SkipWhitespace(json, ref position);

          var key = ReadString(json, ref position);

          SkipWhitespace(json, ref position);
          position++;
          members.Add(key, ReadValue(json, ref position));
          SkipWhitespace(json, ref position);

          if (json[position] == ',')
          {
            position++;
          }
        }

        position++;

        return members;

      case '[':
        var items = new AnyArray();

        position++;
        SkipWhitespace(json, ref position);

        while (json[position] != ']')
        {
          items.Add(ReadValue(json, ref position));
          SkipWhitespace(json, ref position);

          if (json[position] == ',')
          {
            position++;
          }
        }

        position++;

        return items;

      case '"':
        return ReadString(json, ref position);

      case 't':
        position += 4;

        return true;

      case 'f':
        position += 5;

        return false;

      case 'n':
        position += 4;

        return null;

      default:
        var start = position;

        while (position < json.Length && "+-.0123456789eE".Contains(json[position], StringComparison.Ordinal))
        {
          position++;
        }

        // JS reads an out-of-range literal as ±Infinity, and so does double.Parse.
        return double.Parse(json.AsSpan(start, position - start), NumberStyles.Float, CultureInfo.InvariantCulture);
    }
  }

  private static string ReadString(string json, ref int position)
  {
    var text = new StringBuilder();

    position++;

    while (json[position] != '"')
    {
      var character = json[position++];

      if (character != '\\')
      {
        text.Append(character);

        continue;
      }

      var escape = json[position++];

      switch (escape)
      {
        case 'b':
          text.Append('\b');
          break;

        case 'f':
          text.Append('\f');
          break;

        case 'n':
          text.Append('\n');
          break;

        case 'r':
          text.Append('\r');
          break;

        case 't':
          text.Append('\t');
          break;

        case 'u':
          text.Append((char)int.Parse(json.AsSpan(position, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
          position += 4;
          break;

        default:
          text.Append(escape);
          break;
      }
    }

    position++;

    return text.ToString();
  }

  private static void SkipWhitespace(string json, ref int position)
  {
    while (position < json.Length && json[position] is ' ' or '\t' or '\n' or '\r')
    {
      position++;
    }
  }
}
