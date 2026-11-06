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
    services.TryAddSingleton(_ => new McpHttpCaller());
    // Its own runtime, not the app's IBlokRuntime: MCP batches need a larger allocation budget.
    services.TryAddSingleton(provider => new BlokMcpHost(new McpBundle(BlokMcpHost.Runtime()), provider.GetRequiredService<McpHttpCaller>()));
    services.TryAddSingleton(provider => ConfigOf(options, provider));

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
    var named = user.Identity?.IsAuthenticated == true
        ? user.FindFirst("sub")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value
        : null;

    return new McpCallerIdentity(named ?? config.PrincipalOrDefault, null);
  }

  private static McpConfig ConfigOf(BlokMcpOptions options, IServiceProvider provider)
  {
    var authorize = options.Authorize;
    var rules = provider.GetService<IBlokAuthorization>();
    McpAuthorize? hook = authorize is not null
        ? async (principal, documentId, write, token) => await authorize(new BlokMcpAccessRequest(principal, documentId, write), token)
        : rules is not null ? (principal, documentId, write, token) => AllowedByRulesAsync(rules, principal, documentId, write, token) : null;

    return new McpConfig
    {
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
      RichTextFields = options.RichTextFields is { } fields
          ? new JsonObject(fields.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)new JsonArray([.. pair.Value.Select(name => (JsonNode)name)]))))
          : null,
      Authorize = hook,
      Rooms = options.LiveRooms ? RoomsOf(provider) : null,
    };
  }

  private static Blok.Server.Agent.BlokAgentExecutor RoomsOf(IServiceProvider provider)
  {
    return provider.GetService<Blok.Server.Agent.IBlokAgentExecutor>() is Blok.Server.Agent.BlokAgentExecutor { HasRooms: true } rooms
        ? rooms
        : throw new InvalidOperationException("BlokMcpOptions.LiveRooms needs AddBlokServer with CollabEnabled, so the app hosts the rooms.");
  }

  // IBlokAuthorization only narrows: a write also needs read.
  private static async Task<bool> AllowedByRulesAsync(IBlokAuthorization rules, string principal, string documentId, bool write, CancellationToken cancellationToken)
  {
    var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", principal), new Claim(ClaimTypes.NameIdentifier, principal)], "blok-mcp"));

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
  /// UseAuthorization to the pipeline.
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
    if (endpoints.ServiceProvider.GetRequiredService<McpConfig>().OAuth is not null)
    {
      mapped.RequireAuthorization(BlokMcpBearer.ReadPolicy);
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
