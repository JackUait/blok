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

internal static class McpJson
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
      default:
        // A clone outlives the document and keeps the number's text.
        return JsonValue.Create(element.Clone());
    }
  }

  internal static string Write(JsonNode? node)
  {
    return node is null ? "null" : node.ToJsonString(Raw);
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
