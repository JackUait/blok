using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

internal sealed record McpSync(string Url, string? Origin);

internal abstract record McpTickets
{
  internal sealed record Secret(string Value) : McpTickets;

  internal sealed record Url(string Endpoint, string HostToken) : McpTickets;
}

internal abstract record McpSourceConfig
{
  internal sealed record Files(string Dir) : McpSourceConfig;

  internal sealed record Endpoint(string Url, string EndpointAuth, string? List) : McpSourceConfig;
}

/// <summary>Origins and host names a library endpoint takes; null origins means loopback pages only, null hosts no check.</summary>
internal sealed record McpCallerGate(IReadOnlyList<string>? Origins, IReadOnlyList<string>? Hosts);

internal sealed record McpOAuth(string Issuer, string Audience, string JwksUrl);

/// <summary>The decides-who-may hook: (principal, documentId, write) → allowed.</summary>
internal delegate Task<bool> McpAuthorize(string principal, string documentId, bool write, CancellationToken cancellationToken);

/// <summary>blok-mcp's start options, as the bundle's mcpParseArgs gives them.</summary>
internal sealed class McpConfig
{
  internal const double DefaultHandleIdleMs = 600_000;
  internal const double DefaultMaxHandles = 8;
  internal const string DefaultPrincipal = "local";

  internal string? HttpListen { get; init; }

  internal bool Public { get; init; }

  internal McpOAuth? OAuth { get; init; }

  internal McpSync? Sync { get; init; }

  internal McpTickets? Tickets { get; init; }

  internal McpSourceConfig? Source { get; init; }

  internal string? PageTitles { get; init; }

  internal JsonObject? RichTextFields { get; init; }

  internal string? Schema { get; init; }

  internal double? HandleIdleMs { get; init; }

  internal double? MaxHandlesPerPrincipal { get; init; }

  internal string? Principal { get; init; }

  internal bool? Comments { get; init; }

  internal JsonNode? Manifest { get; init; }

  /// <summary>The library's uploader hook; the CLI has none.</summary>
  internal BlokMcpUploads? Uploads { get; init; }

  /// <summary>Where a host hook's failure is logged in full; stderr when unset.</summary>
  internal Action<string, Exception>? LogError { get; init; }

  internal JsonNode? Overrides { get; init; }

  internal McpAuthorize? Authorize { get; init; }

  /// <summary>The library's agentActor hook: (principal, client name) → actor.</summary>
  internal Func<string, string, JsonObject>? AgentActor { get; init; }

  /// <summary>The library's front door: <see cref="Blok.Server.Mcp.Http.McpRequestGate"/> checks Origin and Host. The CLI's guard does it instead.</summary>
  internal McpCallerGate? Gate { get; init; }

  /// <summary>The library form: live handles run on this app's own collab rooms.</summary>
  internal Blok.Server.Agent.BlokAgentExecutor? Rooms { get; init; }

  /// <summary>Live mode is on: a sync URL, or this app's own rooms.</summary>
  internal bool Live => Sync is not null || Rooms is not null;

  internal double IdleMs => HandleIdleMs ?? DefaultHandleIdleMs;

  internal double MaxHandles => MaxHandlesPerPrincipal ?? DefaultMaxHandles;

  internal string PrincipalOrDefault => Principal ?? DefaultPrincipal;

  /// <summary>Reads mcpParseArgs' <c>options</c>.</summary>
  internal static McpConfig FromParsed(JsonObject options)
  {
    var transport = options["transport"] as JsonObject;
    var auth = options["auth"] as JsonObject;
    var sync = options["sync"] as JsonObject;
    var tickets = options["tickets"] as JsonObject;
    var source = options["source"] as JsonObject;
    var http = McpJson.String(transport?["kind"]) == "http";

    return new McpConfig
    {
      HttpListen = http ? McpJson.String(transport?["listen"]) ?? string.Empty : null,
      Public = http && McpJson.Bool(transport?["public"]) == true,
      OAuth = McpJson.String(auth?["kind"]) == "oauth"
          ? new McpOAuth(
              McpJson.String(auth?["issuer"]) ?? string.Empty,
              McpJson.String(auth?["audience"]) ?? string.Empty,
              McpJson.String(auth?["jwksUrl"]) ?? string.Empty)
          : null,
      Sync = sync is null ? null : new McpSync(McpJson.String(sync["url"]) ?? string.Empty, McpJson.String(sync["origin"])),
      Tickets = McpJson.String(tickets?["kind"]) switch
      {
        "secret" => new McpTickets.Secret(McpJson.String(tickets?["secret"]) ?? string.Empty),
        "url" => new McpTickets.Url(McpJson.String(tickets?["url"]) ?? string.Empty, McpJson.String(tickets?["hostToken"]) ?? string.Empty),
        _ => null,
      },
      Source = McpJson.String(source?["kind"]) switch
      {
        "files" => new McpSourceConfig.Files(McpJson.String(source?["dir"]) ?? string.Empty),
        "endpoint" => new McpSourceConfig.Endpoint(
            McpJson.String(source?["url"]) ?? string.Empty,
            McpJson.String(source?["endpointAuth"]) ?? string.Empty,
            McpJson.String(source?["list"])),
        _ => null,
      },
      PageTitles = McpJson.String(options["pageTitles"]),
      RichTextFields = options["richTextFields"]?.DeepClone() as JsonObject,
      Schema = McpJson.String(options["schema"]),
      HandleIdleMs = McpJson.Number(options["handleIdleMs"]),
      MaxHandlesPerPrincipal = McpJson.Number(options["maxHandlesPerPrincipal"]),
      Principal = McpJson.String(options["principal"]),
      Comments = McpJson.Bool(options["comments"]),
    };
  }

  /// <summary>The start flags mcpSurface takes; every handle call sends them again.</summary>
  internal JsonObject SurfaceFlags()
  {
    var flags = new JsonObject();

    if (PageTitles is not null)
    {
      flags["pageTitles"] = PageTitles;
    }
    flags["sync"] = Live;
    flags["source"] = Source is not null;
    flags["uploads"] = Uploads is not null;
    if (Comments == false)
    {
      flags["comments"] = false;
    }
    if (Manifest is not null)
    {
      flags["manifest"] = Manifest.DeepClone();
    }
    if (Overrides is not null)
    {
      flags["overrides"] = Overrides.DeepClone();
    }
    if (RichTextFields is not null)
    {
      flags["richTextFields"] = RichTextFields.DeepClone();
    }
    if (Schema is not null)
    {
      flags["schema"] = Schema;
    }
    if (HandleIdleMs is double idle)
    {
      flags["handleIdleMs"] = idle;
    }

    return flags;
  }
}
