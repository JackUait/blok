using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json.Nodes;

namespace Blok.Server.Yjs;

/// <summary>
/// The C# twin of scripts/yjs-engine-render.mjs, and the only oracle a
/// document is compared against.
///
/// A plain <c>toJSON</c> cannot be that oracle: a root created by integration
/// is untyped and serialises to nothing, JSON has no bigint and erases
/// NaN/-0/Infinity/undefined, and a text's embeds and formats vanish. So the
/// roots are materialised by the kind the fixture names, and the values JSON
/// cannot hold are written as the same sentinels the Node renderer writes.
/// </summary>
internal static class JsonRenderer
{
  public static JsonNode Render(YDoc doc, IReadOnlyDictionary<string, string> roots)
  {
    ArgumentNullException.ThrowIfNull(doc);
    ArgumentNullException.ThrowIfNull(roots);

    var rendered = new JsonObject();

    foreach (var (name, kind) in roots)
    {
      YAbstractType root = kind switch
      {
        "map" => doc.GetMap(name),
        "array" => doc.GetArray(name),
        "text" => doc.GetText(name),
        _ => throw new InvalidOperationException($"yjs: \"{kind}\" is not a root kind."),
      };

      rendered[name] = RenderValue(root);
    }

    return rendered;
  }

  private static JsonNode? RenderValue(object? value)
  {
    switch (value)
    {
      case null:
        return null;

      case YUndefined:
        return new JsonObject { ["$undefined"] = true };

      case bool flag:
        return JsonValue.Create(flag);

      case string text:
        return JsonValue.Create(text);

      case double number:
        return RenderNumber(number);

      case BigInteger big:
        return new JsonObject { ["$bigint"] = big.ToString(CultureInfo.InvariantCulture) };

      case byte[] bytes:
        return new JsonObject { ["$u8"] = Convert.ToBase64String(bytes) };

      case YText text:
        return new JsonObject { ["$text"] = RenderDelta(text) };

      case YXmlText or YXmlElement or YXmlFragment or YXmlHook:
        return new JsonObject { ["$xml"] = RenderXml((YAbstractType)value) };

      case YMap map:
        return RenderMap(map);

      case YArray list:
        return RenderArray(list);

      case AnyObject members:
        return RenderAnyObject(members);

      case AnyArray items:
        return RenderAnyArray(items);

      case JsonNode node:
        // Content that kept the wire's raw JSON; already in the shape the
        // Node renderer produces for a plain value.
        return node.DeepClone();

      default:
        throw new InvalidOperationException(
            $"yjs: {value.GetType().Name} has no JSON rendering.");
    }
  }

  private static JsonNode RenderNumber(double number)
  {
    if (double.IsNaN(number))
    {
      return new JsonObject { ["$num"] = "NaN" };
    }

    if (number == 0 && double.IsNegative(number))
    {
      return new JsonObject { ["$num"] = "-0" };
    }

    if (double.IsPositiveInfinity(number))
    {
      return new JsonObject { ["$num"] = "Infinity" };
    }

    return double.IsNegativeInfinity(number)
        ? new JsonObject { ["$num"] = "-Infinity" }
        : JsonValue.Create(number);
  }

  private static JsonObject RenderMap(YMap map)
  {
    var rendered = new JsonObject();

    foreach (var key in map.Keys)
    {
      map.TryGet(key, out var value);
      rendered[key] = RenderValue(value);
    }

    return rendered;
  }

  private static JsonArray RenderArray(YArray list)
  {
    var rendered = new JsonArray();

    foreach (var value in list.Enumerate())
    {
      rendered.Add(RenderValue(value));
    }

    return rendered;
  }

  private static JsonObject RenderAnyObject(AnyObject members)
  {
    var rendered = new JsonObject();

    foreach (var (key, value) in members)
    {
      rendered[key] = RenderValue(value);
    }

    return rendered;
  }

  private static JsonArray RenderAnyArray(AnyArray items)
  {
    var rendered = new JsonArray();

    foreach (var value in items)
    {
      rendered.Add(RenderValue(value));
    }

    return rendered;
  }

  /// <summary>
  /// yjs's Y.Text.toDelta: runs of characters carrying the formatting marks
  /// in force at that point. Marks and embeds are separate items in the same
  /// chain, so the run is flushed whenever either appears, and a mark whose
  /// value is JSON null removes the attribute rather than setting it.
  /// </summary>
  private static JsonArray RenderDelta(YAbstractType text)
  {
    var delta = new JsonArray();
    var attributes = new List<KeyValuePair<string, JsonNode?>>();
    var run = new StringBuilder();

    for (var item = text.Start; item is not null; item = item.Right)
    {
      if (item.Deleted)
      {
        continue;
      }

      switch (item.Content)
      {
        case ContentString characters:
          run.Append(characters.Text);
          break;

        case ContentEmbed or ContentType:
          PackRun(delta, run, attributes);
          delta.Add(Operation(RenderValue(item.Content.GetContent()[0]), attributes));
          break;

        case ContentFormat mark:
          PackRun(delta, run, attributes);
          SetAttribute(attributes, mark.Key, JsonNode.Parse(mark.Json));
          break;

        default:
          break;
      }
    }

    PackRun(delta, run, attributes);

    return delta;
  }

  private static void PackRun(
      JsonArray delta, StringBuilder run, List<KeyValuePair<string, JsonNode?>> attributes)
  {
    if (run.Length == 0)
    {
      return;
    }

    delta.Add(Operation(JsonValue.Create(run.ToString()), attributes));
    run.Clear();
  }

  private static JsonObject Operation(
      JsonNode? insert, List<KeyValuePair<string, JsonNode?>> attributes)
  {
    var operation = new JsonObject { ["insert"] = insert };

    if (attributes.Count == 0)
    {
      return operation;
    }

    var rendered = new JsonObject();

    foreach (var (key, value) in attributes)
    {
      rendered[key] = value?.DeepClone();
    }

    operation["attributes"] = rendered;

    return operation;
  }

  private static void SetAttribute(
      List<KeyValuePair<string, JsonNode?>> attributes, string key, JsonNode? value)
  {
    var position = attributes.FindIndex(entry => entry.Key == key);

    if (value is null)
    {
      if (position >= 0)
      {
        attributes.RemoveAt(position);
      }

      return;
    }

    var entry = new KeyValuePair<string, JsonNode?>(key, value);

    if (position >= 0)
    {
      attributes[position] = entry;
    }
    else
    {
      attributes.Add(entry);
    }
  }

  /// <summary>
  /// The XML serialisation yjs writes. Attributes are sorted so the string is
  /// stable, and an element's name is lower-cased, both as yjs does. A text
  /// node's own formatting marks are NOT rendered as nested tags here — no
  /// Blok client writes XML, and the fixtures carry none.
  /// </summary>
  private static string RenderXml(YAbstractType type)
  {
    switch (type)
    {
      case YXmlText characters:
        return characters.ToString();

      case YXmlElement element:
        var name = (element.NodeName ?? string.Empty).ToLowerInvariant();

        return $"<{name}{RenderXmlAttributes(element)}>{RenderXmlChildren(element)}</{name}>";

      default:
        return RenderXmlChildren(type);
    }
  }

  private static string RenderXmlAttributes(YAbstractType element)
  {
    var written = new StringBuilder();

    foreach (var key in element.Map.Keys.Order(StringComparer.Ordinal))
    {
      var head = element.Map[key];

      if (head.Deleted)
      {
        continue;
      }

      written.Append(CultureInfo.InvariantCulture, $" {key}=\"{head.Content.GetContent()[head.Length - 1]}\"");
    }

    return written.ToString();
  }

  private static string RenderXmlChildren(YAbstractType type)
  {
    var written = new StringBuilder();

    for (var item = type.Start; item is not null; item = item.Right)
    {
      if (!item.Deleted && item.Content is ContentType child)
      {
        written.Append(RenderXml(child.Type));
      }
    }

    return written.ToString();
  }
}
