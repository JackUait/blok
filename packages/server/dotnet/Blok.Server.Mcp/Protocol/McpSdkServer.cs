using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>Who a request comes from, for one transport.</summary>
internal delegate McpCallerIdentity McpIdentity(RequestContext<CallToolRequestParams> context);

/// <summary>Who one tools/call comes from; throws an McpProtocolException to refuse the call.</summary>
internal delegate ValueTask<McpCallerIdentity> McpCallIdentity(RequestContext<CallToolRequestParams> context, CancellationToken cancellationToken);

internal sealed record McpCallerIdentity(string Principal, IReadOnlyList<string>? Scopes);

internal sealed record McpSdkSurface(string Version, string? Instructions, List<Tool> Tools, List<Prompt> Prompts)
{
  internal HashSet<string> ToolNames { get; } = [.. Tools.Select(tool => tool.Name)];

  internal HashSet<string> PromptNames { get; } = [.. Prompts.Select(prompt => prompt.Name)];
}

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

  /// <summary>
  /// blok-mcp's own server: its name, instructions and capabilities, Node's wire, and Blok's
  /// own words for a tool or prompt nobody serves. Blok's tools come from the same filters a
  /// host's server gets (<see cref="McpBlokFilters"/>).
  /// </summary>
  internal static void Configure(McpServerOptions options, McpSdkSurface surface, McpServerCore core, McpIdentity identity)
  {
    options.ServerInfo = new Implementation { Name = "blok-mcp", Version = surface.Version };
    options.ServerInstructions = surface.Instructions;
    options.Capabilities = new ServerCapabilities { Tools = new ToolsCapability(), Prompts = new PromptsCapability() };
    options.Handlers = new McpServerHandlers
    {
      // The filters serve Blok's names; the SDK would quote any other one (protocol.json pins this).
      CallToolHandler = (context, _) => throw new McpProtocolException($"Unknown tool: {context.Params?.Name ?? string.Empty}", McpErrorCode.InvalidParams),
      // The bundle words an unknown prompt itself.
      GetPromptHandler = (context, token) => McpBlokFilters.PromptAsync(core, context, token),
    };
    new McpBlokFilters(core, _ => ValueTask.FromResult(surface), (context, _) => ValueTask.FromResult(identity(context)), Standalone: true, Log: null).Install(options);

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
        // Parked arguments a refused call never read back.
        if (context.JsonRpcMessage is JsonRpcRequest { Params: JsonObject { } sent } && sent["arguments"] is JsonObject stand
            && McpJson.String(stand[McpRequestShape.ParkedArguments]) is string key)
        {
          core.Unpark(key);
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

  internal static long? TagOf(JsonNode? parameters)
  {
    return parameters is JsonObject call && call["_meta"] is JsonObject meta && meta[McpServerCore.ArrivalTagMeta] is JsonValue value
        && value.TryGetValue<long>(out var tag) ? tag : null;
  }

  internal static T Deserialize<T>(JsonNode? node)
  {
    return node.Deserialize<T>(McpJsonUtilities.DefaultOptions)
        ?? throw new InvalidOperationException($"The runtime gave no {typeof(T).Name}.");
  }
}
