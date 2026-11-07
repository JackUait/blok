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

  /// <summary>
  /// Node's JSONRPCMessageSchema (core schemas.ts): a request, notification, result or error, each
  /// with no other top-level key. Node's stdio reader drops any other line without an answer.
  /// </summary>
  internal static bool IsNodeMessage(JsonElement message)
  {
    if (message.ValueKind != JsonValueKind.Object
        || !message.TryGetProperty("jsonrpc", out var version) || version.ValueKind != JsonValueKind.String || version.GetString() != "2.0")
    {
      return false;
    }
    var keys = message.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.Ordinal);
    var hasId = message.TryGetProperty("id", out var id);

    if (message.TryGetProperty("method", out var method))
    {
      return method.ValueKind == JsonValueKind.String
          && keys.IsSubsetOf(["jsonrpc", "id", "method", "params"])
          && (!hasId || IsId(id))
          && (!message.TryGetProperty("params", out var parameters) || IsParams(parameters));
    }
    if (message.TryGetProperty("result", out var result))
    {
      return hasId && IsId(id) && keys.SetEquals(["jsonrpc", "id", "result"]) && result.ValueKind == JsonValueKind.Object
          && (!result.TryGetProperty("_meta", out var meta) || meta.ValueKind == JsonValueKind.Object);
    }

    return message.TryGetProperty("error", out var error) && keys.IsSubsetOf(["jsonrpc", "id", "error"]) && (!hasId || IsId(id))
        && error.ValueKind == JsonValueKind.Object
        && error.TryGetProperty("code", out var code) && IsSafeInteger(code)
        && error.TryGetProperty("message", out var text) && text.ValueKind == JsonValueKind.String;
  }

  private static bool IsParams(JsonElement parameters)
  {
    if (parameters.ValueKind != JsonValueKind.Object)
    {
      return false;
    }
    if (!parameters.TryGetProperty("_meta", out var meta))
    {
      return true;
    }

    return meta.ValueKind == JsonValueKind.Object
        && (!meta.TryGetProperty("progressToken", out var token) || IsId(token))
        && (!meta.TryGetProperty("io.modelcontextprotocol/related-task", out var task)
            || (task.ValueKind == JsonValueKind.Object && task.TryGetProperty("taskId", out var taskId) && taskId.ValueKind == JsonValueKind.String));
  }

  // zod's z.union([z.string(), z.number().int()]).
  private static bool IsId(JsonElement id)
  {
    return id.ValueKind == JsonValueKind.String || IsSafeInteger(id);
  }

  // zod 4's .int() takes safe integers only, written any way (7e0 and 1.0 pass).
  private static bool IsSafeInteger(JsonElement number)
  {
    return number.ValueKind == JsonValueKind.Number && number.TryGetDouble(out var value)
        && double.IsFinite(value) && Math.Floor(value) == value && Math.Abs(value) <= 9007199254740991;
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
