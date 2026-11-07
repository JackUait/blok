using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// The message shapes Node's SDK refuses before any handler, in its words (measured against
/// the conformance fixtures). The C# SDK would fail them with -32603 instead.
/// </summary>
internal static class McpRequestShape
{
  internal const string NotAMessage = "Bad Request: the request body is not a valid JSON-RPC message";

  private static readonly JsonDocumentOptions Strict = new() { MaxDepth = 1000, AllowDuplicateProperties = false };
  private static readonly JsonDocumentOptions Lenient = new() { MaxDepth = 1000 };

  private static readonly JsonSerializerOptions Pretty = new(McpJson.Raw) { WriteIndented = true };

  /// <summary>The text as JSON, and whether a key repeats; null when it is not JSON.</summary>
  internal static (JsonDocument Document, bool Repeated)? Read(ReadOnlyMemory<byte> text)
  {
    try
    {
      return (JsonDocument.Parse(text, Strict), false);
    }
    catch (JsonException)
    {
      // Not JSON, or a repeated key: the lenient parse tells which.
    }
    try
    {
      return (JsonDocument.Parse(text, Lenient), true);
    }
    catch (JsonException)
    {
      return null;
    }
  }

  /// <summary>
  /// False for an object whose params, or params._meta, is not an object: Node's SDK drops it
  /// (no answer on stdio, 400 over HTTP). Anything else is left to the SDK.
  /// </summary>
  internal static bool IsMessage(JsonElement message)
  {
    if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty("params", out var parameters))
    {
      return true;
    }

    return parameters.ValueKind == JsonValueKind.Object
        && (!parameters.TryGetProperty("_meta", out var meta) || meta.ValueKind == JsonValueKind.Object);
  }

  /// <summary>The -32602 message Node gives a tools/call with no params, or a bad name or arguments; null when it passes.</summary>
  internal static string? ToolsCallRefusal(JsonNode? parameters)
  {
    var issues = new JsonArray();

    if (parameters is not JsonObject call)
    {
      issues.Add(Issue("object", "params", null, parameters is null ? "undefined" : TypeOf(parameters)));
    }
    else
    {
      if (!call.TryGetPropertyValue("name", out var name) || McpJson.String(name) is null)
      {
        issues.Add(Issue("string", "params", "name", call.ContainsKey("name") ? TypeOf(name) : "undefined"));
      }
      if (call.TryGetPropertyValue("arguments", out var arguments) && arguments is not JsonObject)
      {
        issues.Add(Issue("record", "params", "arguments", TypeOf(arguments)));
      }
    }

    return issues.Count == 0 ? null : $"Invalid tools/call request: {issues.ToJsonString(Pretty)}";
  }

  private static JsonObject Issue(string expected, string root, string? field, string received)
  {
    var path = field is null ? new JsonArray(root) : new JsonArray(root, field);

    return new JsonObject
    {
      ["expected"] = expected,
      ["code"] = "invalid_type",
      ["path"] = path,
      ["message"] = $"Invalid input: expected {expected}, received {received}",
    };
  }

  // zod's names for a JSON value's type.
  private static string TypeOf(JsonNode? value)
  {
    return value switch
    {
      null => "null",
      JsonObject => "object",
      JsonArray => "array",
      _ => value.GetValueKind() switch
      {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        _ => "boolean",
      },
    };
  }
}
