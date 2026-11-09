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
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
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
    CheckStandalone(options);
    services.AddBlokShell(options, embedded: false);

    return services.AddBlokMcpServer(options.OAuth is not null);
  }

  // As WithBlok refuses the standalone-only options: an ignored Caller would answer every caller it names 401.
  private static void CheckStandalone(BlokMcpOptions options)
  {
    if (options.Caller is not null)
    {
      throw new BlokMcpConfigException("BlokMcpOptions.Caller works only on a host's server (WithBlok); AddBlokMcp names callers from its own sign-in and Principal");
    }
    if (options.AnonymousPrincipal is not null)
    {
      throw new BlokMcpConfigException("BlokMcpOptions.AnonymousPrincipal works only on a host's server (WithBlok); AddBlokMcp serves anonymous callers as Principal");
    }
  }

  /// <summary>
  /// What blok-mcp's own server and a host's server (WithBlok) share: the runtime, the config
  /// from <paramref name="options"/>, the shell, the surface, IBlokMcp and the drain on stop.
  /// </summary>
  internal static void AddBlokShell(this IServiceCollection services, BlokMcpOptions options, bool embedded)
  {
    // The host's rules see the signed-in user, not one made from the principal.
    services.AddHttpContextAccessor();
    if (options.CommandLineHost is { } parsed)
    {
      // The runtime BlokMcpCommandLine already started, and the HTTP caller its --authorize webhook uses.
      // A factory, not an instance: the container disposes only what a factory made.
      services.TryAddSingleton(_ => parsed.Http);
      services.TryAddSingleton(parsed);
    }
    services.TryAddSingleton(_ => new McpHttpCaller());
    // Its own runtime, not the app's IBlokRuntime: MCP batches need a larger allocation budget.
    services.TryAddSingleton(provider => new BlokMcpHost(new McpBundle(BlokMcpHost.Runtime()), provider.GetRequiredService<McpHttpCaller>()));
    services.TryAddSingleton(provider => ConfigOf(options, provider, embedded));
    // The CLI stops the core on ApplicationStopping itself.
    services.AddHostedService<McpDrain>();
    services.AddBlokCore();
  }

  private static void AddBlokCore(this IServiceCollection services)
  {
    services.TryAddSingleton(provider =>
    {
      var host = provider.GetRequiredService<BlokMcpHost>();

      return new McpServerCore(host.Bundle, provider.GetRequiredService<McpConfig>(), host.Http);
    });
    services.TryAddSingleton<McpSurfaceCache>();
    services.TryAddSingleton<IBlokMcp, BlokMcp>();
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
    services.AddBlokCore();
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
    DecorateAuthorizationResults(services);

    return services;
  }

  // The app's own result handler, if it registered one first, stays the inner one.
  private static void DecorateAuthorizationResults(IServiceCollection services)
  {
    var existing = services.LastOrDefault(service => service.ServiceType == typeof(IAuthorizationMiddlewareResultHandler));
    Func<IServiceProvider, IAuthorizationMiddlewareResultHandler> inner = existing switch
    {
      { ImplementationInstance: IAuthorizationMiddlewareResultHandler instance } => _ => instance,
      { ImplementationFactory: { } factory } => provider => (IAuthorizationMiddlewareResultHandler)factory(provider),
      { ImplementationType: { } type } => provider => (IAuthorizationMiddlewareResultHandler)ActivatorUtilities.CreateInstance(provider, type),
      _ => _ => new AuthorizationMiddlewareResultHandler(),
    };

    if (existing is not null)
    {
      services.Remove(existing);
    }
    services.AddSingleton<IAuthorizationMiddlewareResultHandler>(provider => new McpOriginFirst(inner(provider)));
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

  internal static McpConfig ConfigOf(BlokMcpOptions options, IServiceProvider provider, bool embedded = false)
  {
    try
    {
      return ConfigOf(options, provider, embedded ? EmbeddedCheckMessage : null);
    }
    // A host's server starts with Blok's config errors, as Node's createBlok throws McpConfigError.
    catch (InvalidOperationException error) when (embedded)
    {
      throw new BlokMcpConfigException(error.Message, error);
    }
  }

  private const string EmbeddedCheckMessage =
      "Blok on a host server needs a per-document check: set BlokMcpOptions.Authorize or register IBlokAuthorization, "
      + "or serve live rooms only with TicketUrl and no document source. To let every caller reach every document, set BlokMcpOptions.AllowEveryCallerEveryDocument.";

  private static McpConfig ConfigOf(BlokMcpOptions options, IServiceProvider provider, string? checkMessage)
  {
    var authorize = options.Authorize;
    var rules = provider.GetService<IBlokAuthorization>();
    McpAuthorize? hook = authorize is not null
        ? async (principal, documentId, write, token) => await authorize(new BlokMcpAccessRequest(principal, documentId, write), token)
        : rules is not null ? (principal, documentId, write, token) => AllowedByRulesAsync(rules, provider.GetService<IHttpContextAccessor>(), options.Caller is not null && principal != options.AnonymousPrincipal, principal, documentId, write, token) : null;

    if (options.DocumentSource is not null && (options.FilesDirectory is not null || options.DocumentEndpoint is not null))
    {
      throw new InvalidOperationException("Set one document source: DocumentSource, FilesDirectory or DocumentEndpoint.");
    }
    // A host's own store is a source too: with it, a ticket route alone checks nothing per document.
    var source = HasSource(options);
    // As Node's hostDecides: the host's ticket route decides when there is no source.
    var hostDecides = options.TicketUrl is not null && !source;

    if (options.SyncUrl is not null && options.LiveRooms)
    {
      throw new InvalidOperationException("Set BlokMcpOptions.SyncUrl or LiveRooms, not both.");
    }
    // The creator replaces only the stored create, so a room would still make Blok's own pages.
    if (options.PageCreator is not null && options.LiveRooms)
    {
      throw new InvalidOperationException("BlokMcpOptions.PageCreator works in stored mode only: it cannot be used with LiveRooms.");
    }
    // Node's checkOptionSafety over HTTP: OAuth says who calls, not which documents they may open.
    if (hook is null && !hostDecides && !options.AllowEveryCallerEveryDocument)
    {
      throw new InvalidOperationException(checkMessage ??
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
              : options.DocumentSource is { } custom ? new McpSourceConfig.Custom(custom) : null,
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
      PageCreator = options.PageCreator,
      HandleStore = options.HandleStore,
      Rooms = options.LiveRooms ? RoomsOf(provider) : null,
    };
  }

  private static bool HasSource(BlokMcpOptions options)
  {
    return options.FilesDirectory is not null || options.DocumentEndpoint is not null || options.DocumentSource is not null;
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

    // The per-document check already passed above: a hook, AllowEveryCallerEveryDocument, or a
    // ticket route with no source each stand for Node's --authorize here.
    if (authorize || options.AllowEveryCallerEveryDocument || (options.TicketUrl is not null && !HasSource(options)))
    {
      check["authorize"] = true;
    }
    if (HasSource(options))
    {
      check["source"] = new JsonObject { ["kind"] = options.FilesDirectory is not null ? "files" : options.DocumentEndpoint is not null ? "endpoint" : "custom" };
    }
    if (options.SyncUrl is { } sync)
    {
      check["sync"] = new JsonObject { ["url"] = sync.OriginalString };
    }
    if (options.PageCreator is not null)
    {
      check["createPage"] = true;
    }
    // No handleStore here: that check only looks for the store's functions, which IBlokMcpHandleStore guarantees.
    // Node's names: the shared check words its refusal with them.
    if (options.Schema is { } schema)
    {
      check["schema"] = schema;
    }
    if (options.PageTitles is { } pageTitles)
    {
      check["pageTitles"] = pageTitles;
    }
    if (options.HandleIdleTimeout is { } idle)
    {
      check["handleIdleMs"] = idle.TotalMilliseconds;
    }
    if (options.MaxHandlesPerPrincipal is int maxHandles)
    {
      check["maxHandlesPerPrincipal"] = maxHandles;
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
      IBlokAuthorization rules, IHttpContextAccessor? http, bool callerHook, string principal, string documentId, bool write, CancellationToken cancellationToken)
  {
    var signedIn = http?.HttpContext?.User;
    // The host's Caller hook named this request's user from claims Blok cannot read (such as a
    // custom id claim), so the rules get that user as signed in, with every claim. Not when the
    // hook named nobody and the call runs as AnonymousPrincipal.
    var user = (callerHook && signedIn?.Identity?.IsAuthenticated == true) || HostUserName(signedIn) == principal
        ? signedIn!
        : new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", principal), new Claim(ClaimTypes.NameIdentifier, principal)], "blok-mcp"));

    return await rules.CanReadDocumentAsync(user, documentId, cancellationToken)
        && (!write || await rules.CanWriteDocumentAsync(user, documentId, cancellationToken));
  }
}

/// <summary>Marks the endpoints MapBlokMcp maps.</summary>
internal sealed class McpEndpointMarker;

/// <summary>
/// Node checks Origin and Host before the token, so a refused page gets 403 even with no
/// token. ASP.NET's authorization runs before the endpoint's gate; this runs the check first.
/// </summary>
internal sealed class McpOriginFirst(IAuthorizationMiddlewareResultHandler inner) : IAuthorizationMiddlewareResultHandler
{
  public Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
  {
    if (!authorizeResult.Succeeded && context.GetEndpoint()?.Metadata.GetMetadata<McpEndpointMarker>() is not null
        && context.RequestServices.GetService<McpConfig>() is { Gate: { } gate } && !McpRequestGate.Admits(gate, context.Request))
    {
      context.Response.StatusCode = StatusCodes.Status403Forbidden;

      return Task.CompletedTask;
    }

    return inner.HandleAsync(next, context, policy, authorizeResult);
  }
}

/// <summary>Maps Blok's MCP endpoint.</summary>
public static class BlokMcpEndpointRouteBuilderExtensions
{
  /// <summary>
  /// Maps the MCP endpoint at <paramref name="pattern"/>: POST serves MCP, every other method
  /// answers 405, and a body over 4 MiB answers 413. With OAuth configured, every request
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
    mapped.WithMetadata(new McpEndpointMarker());
    // Node's SDK answers every other method 405 itself; the C# SDK maps only POST when stateless.
    mapped.MapMethods(
        string.Empty,
        [HttpMethods.Get, HttpMethods.Delete, HttpMethods.Put, HttpMethods.Patch, HttpMethods.Head, HttpMethods.Options, HttpMethods.Trace],
        _ => Task.CompletedTask);
    ((IEndpointConventionBuilder)mapped).Add(endpoint =>
    {
      var inner = endpoint.RequestDelegate;

      if (inner is not null)
      {
        endpoint.RequestDelegate = context => McpRequestGate.InvokeAsync(context, inner);
      }
    });
    // Routing would answer a wrong Content-Type 415 with no body; the gate answers it as Node.
    // Finally: the SDK's own Accepts metadata is added by a later convention.
    ((IEndpointConventionBuilder)mapped).Finally(endpoint =>
    {
      foreach (var accepts in endpoint.Metadata.OfType<Microsoft.AspNetCore.Http.Metadata.IAcceptsMetadata>().ToList())
      {
        endpoint.Metadata.Remove(accepts);
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
