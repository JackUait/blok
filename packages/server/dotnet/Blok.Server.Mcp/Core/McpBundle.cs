using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Runtime;

namespace Blok.Server.Mcp.Core;

/// <summary>The runtime bundle's mcp* operations: all pure MCP logic runs there.</summary>
internal sealed class McpBundle(IBlokRuntime runtime)
{
  // Agent batches on a cold JIT can pass the runtime's 10 s default.
  private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(60);

  internal IBlokRuntime Runtime => runtime;

  internal async Task<JsonObject> CallAsync(string operation, JsonObject input, CancellationToken cancellationToken = default)
  {
    var text = await runtime.InvokeAsync(operation, McpJson.Write(input), CallTimeout, cancellationToken);

    return McpJson.Parse(text) as JsonObject
        ?? throw new InvalidOperationException($"The runtime answered {operation} with a value that is not an object.");
  }

  internal async Task<string> CallTextAsync(string operation, string inputJson, CancellationToken cancellationToken = default)
  {
    return await runtime.InvokeAsync(operation, inputJson, CallTimeout, cancellationToken);
  }
}

internal static partial class McpJson
{
  // Raw UTF-8 like JSON.stringify; the default encoder escapes ', <, > and non-ASCII.
  internal static readonly JsonSerializerOptions Raw = new()
  {
    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    MaxDepth = MaxDepth,
  };

  // Documents nest past System.Text.Json's default of 64.
  private const int MaxDepth = 1000;

  private static readonly JsonDocumentOptions ReadOptions = new() { MaxDepth = MaxDepth };

  /// <summary>
  /// Parses JSON text as JSON.parse does: a repeated key keeps its last value, at its first
  /// key's place. Throws <see cref="JsonException"/> for anything JSON.parse refuses.
  /// </summary>
  internal static JsonNode? Parse(string text)
  {
    // JsonNode.Parse would throw on a repeated key only when the object is first read.
    using var document = JsonDocument.Parse(text, ReadOptions);

    return NodeOf(document.RootElement);
  }

  private static JsonNode? NodeOf(JsonElement element)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        var node = new JsonObject();

        foreach (var property in element.EnumerateObject())
        {
          node[property.Name] = NodeOf(property.Value);
        }

        return node;
      case JsonValueKind.Array:
        var list = new JsonArray();

        foreach (var item in element.EnumerateArray())
        {
          list.Add(NodeOf(item));
        }

        return list;
      case JsonValueKind.Null:
        return null;
      case JsonValueKind.String when !TryString(element, out _):
        return JsonValue.Create(Unescape(element.GetRawText()));
      default:
        // A clone outlives the document and keeps the number's text.
        return JsonValue.Create(element.Clone());
    }
  }

  /// <summary>Whether JSON text may hold a \\uD800-\\uDFFF escape (a pair also counts).</summary>
  internal static bool HasLoneSurrogateEscape(string text)
  {
    return SurrogateEscape().IsMatch(text);
  }

  [System.Text.RegularExpressions.GeneratedRegex(@"\\[uU][dD][89a-fA-F]", System.Text.RegularExpressions.RegexOptions.CultureInvariant)]
  private static partial System.Text.RegularExpressions.Regex SurrogateEscape();

  private static bool TryString(JsonElement element, out string? value)
  {
    try
    {
      value = element.GetString();

      return true;
    }
    catch (InvalidOperationException)
    {
      // A lone surrogate escape, which System.Text.Json will not read.
      value = null;

      return false;
    }
  }

  // A JSON string token as JSON.parse reads it, each lone surrogate as U+FFFD.
  private static string Unescape(string token)
  {
    var units = new System.Text.StringBuilder(token.Length);

    for (var at = 1; at < token.Length - 1; at++)
    {
      var c = token[at];

      if (c != '\\')
      {
        units.Append(c);
        continue;
      }
      var escape = token[++at];

      units.Append(escape switch
      {
        'b' => '\b',
        'f' => '\f',
        'n' => '\n',
        'r' => '\r',
        't' => '\t',
        'u' => (char)Convert.ToUInt16(token.Substring(at + 1, 4), 16),
        _ => escape,
      });
      if (escape == 'u')
      {
        at += 4;
      }
    }
    var text = units.ToString();
    var clean = new System.Text.StringBuilder(text.Length);

    for (var at = 0; at < text.Length; at++)
    {
      if (char.IsHighSurrogate(text[at]) && at + 1 < text.Length && char.IsLowSurrogate(text[at + 1]))
      {
        clean.Append(text[at]).Append(text[++at]);
      }
      else
      {
        clean.Append(char.IsSurrogate(text[at]) ? '\uFFFD' : text[at]);
      }
    }

    return clean.ToString();
  }

  /// <summary>JSON text with JSON.stringify's bytes; a lone surrogate becomes U+FFFD.</summary>
  internal static string Write(JsonNode? node)
  {
    var text = new System.Text.StringBuilder();

    WriteTo(text, node);

    return text.ToString();
  }

  private static void WriteTo(System.Text.StringBuilder text, JsonNode? node)
  {
    switch (node)
    {
      case null:
        text.Append("null");
        break;
      case JsonObject members:
        text.Append('{');
        var first = true;

        foreach (var (name, value) in members)
        {
          if (!first)
          {
            text.Append(',');
          }
          first = false;
          Quote(text, name);
          text.Append(':');
          WriteTo(text, value);
        }
        text.Append('}');
        break;
      case JsonArray items:
        text.Append('[');
        for (var at = 0; at < items.Count; at++)
        {
          if (at > 0)
          {
            text.Append(',');
          }
          WriteTo(text, items[at]);
        }
        text.Append(']');
        break;
      default:
        var kind = node.GetValueKind();

        if (kind == JsonValueKind.String)
        {
          Quote(text, String(node)!);
        }
        else if (kind is JsonValueKind.Object or JsonValueKind.Array)
        {
          // A JsonValue over an element that holds an object or array.
          WriteTo(text, Parse(node.ToJsonString()));
        }
        else
        {
          // Numbers keep their text; true, false and null have one spelling.
          text.Append(node.ToJsonString(Raw));
        }
        break;
    }
  }

  // JSON.stringify's escapes: " and \, the short forms, other controls as lower-case \u00xx.
  private static void Quote(System.Text.StringBuilder text, string value)
  {
    text.Append('"');
    for (var at = 0; at < value.Length; at++)
    {
      var c = value[at];

      switch (c)
      {
        case '"':
          text.Append("\\\"");
          break;
        case '\\':
          text.Append("\\\\");
          break;
        case '\b':
          text.Append("\\b");
          break;
        case '\f':
          text.Append("\\f");
          break;
        case '\n':
          text.Append("\\n");
          break;
        case '\r':
          text.Append("\\r");
          break;
        case '\t':
          text.Append("\\t");
          break;
        default:
          if (c < ' ')
          {
            text.Append("\\u00").Append(((int)c).ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
          }
          else if (char.IsHighSurrogate(c) && at + 1 < value.Length && char.IsLowSurrogate(value[at + 1]))
          {
            text.Append(c).Append(value[++at]);
          }
          else if (char.IsSurrogate(c))
          {
            text.Append('\uFFFD');
          }
          else
          {
            text.Append(c);
          }
          break;
      }
    }
    text.Append('"');
  }

  internal static JsonNode? Clone(JsonNode? node)
  {
    return node?.DeepClone();
  }

  internal static string? String(JsonNode? node)
  {
    return node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
  }

  internal static bool? Bool(JsonNode? node)
  {
    return node is JsonValue value && value.TryGetValue<bool>(out var flag) ? flag : null;
  }

  internal static double? Number(JsonNode? node)
  {
    if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.Number)
    {
      return null;
    }
    // A value built in C# holds its CLR type, which GetValue<double> will not convert.
    if (value.TryGetValue<double>(out var number))
    {
      return number;
    }
    if (value.TryGetValue<int>(out var small))
    {
      return small;
    }
    if (value.TryGetValue<long>(out var large))
    {
      return large;
    }

    return double.Parse(value.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);
  }
}
