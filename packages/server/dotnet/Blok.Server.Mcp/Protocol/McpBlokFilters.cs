using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// Blok's tools and prompts as SDK request filters, on blok-mcp's own server or a host's. Filters
/// are lists, so they compose with the host's handlers and filters; Blok answers only its own
/// names and passes every other one on. It never sets serverInfo, instructions or a handler.
/// </summary>
/// <param name="Core">The shell every call runs on.</param>
/// <param name="Surface">Blok's tools and prompts; may refuse to start (a host name clash).</param>
/// <param name="Identity">Who one call comes from.</param>
/// <param name="Standalone">blok-mcp's own server: its HTTP gate parks deep arguments, which calls read back.</param>
/// <param name="Log">Where a failed call is logged in full; stderr when null.</param>
internal sealed record McpBlokFilters(
    McpServerCore Core, Func<CancellationToken, ValueTask<McpSdkSurface>> Surface, McpCallIdentity Identity, bool Standalone, Action<string, Exception>? Log)
{
  internal void Install(McpServerOptions options)
  {
    var request = options.Filters.Request;

    request.ListToolsFilters.Add(next => async (context, token) =>
    {
      var listed = await next(context, token);
      var surface = await Surface(token);

      RefuseClash(listed.Tools.Select(tool => tool.Name), surface.ToolNames);

      // As Node: Blok's tools follow the host's on every page, in the bundle's order.
      return new ListToolsResult
      {
        Tools = [.. listed.Tools, .. surface.Tools],
        NextCursor = listed.NextCursor,
        Meta = listed.Meta,
        ResultType = listed.ResultType,
        TimeToLive = listed.TimeToLive,
        CacheScope = listed.CacheScope,
      };
    });
    request.ListPromptsFilters.Add(next => async (context, token) =>
    {
      var listed = await next(context, token);
      var surface = await Surface(token);

      RefuseClash(listed.Prompts.Select(prompt => prompt.Name), surface.PromptNames);

      return new ListPromptsResult
      {
        Prompts = [.. listed.Prompts, .. surface.Prompts],
        NextCursor = listed.NextCursor,
        Meta = listed.Meta,
        ResultType = listed.ResultType,
        TimeToLive = listed.TimeToLive,
        CacheScope = listed.CacheScope,
      };
    });
    request.GetPromptFilters.Add(next => async (context, token) =>
        (await Surface(token)).PromptNames.Contains(context.Params?.Name ?? string.Empty)
            ? await PromptAsync(Core, context, token)
            : await next(context, token));
    // The alternate list runs on both of the SDK's call paths, so a host's own alternate handler keeps working.
#pragma warning disable MCPEXP002 // Experimental in SDK 2.x; the only filter list a host's alternate handler allows.
    request.CallToolWithAlternateFilters.Add(async (context, next, token) =>
    {
      var name = context.Params?.Name ?? string.Empty;

      if (!(await Surface(token)).ToolNames.Contains(name))
      {
        return await next(context, token);
      }

      return await Internal(() => CallToolAsync(name, context, token));
    });
#pragma warning restore MCPEXP002
  }

  /// <summary>A Blok prompt, or the bundle's protocol error for it.</summary>
  internal static async ValueTask<GetPromptResult> PromptAsync(McpServerCore core, RequestContext<GetPromptRequestParams> context, CancellationToken token)
  {
    var name = context.Params?.Name ?? string.Empty;
    var arguments = context.Params?.Arguments is { } given ? JsonSerializer.SerializeToNode(given, McpJsonUtilities.DefaultOptions) : null;
    var outcome = await core.PromptAsync(name, arguments, token);

    if (outcome["error"] is JsonObject error)
    {
      throw new McpProtocolException(McpJson.String(error["message"]) ?? string.Empty, (McpErrorCode)(int)(McpJson.Number(error["code"]) ?? -32602));
    }

    return McpSdkServer.Deserialize<GetPromptResult>(outcome["result"]);
  }

  /// <summary>The host's list names a tool or prompt Blok serves: one of them would be lost, so nothing is served.</summary>
  private static void RefuseClash(IEnumerable<string> listed, HashSet<string> blok)
  {
    var taken = listed.Where(blok.Contains).ToList();

    if (taken.Count > 0)
    {
      throw new McpProtocolException(McpBlokNames.Clash(taken), McpErrorCode.InternalError);
    }
  }

  /// <summary>As Node: a throw that is not model-fixable is JSON-RPC -32603, not a tool error.</summary>
  private async ValueTask<T> Internal<T>(Func<ValueTask<T>> run)
  {
    try
    {
      return await run();
    }
    catch (Exception error) when (error is not McpProtocolException and not InputRequiredException and not OperationCanceledException)
    {
      if (Log is null)
      {
        await Console.Error.WriteLineAsync($"blok-mcp: a tool call failed: {error}");
      }
      else
      {
        Log("blok-mcp: a tool call failed", error);
      }

      throw new McpProtocolException(error.Message, McpErrorCode.InternalError);
    }
  }

  private async ValueTask<CallToolResult> CallToolAsync(string name, RequestContext<CallToolRequestParams> context, CancellationToken token)
  {
    var raw = context.JsonRpcRequest.Params as JsonObject;

    // Only blok-mcp's own gate parks arguments; on a host's server a client could name another call's.
    if (Standalone && raw?["arguments"] is JsonObject stand && McpJson.String(stand[McpRequestShape.ParkedArguments]) is string key)
    {
      raw["arguments"] = Core.Unpark(key);
    }

    // Node hands the cancel signal (stdio cancel, HTTP disconnect) to opens only; any other call
    // runs to its end. The runtime's 60 s deadline and memory budget still bound it.
    if (name != "blok_open")
    {
      token = CancellationToken.None;
    }

    // Before the first await: calls on one handle keep the order they arrived in, as Node's queue does.
    // Every call goes through here, so stop waits for each one. Only blok-mcp's stdio reader reserves
    // places by request id; a host's clients may reuse ids, so they get none.
    return await Core.InArrivalOrderAsync(
        McpJson.String(raw?["arguments"]?["handle"]),
        Standalone ? context.JsonRpcRequest.Id.ToString() : null,
        () => CallInOrderAsync(name, raw, context, token),
        Standalone ? McpSdkServer.TagOf(raw) : null);
  }

  private async Task<CallToolResult> CallInOrderAsync(string name, JsonObject? raw, RequestContext<CallToolRequestParams> context, CancellationToken token)
  {
    var meta = raw?["_meta"] as JsonObject;
    var clientName = McpJson.String((meta?[McpSdkServer.ClientInfoMeta] as JsonObject)?["name"]) ?? context.Server.ClientInfo?.Name;
    var capabilities = meta is not null && meta.ContainsKey(McpSdkServer.ClientCapabilitiesMeta)
        ? meta[McpSdkServer.ClientCapabilitiesMeta]?.DeepClone()
        : context.Server.ClientCapabilities is { } declared ? JsonSerializer.SerializeToNode(declared, McpJsonUtilities.DefaultOptions) : null;
    var who = await Identity(context, token);
    var caller = await Core.CallerAsync(who.Principal, clientName, who.Scopes, token);
    var arguments = raw?["arguments"] as JsonObject;
    var approval = new McpApproval(capabilities, raw?["inputResponses"]?.DeepClone(), caller.ClientName);
    var outcome = await Core.CallToolAsync(name, arguments, caller, approval, token);

    if (outcome.UnknownTool is not null)
    {
      throw new McpProtocolException(outcome.UnknownTool, McpErrorCode.InvalidParams);
    }
    if (outcome.Ask is JsonObject ask)
    {
      var question = new JsonObject
      {
        ["message"] = ask["message"]?.DeepClone(),
        ["requestedSchema"] = ask["requestedSchema"]?.DeepClone(),
        ["mode"] = "form",
      };

      throw new InputRequiredException(
          new Dictionary<string, InputRequest>
          {
            [McpJson.String(ask["key"]) ?? "approve"] = InputRequest.ForElicitation(McpSdkServer.Deserialize<ElicitRequestParams>(question)),
          },
          null);
    }
    var answer = outcome.Answer!;
    var structured = answer["structuredContent"];

    return McpSdkServer.Deserialize<CallToolResult>(new JsonObject
    {
      ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = McpJson.Write(structured) }),
      ["structuredContent"] = structured?.DeepClone(),
      ["isError"] = answer["isError"]?.DeepClone(),
    });
  }
}

/// <summary>The words a host server's name clash is refused with, at start and on a list.</summary>
internal static class McpBlokNames
{
  internal static string Clash(IEnumerable<string> taken)
  {
    return $"Blok already serves {string.Join(", ", taken)}: rename the host's tool or prompt";
  }
}
