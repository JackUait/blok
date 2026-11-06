using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// A model-fixable error the host raised. <see cref="Helper"/> names the Node helper
/// that builds it at that call site (surface, failure or as-is): it decides retryable.
/// </summary>
internal sealed class McpHostError : Exception
{
  internal McpHostError(string code, string message, JsonObject? details = null, string helper = "surface")
      : base(message)
  {
    Code = code;
    Details = details;
    Helper = helper;
  }

  /// <summary>An error the bundle already built, kept as is.</summary>
  internal McpHostError(JsonObject error)
      : base(McpJson.String(error["message"]) ?? string.Empty)
  {
    Code = McpJson.String(error["code"]) ?? string.Empty;
    Prebuilt = error;
    Helper = "as-is";
  }

  internal string Code { get; }

  internal JsonObject? Details { get; }

  internal string Helper { get; }

  internal JsonObject? Prebuilt { get; }

  internal JsonObject ToInput(string tool)
  {
    JsonObject error;

    if (Prebuilt is not null)
    {
      error = (JsonObject)Prebuilt.DeepClone();
    }
    else
    {
      error = new JsonObject { ["code"] = Code, ["message"] = Message };
      if (Details is not null)
      {
        error["details"] = Details.DeepClone();
      }
    }

    return new JsonObject { ["tool"] = tool, ["helper"] = Helper, ["error"] = error };
  }

  internal static McpHostError Surface(string code, string message, JsonObject? details = null)
  {
    return new McpHostError(code, message, details);
  }
}

/// <summary>
/// A Node config error: <c>blok-mcp: &lt;message&gt;</c> on stderr and exit 2.
/// </summary>
public sealed class BlokMcpConfigException : Exception
{
  /// <summary>Creates the error.</summary>
  /// <param name="message">The message Node prints after <c>blok-mcp: </c>.</param>
  public BlokMcpConfigException(string message)
      : base(message)
  {
  }

  /// <summary>Creates the error.</summary>
  public BlokMcpConfigException()
  {
  }

  /// <summary>Creates the error.</summary>
  /// <param name="message">The message.</param>
  /// <param name="innerException">The cause.</param>
  public BlokMcpConfigException(string message, Exception innerException)
      : base(message, innerException)
  {
  }
}
