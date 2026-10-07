using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>
/// Segment rich text over engine values (<see cref="AnyObject"/>,
/// <see cref="AnyArray"/>, string, bool, double, null).
///
/// LOCKSTEP: a port of the client's <c>isRichText</c> /
/// <c>readRichTextLeniently</c> (src/shared/rich-text/guards.ts),
/// <c>canonicalizeSegments</c> (html-to-segments.ts) and
/// <c>deltaToSegments</c> / <c>normalizeMarkValue</c> (delta.ts). The canonical
/// spelling is compared character for character (export, echo check, edit
/// no-op), so it is pinned against the TS functions by
/// test/unit/server-conformance/fixtures/rich-text-canonical/.
/// </summary>
internal static partial class RichText
{
  /// <summary>MARK_ORDER in html-to-segments.ts. The order is the canonical key order.</summary>
  private static readonly string[] MarkOrder =
  [
      "link", "color", "background", "highlight", "bold", "italic", "underline",
      "strikethrough", "code", "sup", "sub",
  ];

  private static readonly HashSet<string> BooleanMarks = new(StringComparer.Ordinal)
  {
    "highlight", "bold", "italic", "underline", "strikethrough", "code", "sup", "sub",
  };

  /// <summary>
  /// One segment as the client writes it to Yjs: the insert (a string or an
  /// embed object) and its normalised attributes, never null.
  /// </summary>
  internal readonly record struct WriteOp(object Insert, AnyObject Attributes)
  {
    internal int Length => Insert is string text ? text.Length : 1;
  }

  // segments-to-html.ts writes only these tag names; ASCII only, like JS /i.
  [GeneratedRegex("^[a-zA-Z][a-zA-Z0-9-]*\\z", RegexOptions.CultureInvariant)]
  private static partial Regex SafeTagName();

  /// <summary><c>isRichText</c>: every item is one segment shape. <c>[]</c> counts.</summary>
  internal static bool IsRichText(AnyArray value)
  {
    return value.All(IsSegment);
  }

  /// <summary>
  /// A rich field's array as input: the guards, then the mark keys the
  /// client's input layer cannot render dropped (a segment → HTML → segment
  /// round trip on the client loses them), then the canonical spelling.
  /// </summary>
  internal static AnyArray ReadInput(AnyArray value)
  {
    var segments = IsRichText(value) ? value : ReadLeniently(value);

    return Canonicalize(segments.Select(DropUnknownMarks));
  }

  /// <summary><c>canonicalizeSegments</c>. Never changes what it reads.</summary>
  internal static AnyArray Canonicalize(IEnumerable<object?> segments)
  {
    var result = new List<AnyObject>();

    foreach (var item in segments)
    {
      if (item is not AnyObject raw)
      {
        continue;
      }

      // Only the content survives: the text, else a valid embed. Neither
      // means a peer or host wrote junk, and the item is dropped.
      var segment = new AnyObject();

      if (TextOf(raw) is { } content)
      {
        segment.Add("text", content);
      }
      else if (raw.TryGet("embed", out var embed) && IsEmbed(embed))
      {
        segment.Add("embed", embed);
      }
      else
      {
        continue;
      }

      raw.TryGet("marks", out var marks);

      if (OrderMarks(marks as AnyObject ?? new AnyObject()) is { } ordered)
      {
        segment.Add("marks", ordered);
      }

      var text = TextOf(segment);

      if (text == "")
      {
        continue;
      }

      if (text is not null &&
          result.Count > 0 &&
          TextOf(result[^1]) is { } previousText &&
          SameMarks(result[^1], segment))
      {
        var merged = new AnyObject();

        foreach (var (key, value) in result[^1])
        {
          merged.Add(key, value);
        }

        merged.Add("text", previousText + text);
        result[^1] = merged;

        continue;
      }

      result.Add(segment);
    }

    var array = new AnyArray();

    foreach (var segment in result)
    {
      array.Add(segment);
    }

    return array;
  }

  /// <summary>
  /// <c>deltaToSegments</c>: a string insert is text, an insert of one of the
  /// three embed shapes an embed, anything else (a nested type, an array, a
  /// scalar, a malformed embed) is skipped.
  /// </summary>
  internal static AnyArray FromDelta(IReadOnlyList<YTextDelta> delta)
  {
    var segments = new List<object?>();

    foreach (var op in delta)
    {
      var segment = new AnyObject();

      if (op.Insert is string text)
      {
        segment.Add("text", text);
      }
      else if (op.Insert is AnyObject embed && IsEmbed(embed))
      {
        segment.Add("embed", embed);
      }
      else
      {
        continue;
      }

      if (op.Attributes is { Count: > 0 } attributes)
      {
        segment.Add("marks", attributes);
      }

      segments.Add(segment);
    }

    return Canonicalize(segments);
  }

  /// <summary>
  /// Canonical segments → the inserts that build them, as
  /// <c>segmentsToDeltaOps</c> does: every op carries an explicit attributes
  /// object, empty when unmarked, so no run inherits the marks before it.
  /// </summary>
  internal static IReadOnlyList<WriteOp> ToWriteOps(AnyArray canonical)
  {
    var ops = new List<WriteOp>();

    foreach (var item in canonical)
    {
      var segment = (AnyObject)item!;

      segment.TryGet("marks", out var marks);

      object insert = TextOf(segment) is { } text
          ? text
          : segment.TryGet("embed", out var embed) ? embed! : throw new InvalidDataException(
              "collab: a rich text segment has neither text nor embed.");

      ops.Add(new WriteOp(insert, Normalize(marks)));
    }

    return ops;
  }

  /// <summary>
  /// <c>normalizeMarkValue</c> for a whole marks object: keys sorted at every
  /// depth, NUL removed from keys and strings. Absent or not an object gives
  /// an empty object. Always a new object.
  /// </summary>
  internal static AnyObject Normalize(object? marks)
  {
    return marks is AnyObject record ? (AnyObject)NormalizeValue(record)! : new AnyObject();
  }

  /// <summary><c>normalizeMarkValue</c> for one value.</summary>
  internal static object? NormalizeValue(object? value)
  {
    switch (value)
    {
      case string text:
        return text.Replace("\0", "", StringComparison.Ordinal);

      case AnyArray items:
        var array = new AnyArray();

        foreach (var item in items)
        {
          array.Add(NormalizeValue(item));
        }

        return array;

      case AnyObject record:
        var normalized = new AnyObject();

        foreach (var (key, child) in record
            .Where(entry => entry.Value is not YUndefined)
            .Select(entry => (Key: entry.Key.Replace("\0", "", StringComparison.Ordinal), entry.Value))
            .OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
          normalized.Add(key, NormalizeValue(child));
        }

        return normalized;

      default:
        return value;
    }
  }

  /// <summary>Canonical marks of one run, or null when it carries none.</summary>
  internal static AnyObject? CanonicalMarks(object? marks)
  {
    return OrderMarks(marks as AnyObject ?? new AnyObject());
  }

  /// <summary>
  /// Structural equality of two mark values, key order ignored at every depth.
  /// Wider than <c>sameMarks</c> (which keeps array members as written): the
  /// edit path asks "does this run need a format call", and a respelling
  /// must not make one.
  /// </summary>
  internal static bool SameValue(object? left, object? right)
  {
    return JsJson.Stringify(SortDeep(left, intoArrays: true)) ==
        JsJson.Stringify(SortDeep(right, intoArrays: true));
  }

  /// <summary>Segments as JSON nodes, keys in the order JS would write them.</summary>
  internal static JsonArray ToJson(AnyArray segments)
  {
    return (JsonArray)ToJsonNode(segments)!;
  }

  /// <summary>An engine value as a JSON node, keys in JS order.</summary>
  internal static JsonNode? ToJsonNode(object? value)
  {
    switch (value)
    {
      case null:
        return null;

      case string text:
        return JsonValue.Create(text);

      case bool flag:
        return JsonValue.Create(flag);

      case double number:
        if (!double.IsFinite(number))
        {
          return null;
        }

        return double.IsInteger(number) && Math.Abs(number) <= 9007199254740992d
          ? JsonValue.Create((long)number)
          : JsonValue.Create(number);

      case AnyArray items:
        var array = new JsonArray();

        foreach (var item in items)
        {
          array.Add(ToJsonNode(item));
        }

        return array;

      case AnyObject record:
        var result = new JsonObject();

        foreach (var (key, child) in JsJson.KeyOrder(record))
        {
          if (child is not YUndefined)
          {
            result[key] = ToJsonNode(child);
          }
        }

        return result;

      default:
        throw new InvalidDataException(
            $"collab: unsupported value {value.GetType().Name} in rich text.");
    }
  }

  private static string? TextOf(AnyObject segment)
  {
    return segment.TryGet("text", out var text) ? text as string : null;
  }

  private static bool IsSegment(object? item)
  {
    if (item is not AnyObject record)
    {
      return false;
    }

    var hasText = record.TryGet("text", out var text);
    var hasEmbed = record.TryGet("embed", out var embed);

    // Both keys is ambiguous, and marks present must be a record.
    if ((hasText && hasEmbed) || (record.TryGet("marks", out var marks) && marks is not AnyObject))
    {
      return false;
    }

    return (text is string && HasOnlyKeys(record, "text")) ||
        (IsEmbed(embed) && HasOnlyKeys(record, "embed"));
  }

  /// <summary>
  /// Exactly one of <c>{equation:{expression:string}}</c>,
  /// <c>{page:{id:string}}</c> or <c>{html:string}</c>, no other key at
  /// either level. The client's HTML writer reads these unchecked, so any
  /// other shape would make it throw for the whole document.
  /// </summary>
  private static bool IsEmbed(object? value)
  {
    if (value is not AnyObject embed)
    {
      return false;
    }

    var present = embed.Where(entry => entry.Value is not YUndefined).ToList();

    if (present.Count != 1)
    {
      return false;
    }

    var (key, inner) = present[0];

    return key switch
    {
      "html" => inner is string,
      "equation" => HasOneString(inner, "expression"),
      "page" => HasOneString(inner, "id"),
      _ => false,
    };
  }

  private static bool HasOneString(object? value, string key)
  {
    return value is AnyObject record &&
        record.Where(entry => entry.Value is not YUndefined).ToList() is [{ } only] &&
        only.Key == key &&
        only.Value is string;
  }

  private static bool HasOnlyKeys(AnyObject record, string shapeKey)
  {
    return record.All(entry =>
        entry.Key == shapeKey || entry.Key == "marks" || entry.Value is YUndefined);
  }

  /// <summary><c>readRichTextLeniently</c>.</summary>
  private static AnyArray ReadLeniently(AnyArray value)
  {
    var segments = new AnyArray();

    foreach (var item in value)
    {
      if (item is not AnyObject record)
      {
        continue;
      }

      var segment = new AnyObject();

      if (record.TryGet("text", out var text) && text is string)
      {
        segment.Add("text", text);
      }
      else if (record.TryGet("embed", out var embed) && IsEmbed(embed))
      {
        segment.Add("embed", embed);
      }
      else
      {
        continue;
      }

      if (record.TryGet("marks", out var marks) && marks is AnyObject)
      {
        segment.Add("marks", marks);
      }

      segments.Add(segment);
    }

    return segments;
  }

  private static object? DropUnknownMarks(object? item)
  {
    if (item is not AnyObject segment ||
        !segment.TryGet("marks", out var marks) ||
        marks is not AnyObject record)
    {
      return item;
    }

    var kept = new AnyObject();

    foreach (var (key, value) in record)
    {
      if (key.StartsWith("tag:", StringComparison.Ordinal)
          ? SafeTagName().IsMatch(key["tag:".Length..])
          : Array.IndexOf(MarkOrder, key) >= 0)
      {
        kept.Add(key, value);
      }
    }

    var result = new AnyObject();

    foreach (var (key, value) in segment)
    {
      result.Add(key, key == "marks" ? kept : value);
    }

    return result;
  }

  /// <summary><c>orderMarks</c>: MARK_ORDER first, then the other keys sorted.</summary>
  private static AnyObject? OrderMarks(AnyObject record)
  {
    var unknownKeys = record
        .Select(entry => entry.Key)
        .Where(key => Array.IndexOf(MarkOrder, key) < 0)
        .Order(StringComparer.Ordinal);
    var ordered = new AnyObject();

    foreach (var key in MarkOrder.Concat(unknownKeys))
    {
      if (record.TryGet(key, out var raw) && MarkValue(key, raw, out var value))
      {
        ordered.Add(key, value);
      }
    }

    return ordered.Count == 0 ? null : ordered;
  }

  /// <summary><c>markValue</c>; false means the mark is absent.</summary>
  private static bool MarkValue(string key, object? raw, out object? value)
  {
    value = null;

    if (raw is YUndefined)
    {
      return false;
    }

    if (key == "link")
    {
      if (raw is not AnyObject link || !link.TryGet("href", out var href) || href is not string)
      {
        return false;
      }

      var canonical = new AnyObject();

      canonical.Add("href", href);

      if (link.TryGet("target", out var target) && target is string)
      {
        canonical.Add("target", target);
      }

      if (link.TryGet("rel", out var rel) && rel is string)
      {
        canonical.Add("rel", rel);
      }

      value = canonical;

      return true;
    }

    if (BooleanMarks.Contains(key))
    {
      value = true;

      return raw is true;
    }

    if (raw is null)
    {
      return false;
    }

    // The client's HTML writer escapes these with string calls, so any other
    // value would make it throw for the whole document.
    if (key is "color" or "background")
    {
      value = raw;

      return raw is string;
    }

    if (key.StartsWith("tag:", StringComparison.Ordinal))
    {
      if (raw is not AnyObject attributes)
      {
        return false;
      }

      var sorted = new AnyObject();

      foreach (var (name, attribute) in attributes
          .Where(entry => entry.Value is string)
          .OrderBy(entry => entry.Key, StringComparer.Ordinal))
      {
        sorted.Add(name, attribute);
      }

      value = sorted;

      return true;
    }

    value = raw;

    return true;
  }

  /// <summary>
  /// <c>sameMarks</c>: <c>sortKeys</c> sorts objects but leaves array
  /// members as written, so it does the same here.
  /// </summary>
  private static bool SameMarks(AnyObject left, AnyObject right)
  {
    left.TryGet("marks", out var leftMarks);
    right.TryGet("marks", out var rightMarks);

    return JsJson.Stringify(SortDeep(leftMarks ?? new AnyObject(), intoArrays: false)) ==
        JsJson.Stringify(SortDeep(rightMarks ?? new AnyObject(), intoArrays: false));
  }

  private static object? SortDeep(object? value, bool intoArrays)
  {
    switch (value)
    {
      case AnyObject record:
        var sorted = new AnyObject();

        foreach (var (key, child) in record.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
          sorted.Add(key, SortDeep(child, intoArrays));
        }

        return sorted;

      case AnyArray items when intoArrays:
        var array = new AnyArray();

        foreach (var item in items)
        {
          array.Add(SortDeep(item, intoArrays));
        }

        return array;

      default:
        return value;
    }
  }
}
