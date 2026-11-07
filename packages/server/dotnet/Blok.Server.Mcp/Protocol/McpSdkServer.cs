using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>Who a request comes from, for one transport.</summary>
internal delegate McpCallerIdentity McpIdentity(RequestContext<CallToolRequestParams> context);

internal sealed record McpCallerIdentity(string Principal, IReadOnlyList<string>? Scopes);

internal sealed record McpSdkSurface(string Version, string? Instructions, List<Tool> Tools, List<Prompt> Prompts);

/// <summary>Builds the SDK server options over the shell: blok-mcp's tools, prompts and instructions.</summary>
internal static class McpSdkServer
{
  internal const string ClientInfoMeta = "io.modelcontextprotocol/clientInfo";
  internal const string ClientCapabilitiesMeta = "io.modelcontextprotocol/clientCapabilities";

  internal static async Task<McpServerOptions> OptionsAsync(McpServerCore core, McpIdentity identity, CancellationToken cancellationToken)
  {
    var options = new McpServerOptions();

    Configure(options, await PrepareAsync(core, cancellationToken), core, identity);

    return options;
  }

  /// <summary>What every server built over one shell shares: built once, as Node caches its surface.</summary>
  internal static async Task<McpSdkSurface> PrepareAsync(McpServerCore core, CancellationToken cancellationToken)
  {
    var surface = await core.SurfaceAsync(cancellationToken);
    var version = await core.Bundle.CallTextAsync("version", "{}", cancellationToken);

    return new McpSdkSurface(
        version,
        McpJson.String(surface["instructions"]),
        Deserialize<List<Tool>>(surface["tools"]),
        Deserialize<List<Prompt>>(surface["prompts"]));
  }

  internal static void Configure(McpServerOptions options, McpSdkSurface surface, McpServerCore core, McpIdentity identity)
  {
    var tools = surface.Tools;
    var prompts = surface.Prompts;
    var byName = tools.Select(tool => tool.Name).ToHashSet(StringComparer.Ordinal);

    options.ServerInfo = new Implementation { Name = "blok-mcp", Version = surface.Version };
    options.ServerInstructions = surface.Instructions;
    options.Capabilities = new ServerCapabilities { Tools = new ToolsCapability(), Prompts = new PromptsCapability() };
    options.Handlers = new McpServerHandlers
    {
      ListToolsHandler = (_, _) => ValueTask.FromResult(new ListToolsResult { Tools = tools }),
      ListPromptsHandler = (_, _) => ValueTask.FromResult(new ListPromptsResult { Prompts = prompts }),
      GetPromptHandler = async (context, token) =>
      {
        var name = context.Params?.Name ?? string.Empty;
        var arguments = context.Params?.Arguments is { } given ? JsonSerializer.SerializeToNode(given, McpJsonUtilities.DefaultOptions) : null;
        var outcome = await core.PromptAsync(name, arguments, token);

        if (outcome["error"] is JsonObject error)
        {
          throw new McpProtocolException(McpJson.String(error["message"]) ?? string.Empty, (McpErrorCode)(int)(McpJson.Number(error["code"]) ?? -32602));
        }

        return Deserialize<GetPromptResult>(outcome["result"]);
      },
      CallToolHandler = (context, token) => Internal(() => CallToolAsync(core, identity, byName, context, token)),
    };

    new McpWireFilters().Install(options);
    InstallArrivalOrder(options, core);
    // Before the SDK reads params as CallToolRequestParams, which fails a bad shape with -32603.
    options.Filters.Message.IncomingFilters.Add(next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is JsonRpcRequest { Method: RequestMethods.ToolsCall } request
          && McpRequestShape.ToolsCallRefusal(request.Params) is string refusal)
      {
        throw new McpProtocolException(refusal, McpErrorCode.InvalidParams);
      }
      await next(context, cancellationToken);
    });
  }

  // The SDK runs incoming messages at once, so places are taken by the transport's reader
  // (McpOrderedInput); an answer or a cancel frees one its call never used.
  private static void InstallArrivalOrder(McpServerOptions options, McpServerCore core)
  {
    options.Filters.Message.IncomingFilters.Add(next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is JsonRpcNotification { Method: NotificationMethods.CancelledNotification } cancelled
          && cancelled.Params?["requestId"] is JsonNode id)
      {
        core.Unreserve(McpOrderedInput.IdOf(id));
      }
      var tag = context.JsonRpcMessage is JsonRpcRequest { Method: RequestMethods.ToolsCall } call ? TagOf(call.Params) : null;

      try
      {
        await next(context, cancellationToken);
      }
      finally
      {
        // A no-op once the call took its place; frees it when the SDK refused the call.
        if (tag is long mine)
        {
          core.ReleaseTag(mine);
        }
      }
    });
    options.Filters.Message.OutgoingFilters.Add(next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is JsonRpcResponse or JsonRpcError)
      {
        core.Unreserve(((JsonRpcMessageWithId)context.JsonRpcMessage).Id.ToString());
      }
      await next(context, cancellationToken);
    });
  }

  private static long? TagOf(JsonNode? parameters)
  {
    return parameters is JsonObject call && call["_meta"] is JsonObject meta && meta[McpServerCore.ArrivalTagMeta] is JsonValue value
        && value.TryGetValue<long>(out var tag) ? tag : null;
  }

  /// <summary>As Node: a throw that is not model-fixable is JSON-RPC -32603, not a tool error.</summary>
  private static async ValueTask<T> Internal<T>(Func<ValueTask<T>> run)
  {
    try
    {
      return await run();
    }
    catch (Exception error) when (error is not McpProtocolException and not InputRequiredException and not OperationCanceledException)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: a tool call failed: {error}");

      throw new McpProtocolException(error.Message, McpErrorCode.InternalError);
    }
  }

  private static async ValueTask<CallToolResult> CallToolAsync(
      McpServerCore core, McpIdentity identity, HashSet<string> byName, RequestContext<CallToolRequestParams> context, CancellationToken token)
  {
    var name = context.Params?.Name ?? string.Empty;

    if (!byName.Contains(name))
    {
      throw new McpProtocolException($"Unknown tool: {name}", McpErrorCode.InvalidParams);
    }
    var raw = context.JsonRpcRequest.Params as JsonObject;

    // Node hands the cancel signal (stdio cancel, HTTP disconnect) to opens only; any other call
    // runs to its end. The runtime's 60 s deadline and memory budget still bound it.
    if (name != "blok_open")
    {
      token = CancellationToken.None;
    }

    // Before the first await: calls on one handle keep the order they arrived in, as Node's queue does.
    // Every call goes through here, so stop waits for each one.
    return await core.InArrivalOrderAsync(
        McpJson.String(raw?["arguments"]?["handle"]), context.JsonRpcRequest.Id.ToString(), () => CallInOrderAsync(core, identity, name, raw, context, token), TagOf(raw));
  }

  private static async Task<CallToolResult> CallInOrderAsync(
      McpServerCore core, McpIdentity identity, string name, JsonObject? raw, RequestContext<CallToolRequestParams> context, CancellationToken token)
  {
    var meta = raw?["_meta"] as JsonObject;
    var clientName = McpJson.String((meta?[ClientInfoMeta] as JsonObject)?["name"]) ?? context.Server.ClientInfo?.Name;
    var capabilities = meta is not null && meta.ContainsKey(ClientCapabilitiesMeta)
        ? meta[ClientCapabilitiesMeta]?.DeepClone()
        : context.Server.ClientCapabilities is { } declared ? JsonSerializer.SerializeToNode(declared, McpJsonUtilities.DefaultOptions) : null;
    var who = identity(context);
    var caller = await core.CallerAsync(who.Principal, clientName, who.Scopes, token);
    var arguments = raw?["arguments"] as JsonObject;
    var approval = new McpApproval(capabilities, raw?["inputResponses"]?.DeepClone(), caller.ClientName);
    var outcome = await core.CallToolAsync(name, arguments, caller, approval, token);

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
            [McpJson.String(ask["key"]) ?? "approve"] = InputRequest.ForElicitation(Deserialize<ElicitRequestParams>(question)),
          },
          null);
    }
    var answer = outcome.Answer!;
    var structured = answer["structuredContent"];

    return Deserialize<CallToolResult>(new JsonObject
    {
      ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = McpJson.Write(structured) }),
      ["structuredContent"] = structured?.DeepClone(),
      ["isError"] = answer["isError"]?.DeepClone(),
    });
  }

  private static T Deserialize<T>(JsonNode? node)
  {
    return node.Deserialize<T>(McpJsonUtilities.DefaultOptions)
        ?? throw new InvalidOperationException($"The runtime gave no {typeof(T).Name}.");
  }
}
