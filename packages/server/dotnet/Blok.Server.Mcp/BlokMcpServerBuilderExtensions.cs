using System.Security.Claims;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp;

/// <summary>Adds Blok's MCP tools to an MCP server the host builds itself.</summary>
public static class BlokMcpServerBuilderExtensions
{
  /// <summary>
  /// Serves Blok's tools and prompts on the host's own MCP server, next to the host's own tools,
  /// prompts and auth. Blok never sets the server's name, instructions or handlers: put
  /// <see cref="IBlokMcp.GetInstructionsAsync"/> into your own instructions. A host tool or prompt
  /// with one of Blok's names stops the app at start (and on a list, for a list handler's tools).
  /// The caller is the signed-in user (<c>sub</c>, else <c>NameIdentifier</c>), or
  /// <see cref="BlokMcpOptions.Caller"/>; anonymous callers are refused unless
  /// <see cref="BlokMcpOptions.AnonymousPrincipal"/> is set. The per-document check
  /// (<see cref="BlokMcpOptions.Authorize"/> or IBlokAuthorization) is required as for AddBlokMcp.
  /// Stateless HTTP is the supported transport.
  /// </summary>
  /// <param name="builder">The host's MCP server builder.</param>
  /// <param name="configure">The same options as AddBlokMcp, except its own OAuth, principal and endpoint guards.</param>
  /// <returns>The same builder, for chaining.</returns>
  public static IMcpServerBuilder WithBlok(this IMcpServerBuilder builder, Action<BlokMcpOptions> configure)
  {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentNullException.ThrowIfNull(configure);
    var options = new BlokMcpOptions();

    configure(options);
    CheckEmbedded(options);
    var services = builder.Services;

    // A second call would add a second set of filters, and every tools/list would then clash with itself.
    if (services.Any(service => service.ServiceType == typeof(McpEmbedding)))
    {
      throw new BlokMcpConfigException("WithBlok was already called on this app: call it once");
    }

    services.AddBlokShell(options, embedded: true);
    services.AddSingleton(provider => new McpEmbedding(provider, options));
    services.AddOptions<McpServerOptions>().Configure<McpEmbedding>((server, blok) => blok.Install(server));
    // First, so a clash or a config error stops the app before any transport serves.
    services.Insert(0, ServiceDescriptor.Singleton<IHostedService, McpEmbeddingStart>());

    return builder;
  }

  // As Node's checkEmbedOptions: what only blok-mcp's own server can do is refused, not ignored.
  private static void CheckEmbedded(BlokMcpOptions options)
  {
    if (options.OAuth is not null)
    {
      throw new BlokMcpConfigException("Blok's own OAuth is for the standalone server (AddBlokMcp); on a host server the host signs callers in (set BlokMcpOptions.Caller to name them)");
    }
    if (options.PrincipalSet)
    {
      throw new BlokMcpConfigException("principal names the standalone caller; on a host server use BlokMcpOptions.Caller, or AnonymousPrincipal");
    }
    if (options.AnonymousPrincipal is "")
    {
      throw new BlokMcpConfigException("AnonymousPrincipal must be a non-empty string");
    }
    if (options.AllowedOrigins is not null || options.AllowedHosts is not null || options.TrustRemoteCallers)
    {
      throw new BlokMcpConfigException(
          "AllowedOrigins, AllowedHosts and TrustRemoteCallers guard MapBlokMcp's own endpoint; on a host server the host checks Origin, Host and who may connect");
    }
  }
}

/// <summary>What a host needs to compose its own MCP server around Blok's tools.</summary>
public interface IBlokMcp
{
  /// <summary>Blok's instructions. Put them into your server's own instructions; Blok never sets them.</summary>
  /// <param name="cancellationToken">Cancels the wait for Blok's start.</param>
  /// <returns>The text standalone blok-mcp sends as its instructions.</returns>
  ValueTask<string> GetInstructionsAsync(CancellationToken cancellationToken = default);

  /// <summary>The tool names Blok serves.</summary>
  /// <param name="cancellationToken">Cancels the wait for Blok's start.</param>
  /// <returns>The names, in Blok's order.</returns>
  ValueTask<IReadOnlyList<string>> GetToolNamesAsync(CancellationToken cancellationToken = default);

  /// <summary>The prompt names Blok serves.</summary>
  /// <param name="cancellationToken">Cancels the wait for Blok's start.</param>
  /// <returns>The names, in Blok's order.</returns>
  ValueTask<IReadOnlyList<string>> GetPromptNamesAsync(CancellationToken cancellationToken = default);

  /// <summary>Blok's version, as blok-mcp names it in its serverInfo.</summary>
  /// <param name="cancellationToken">Cancels the wait for Blok's start.</param>
  /// <returns>The version.</returns>
  ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default);

  /// <summary>Waits for Blok's calls in flight and closes every handle. The app's stop does it too.</summary>
  /// <returns>When done.</returns>
  Task StopAsync();
}

/// <summary>IBlokMcp over the shell and its surface; each call waits until Blok is ready.</summary>
internal sealed class BlokMcp(IServiceProvider services) : IBlokMcp
{
  private async ValueTask<McpSdkSurface> SurfaceAsync(CancellationToken cancellationToken)
  {
    // On blok-mcp's own server there is no embedding to check names against.
    return services.GetService<McpEmbedding>() is { } embedding
        ? await embedding.ReadyAsync(cancellationToken)
        : await services.GetRequiredService<McpSurfaceCache>().GetAsync(cancellationToken);
  }

  public async ValueTask<string> GetInstructionsAsync(CancellationToken cancellationToken = default)
  {
    return (await SurfaceAsync(cancellationToken)).Instructions ?? string.Empty;
  }

  public async ValueTask<IReadOnlyList<string>> GetToolNamesAsync(CancellationToken cancellationToken = default)
  {
    return [.. (await SurfaceAsync(cancellationToken)).Tools.Select(tool => tool.Name)];
  }

  public async ValueTask<IReadOnlyList<string>> GetPromptNamesAsync(CancellationToken cancellationToken = default)
  {
    return [.. (await SurfaceAsync(cancellationToken)).Prompts.Select(prompt => prompt.Name)];
  }

  public async ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default)
  {
    return (await SurfaceAsync(cancellationToken)).Version;
  }

  public Task StopAsync()
  {
    return services.GetRequiredService<McpServerCore>().StopAsync();
  }
}

/// <summary>Blok on a host's server: the filters each server build gets, and the start check.</summary>
internal sealed class McpEmbedding(IServiceProvider services, BlokMcpOptions options)
{
  private const string Anonymous = "Blok needs a signed-in caller.";
  private const string Unnamed = "Blok needs a named caller (sub or NameIdentifier).";

  private readonly object gate = new();
  private Task<McpSdkSurface>? ready;

  /// <summary>
  /// The config, the shell and the surface, once; then the host's DI tools and prompts checked
  /// against Blok's names, since the SDK would keep only the first of two.
  /// </summary>
  internal Task<McpSdkSurface> ReadyAsync(CancellationToken cancellationToken)
  {
    lock (gate)
    {
      // A failed start (a clash, a config error) fails every later call the same way.
      ready ??= StartAsync();
    }

    return ready.WaitAsync(cancellationToken);
  }

  private async Task<McpSdkSurface> StartAsync()
  {
    await Task.Yield();
    var surface = await services.GetRequiredService<McpSurfaceCache>().GetAsync(CancellationToken.None);
    var taken = services.GetServices<McpServerTool>().Select(tool => tool.ProtocolTool.Name).Where(surface.ToolNames.Contains)
        .Concat(services.GetServices<McpServerPrompt>().Select(prompt => prompt.ProtocolPrompt.Name).Where(surface.PromptNames.Contains))
        .ToList();

    return taken.Count > 0 ? throw new BlokMcpConfigException(McpBlokNames.Clash(taken)) : surface;
  }

  internal void Install(McpServerOptions server)
  {
    // Tools and prompts are served only when something declares them. The host's objects stay.
    server.Capabilities ??= new ServerCapabilities();
    server.Capabilities.Tools ??= new ToolsCapability();
    server.Capabilities.Prompts ??= new PromptsCapability();
    var config = services.GetRequiredService<McpConfig>();

    McpBlokFilters? filters = null;

    filters = new McpBlokFilters(
        services.GetRequiredService<McpServerCore>(),
        async token => await ReadyAsync(token),
        (context, token) => IdentifyAsync(filters!, context, token),
        Standalone: false,
        Log: config.LogError);
    filters.Install(server);
  }

  // As Node's createBlok: the host's hook or the signed-in user; anonymous only by opt-in.
  private async ValueTask<McpCallerIdentity> IdentifyAsync(McpBlokFilters filters, RequestContext<CallToolRequestParams> context, CancellationToken cancellationToken)
  {
    BlokMcpCallerIdentity? who;

    try
    {
      who = options.Caller is { } hook ? await hook(context, cancellationToken) : SignedIn(context.User);
    }
    // The hook's own refusal stays as it is; any other throw is logged, and the client sees fixed words.
    catch (Exception error) when (error is not McpProtocolException and not OperationCanceledException)
    {
      throw await filters.FailedAsync(error);
    }

    if (who is null)
    {
      return options.AnonymousPrincipal is { } anonymous
          ? new McpCallerIdentity(anonymous, null)
          : throw new McpProtocolException(Anonymous, McpErrorCode.InvalidRequest);
    }

    // The host owns auth: no Blok scope checks unless its hook names scopes.
    return string.IsNullOrEmpty(who.Principal)
        ? throw new McpProtocolException(Unnamed, McpErrorCode.InvalidRequest)
        : new McpCallerIdentity(who.Principal, who.Scopes);
  }

  private static BlokMcpCallerIdentity? SignedIn(ClaimsPrincipal? user)
  {
    return user?.Identity?.IsAuthenticated == true
        ? new BlokMcpCallerIdentity(user.FindFirst("sub")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value)
        : null;
  }
}

/// <summary>Checks Blok's config and names before any transport serves.</summary>
internal sealed class McpEmbeddingStart(McpEmbedding embedding) : IHostedService
{
  public Task StartAsync(CancellationToken cancellationToken)
  {
    return embedding.ReadyAsync(cancellationToken);
  }

  public Task StopAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }
}
