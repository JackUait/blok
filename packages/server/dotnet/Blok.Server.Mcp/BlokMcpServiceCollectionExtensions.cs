using System.Security.Claims;
using System.Text.Json.Nodes;
using Blok.Server.AspNetCore;
using Blok.Server.Mcp.Auth;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Http;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Mcp.Protocol;
using Blok.Server.Runtime;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ModelContextProtocol.AspNetCore;

namespace Blok.Server.Mcp;

/// <summary>Registers Blok's MCP server in an ASP.NET Core app.</summary>
public static class BlokMcpServiceCollectionExtensions
{
  /// <summary>
  /// Registers the MCP server: Blok's six tools, prompts and instructions, over stateless
  /// streamable HTTP. Map it with <see cref="BlokMcpEndpointRouteBuilderExtensions.MapBlokMcp"/>.
  /// </summary>
  /// <param name="services">The service collection.</param>
  /// <param name="configure">Sets the document source and access rules.</param>
  /// <returns>The same collection, for chaining.</returns>
  public static IServiceCollection AddBlokMcp(this IServiceCollection services, Action<BlokMcpOptions> configure)
  {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(configure);
    var options = new BlokMcpOptions();

    configure(options);
    // The host's rules see the signed-in user, not one made from the principal.
    services.AddHttpContextAccessor();
    services.TryAddSingleton(_ => new McpHttpCaller());
    // Its own runtime, not the app's IBlokRuntime: MCP batches need a larger allocation budget.
    services.TryAddSingleton(provider => new BlokMcpHost(new McpBundle(BlokMcpHost.Runtime()), provider.GetRequiredService<McpHttpCaller>()));
    services.TryAddSingleton(provider => ConfigOf(options, provider));
    // The CLI stops the core on ApplicationStopping itself.
    services.AddHostedService<McpDrain>();

    return services.AddBlokMcpServer(options.OAuth is not null);
  }

  /// <summary>The tool's registration: the host and config it already built.</summary>
  internal static IServiceCollection AddBlokMcpServer(this IServiceCollection services, BlokMcpHost host, McpConfig config)
  {
    services.TryAddSingleton(host);
    services.TryAddSingleton(config);

    return services.AddBlokMcpServer(config.OAuth is not null);
  }

  // The bearer scheme only with OAuth: as an app's only scheme it would become its default.
  private static IServiceCollection AddBlokMcpServer(this IServiceCollection services, bool oauth)
  {
    services.TryAddSingleton(provider =>
    {
      var host = provider.GetRequiredService<BlokMcpHost>();

      return new McpServerCore(host.Bundle, provider.GetRequiredService<McpConfig>(), host.Http);
    });
    services.TryAddSingleton<McpSurfaceCache>();
    services.AddMcpServer().WithHttpTransport(transport =>
    {
      transport.SessionMode = HttpServerSessionMode.Stateless;
      transport.ConfigureSessionOptions = async (context, options, cancellationToken) =>
      {
        var core = context.RequestServices.GetRequiredService<McpServerCore>();
        var surface = await context.RequestServices.GetRequiredService<McpSurfaceCache>().GetAsync(cancellationToken);
        var who = IdentityOf(context.User, core.Config);

        McpSdkServer.Configure(options, surface, core, _ => who);
      };
    });
    if (!oauth)
    {
      return services;
    }
    services.AddOptions<JwtBearerOptions>(BlokMcpBearer.Scheme).Configure<McpConfig, BlokMcpHost>((bearer, config, host) =>
    {
      if (config.OAuth is McpOAuth settings)
      {
        BlokMcpBearer.Configure(bearer, new AccessTokenVerifier(settings.Issuer, settings.Audience, token => FetchJwksAsync(host.Http, settings.JwksUrl, token)), settings);
      }
    });
    services.AddAuthentication().AddJwtBearer(BlokMcpBearer.Scheme, _ => { });
    services.AddAuthorizationBuilder().AddPolicy(BlokMcpBearer.ReadPolicy, policy => policy
        .AddAuthenticationSchemes(BlokMcpBearer.Scheme)
        .RequireClaim(BlokMcpBearer.ScopeClaim, "blok.read"));

    return services;
  }

  private static async Task<string?> FetchJwksAsync(McpHttpCaller http, string url, CancellationToken cancellationToken)
  {
    // Each request waits on this fetch; a hung issuer must not hold requests open.
    var response = await http.SendAsync(new McpHttpRequest("GET", url, []), TimeSpan.FromSeconds(10), cancellationToken);

    return response.Status is >= 200 and <= 299 ? response.Body : null;
  }

  private static McpCallerIdentity IdentityOf(ClaimsPrincipal user, McpConfig config)
  {
    if (BlokMcpBearer.Identity(user) is var (principal, scopes))
    {
      return new McpCallerIdentity(principal, scopes);
    }

    return new McpCallerIdentity(HostUserName(user) ?? config.PrincipalOrDefault, null);
  }

  /// <summary>The name of a user the host's own auth signed in; null for an anonymous or a Blok bearer caller.</summary>
  internal static string? HostUserName(ClaimsPrincipal? user)
  {
    return user?.Identity?.IsAuthenticated == true && BlokMcpBearer.Identity(user) is null
        ? user.FindFirst("sub")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value
        : null;
  }

  /// <summary>A user the host's auth signed in without a sub or NameIdentifier, who would share the anonymous principal's handles.</summary>
  internal static bool IsUnnamedHostUser(ClaimsPrincipal? user)
  {
    return user?.Identity?.IsAuthenticated == true && BlokMcpBearer.Identity(user) is null && HostUserName(user) is null;
  }

  // The app's logging, so a hook failure the agent sees only in part is kept in full.
  private static Action<string, Exception>? LogErrorOf(IServiceProvider provider)
  {
    var logger = provider.GetService<Microsoft.Extensions.Logging.ILoggerFactory>()?.CreateLogger("Blok.Server.Mcp");

    return logger is null ? null : (message, error) => HookFailed(logger, message, error);
  }

  private static readonly Action<Microsoft.Extensions.Logging.ILogger, string, Exception?> HookFailed =
      Microsoft.Extensions.Logging.LoggerMessage.Define<string>(Microsoft.Extensions.Logging.LogLevel.Error, new Microsoft.Extensions.Logging.EventId(1, "HookFailed"), "{Message}");

  private static McpConfig ConfigOf(BlokMcpOptions options, IServiceProvider provider)
  {
    var authorize = options.Authorize;
    var rules = provider.GetService<IBlokAuthorization>();
    McpAuthorize? hook = authorize is not null
        ? async (principal, documentId, write, token) => await authorize(new BlokMcpAccessRequest(principal, documentId, write), token)
        : rules is not null ? (principal, documentId, write, token) => AllowedByRulesAsync(rules, provider.GetService<IHttpContextAccessor>(), principal, documentId, write, token) : null;

    var source = options.FilesDirectory is not null || options.DocumentEndpoint is not null;
    // As Node's hostDecides: the host's ticket route decides when there is no source.
    var hostDecides = options.TicketUrl is not null && !source;

    if (options.SyncUrl is not null && options.LiveRooms)
    {
      throw new InvalidOperationException("Set BlokMcpOptions.SyncUrl or LiveRooms, not both.");
    }
    if (options.PageTitles is not null and not "off" and not "page-map")
    {
      throw new InvalidOperationException($"BlokMcpOptions.PageTitles must be \"off\" or \"page-map\", got \"{options.PageTitles}\"");
    }
    // Node's checkOptionSafety over HTTP: OAuth says who calls, not which documents they may open.
    if (hook is null && !hostDecides && !options.AllowEveryCallerEveryDocument)
    {
      throw new InvalidOperationException(
          "Blok's MCP endpoint needs a per-document check: set BlokMcpOptions.Authorize or register IBlokAuthorization. "
          + "To let every caller reach every document, set BlokMcpOptions.AllowEveryCallerEveryDocument.");
    }
    var host = provider.GetRequiredService<BlokMcpHost>();

    CheckOptions(host, options, hook is not null);

    return new McpConfig
    {
      PageTitles = options.PageTitles,
      Manifest = options.Manifest is { } manifest ? ConfigFile(host, "manifest", manifest) : null,
      Overrides = options.Overrides is { } overrides ? ConfigFile(host, "overrides", overrides) : null,
      Sync = options.SyncUrl is { } sync ? new McpSync(sync.OriginalString, options.SyncOrigin) : null,
      Tickets = TicketsOf(options),
      AgentActor = options.AgentActor is { } actor ? (principal, clientName) => ActorJson(actor(principal, clientName)) : null,
      Gate = new McpCallerGate(options.AllowedOrigins?.ToArray(), options.AllowedHosts?.ToArray(), options.TrustRemoteCallers),
      Source = options.FilesDirectory is string dir
          ? new McpSourceConfig.Files(dir)
          : options.DocumentEndpoint is Uri endpoint
              ? new McpSourceConfig.Endpoint(endpoint.OriginalString, options.DocumentEndpointAuthorization, options.DocumentListEndpoint?.OriginalString)
              : null,
      OAuth = options.OAuth is { } oauth ? new McpOAuth(oauth.Issuer, oauth.Audience, oauth.JwksUri.OriginalString) : null,
      Principal = options.Principal,
      Schema = options.Schema,
      HandleIdleMs = options.HandleIdleTimeout?.TotalMilliseconds,
      MaxHandlesPerPrincipal = options.MaxHandlesPerPrincipal,
      Comments = options.Comments ? null : false,
      Uploads = options.Uploads,
      LogError = LogErrorOf(provider),
      RichTextFields = options.RichTextFields is { } fields
          ? new JsonObject(fields.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)new JsonArray([.. pair.Value.Select(name => (JsonNode)name)]))))
          : null,
      Authorize = hook,
      Rooms = options.LiveRooms ? RoomsOf(provider) : null,
    };
  }

  private static McpTickets? TicketsOf(BlokMcpOptions options)
  {
    return options.TicketUrl is { } url
        ? new McpTickets.Url(url.OriginalString, options.TicketHostToken ?? string.Empty)
        : options.TicketSecret is { } secret ? new McpTickets.Secret(secret) : null;
  }

  private static JsonObject ActorJson(BlokMcpAgentActor actor)
  {
    var json = new JsonObject { ["id"] = actor.Id, ["name"] = actor.Name, ["kind"] = "agent" };

    if (actor.OnBehalfOf is not null)
    {
      json["onBehalfOf"] = actor.OnBehalfOf;
    }
    if (actor.Color is not null)
    {
      json["color"] = actor.Color;
    }

    return json;
  }

  // As the CLI checks a --manifest or --manifest-overrides file.
  private static JsonNode? ConfigFile(BlokMcpHost host, string kind, JsonObject value)
  {
    var checkedFile = host.Bundle.CallAsync("mcpConfigFile", new JsonObject { ["kind"] = kind, ["value"] = value.DeepClone() }).GetAwaiter().GetResult();

    return McpJson.String(checkedFile["error"]) is string refused
        ? throw new InvalidOperationException(refused)
        : checkedFile["value"]?.DeepClone();
  }

  // The rest of Node's checks (uploads, tickets, sync), run by the same bundle the CLI uses.
  private static void CheckOptions(BlokMcpHost host, BlokMcpOptions options, bool authorize)
  {
    var check = new JsonObject
    {
      ["transport"] = new JsonObject { ["kind"] = "http", ["listen"] = "127.0.0.1:0" },
      ["auth"] = new JsonObject { ["kind"] = options.OAuth is null ? "none" : "oauth" },
    };

    // The per-document refusal above is the library's own; only a real hook counts for a secret.
    if (authorize || options.AllowEveryCallerEveryDocument || (options.TicketUrl is not null && options.FilesDirectory is null && options.DocumentEndpoint is null))
    {
      check["authorize"] = true;
    }
    if (options.FilesDirectory is not null || options.DocumentEndpoint is not null)
    {
      check["source"] = new JsonObject { ["kind"] = options.FilesDirectory is not null ? "files" : "endpoint" };
    }
    if (options.SyncUrl is { } sync)
    {
      check["sync"] = new JsonObject { ["url"] = sync.OriginalString };
    }
    if (TicketsOf(options) is { } tickets)
    {
      check["tickets"] = tickets is McpTickets.Url url
          ? new JsonObject { ["kind"] = "url", ["url"] = url.Endpoint, ["hostToken"] = url.HostToken }
          : new JsonObject { ["kind"] = "secret", ["secret"] = "set" };
    }

    if (options.Uploads is { } uploads)
    {
      var limits = new JsonObject();

      foreach (var (kind, limit) in uploads.Limits ?? new Dictionary<string, BlokMcpUploadLimits>())
      {
        var entry = new JsonObject();

        if (limit.Types is { } types)
        {
          entry["types"] = new JsonArray([.. types.Select(type => (JsonNode)type)]);
        }
        if (limit.MaxSize is long max)
        {
          entry["maxSize"] = max;
        }
        limits[kind] = entry;
      }
      check["uploads"] = new JsonObject { ["uploadByFile"] = true, ["limits"] = limits };
    }
    var safety = host.Bundle.CallAsync("mcpCheckOptions", new JsonObject { ["options"] = check }).GetAwaiter().GetResult();

    if (McpJson.String(safety["error"]) is string refused)
    {
      throw new InvalidOperationException(refused);
    }
  }

  private static Blok.Server.Agent.BlokAgentExecutor RoomsOf(IServiceProvider provider)
  {
    return provider.GetService<Blok.Server.Agent.IBlokAgentExecutor>() is Blok.Server.Agent.BlokAgentExecutor { HasRooms: true } rooms
        ? rooms
        : throw new InvalidOperationException("BlokMcpOptions.LiveRooms needs AddBlokServer with CollabEnabled, so the app hosts the rooms.");
  }

  // IBlokAuthorization only narrows: a write also needs read.
  private static async Task<bool> AllowedByRulesAsync(
      IBlokAuthorization rules, IHttpContextAccessor? http, string principal, string documentId, bool write, CancellationToken cancellationToken)
  {
    var signedIn = http?.HttpContext?.User;
    var user = HostUserName(signedIn) == principal
        ? signedIn!
        : new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", principal), new Claim(ClaimTypes.NameIdentifier, principal)], "blok-mcp"));

    return await rules.CanReadDocumentAsync(user, documentId, cancellationToken)
        && (!write || await rules.CanWriteDocumentAsync(user, documentId, cancellationToken));
  }
}

/// <summary>Maps Blok's MCP endpoint.</summary>
public static class BlokMcpEndpointRouteBuilderExtensions
{
  /// <summary>
  /// Maps the MCP endpoint at <paramref name="pattern"/>: POST serves MCP, GET and DELETE
  /// answer 405, and a body over 4 MiB answers 413. With OAuth configured, every request
  /// needs a Blok bearer token with the blok.read scope; add UseAuthentication and
  /// UseAuthorization to the pipeline. OAuth also maps GET /.well-known/oauth-protected-resource,
  /// which the 401's WWW-Authenticate names.
  /// </summary>
  /// <param name="endpoints">The route builder.</param>
  /// <param name="pattern">The route, <c>/mcp</c> by default.</param>
  /// <returns>The endpoint builder, for more conventions.</returns>
  public static IEndpointConventionBuilder MapBlokMcp(this IEndpointRouteBuilder endpoints, string pattern = "/mcp")
  {
    ArgumentNullException.ThrowIfNull(endpoints);
    var mapped = endpoints.MapGroup(pattern);

    mapped.MapMcp(string.Empty);
    // Node's SDK answers these itself; the C# SDK maps no GET or DELETE when stateless.
    mapped.MapMethods(string.Empty, [HttpMethods.Get, HttpMethods.Delete], _ => Task.CompletedTask);
    ((IEndpointConventionBuilder)mapped).Add(endpoint =>
    {
      var inner = endpoint.RequestDelegate;

      if (inner is not null)
      {
        endpoint.RequestDelegate = context => McpRequestGate.InvokeAsync(context, inner);
      }
    });
    var config = endpoints.ServiceProvider.GetRequiredService<McpConfig>();

    if (config.OAuth is McpOAuth oauth)
    {
      mapped.RequireAuthorization(BlokMcpBearer.ReadPolicy);
      // The CLI's guard answers it before routing.
      if (config.Gate is not null)
      {
        endpoints.MapGet(McpHttpGuard.MetadataPath, context => McpHttpGuard.WriteMetadataAsync(context.Response, oauth));
      }
    }

    return mapped;
  }
}

/// <summary>The SDK surface, built once from the bundle on first use; only a success is kept.</summary>
internal sealed class McpSurfaceCache(McpServerCore core) : IDisposable
{
  private readonly SemaphoreSlim gate = new(1, 1);
  private McpSdkSurface? surface;

  internal async Task<McpSdkSurface> GetAsync(CancellationToken cancellationToken)
  {
    if (surface is not null)
    {
      return surface;
    }
    await gate.WaitAsync(cancellationToken);
    try
    {
      return surface ??= await McpSdkServer.PrepareAsync(core, cancellationToken);
    }
    finally
    {
      gate.Release();
    }
  }

  public void Dispose()
  {
    gate.Dispose();
  }
}

/// <summary>
/// Stops the core when the app stops, before the server does: calls in flight finish and
/// answer, and handles close, as blok-mcp's stop drains them.
/// </summary>
internal sealed class McpDrain(IServiceProvider services) : Microsoft.Extensions.Hosting.IHostedService
{
  public Task StartAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }

  public Task StopAsync(CancellationToken cancellationToken)
  {
    return services.GetRequiredService<McpServerCore>().StopAsync().WaitAsync(cancellationToken);
  }
}
