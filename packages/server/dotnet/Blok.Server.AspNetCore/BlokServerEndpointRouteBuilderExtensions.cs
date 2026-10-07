using System.Text.Json;
using Blok.Server.AspNetCore.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Blok.Server.AspNetCore;

/// <summary>Maps the Blok server's HTTP and WebSocket routes into an application.</summary>
public static class BlokServerEndpointRouteBuilderExtensions
{
  private static readonly (string Method, string Pattern)[] HistoryRoutes =
  [
    ("GET", "/sync/{doc}/history"),
    ("GET", "/sync/{doc}/history/{lineage}/{sequence}"),
    ("DELETE", "/sync/{doc}/history/{lineage}"),
    ("POST", "/sync/{doc}/history/{lineage}/{sequence}/restore"),
    ("GET", "/sync/{doc}/history/{lineage}/{sequence}/changes"),
  ];

  // {Sync} to {State} shipped in 1.16.1 and are kept as fields; the history
  // routes share one, since LoggerMessage.Define takes at most six.
  private static readonly Action<ILogger, string, string, string, string, string, Exception?> LogOpenSyncRoutes =
      LoggerMessage.Define<string, string, string, string, string>(
          LogLevel.Warning,
          new EventId(2, "CollabOpen"),
          "collab: no IBlokAuthorization is registered and Auth is \"none\", so {Sync}, {Reset}, {Edit}, {State} and {History} " +
          "are open to anyone who can reach this app unless the mapped group has RequireAuthorization(); " +
          "register a hook with AddBlokServer(...).UseAuthorization<T>() or set Auth to \"ticket\"");

  /// <summary>
  /// Maps <c>/health</c> plus whatever the options switch on: the upload
  /// routes when storage is configured, the unfurl routes unless they are
  /// closed, and <c>/sync/{doc}</c> with its reset, edit, state and history
  /// routes when collaboration is on.
  /// </summary>
  /// <remarks>
  /// Everything the group does not claim answers 404, so the group must not be
  /// mapped at a pattern that shares a prefix with the application's own
  /// routes.
  /// <para>
  /// The returned group carries no authorization of its own. Call
  /// <c>RequireAuthorization()</c> on it, register an
  /// <see cref="IBlokAuthorization"/>, or run with <c>Auth</c> "ticket" —
  /// with none of the three the document routes are open to every caller that
  /// reaches the app, and a warning says so at startup.
  /// </para>
  /// </remarks>
  /// <param name="endpoints">The application's route builder.</param>
  /// <param name="pattern">
  /// Prefix for the group, empty for the application root. Files uploaded to
  /// local storage are served outside it, from the configured public URL.
  /// </param>
  /// <returns>
  /// The mapped group, so the caller can add conventions —
  /// <c>RequireAuthorization</c>, CORS, rate limiting — to all of it at once.
  /// </returns>
  /// <exception cref="InvalidOperationException">
  /// The registered options are not usable together — see
  /// <see cref="BlokServerOptions.Validate"/>.
  /// </exception>
  public static RouteGroupBuilder MapBlokServer(
      this IEndpointRouteBuilder endpoints,
      string pattern = "")
  {
    ArgumentNullException.ThrowIfNull(endpoints);
    ArgumentNullException.ThrowIfNull(pattern);

    var options = endpoints.ServiceProvider.GetRequiredService<BlokServerOptions>();
    options.Validate();
    LocalFileEndpoint.Map(endpoints, options);
    var routes = endpoints.MapGroup(pattern);

    routes.MapMethods("/health", ["GET", "HEAD"], HandleHealth)
        .AllowAnonymous();
    routes.Map("/health", context => HandleMethodNotAllowed(context, "GET, HEAD"))
        .WithOrder(1)
        .AllowAnonymous();

    if (!options.UnfurlDisabled)
    {
      MapShell(routes, "/unfurl", "GET");
    }

    if (options.HasStorage)
    {
      MapShell(routes, "/upload", "POST");
      MapShell(routes, "/delete", "POST");

      if (!options.UnfurlDisabled)
      {
        MapShell(routes, "/upload-by-url", "POST");
      }
    }

    if (options.CollabEnabled)
    {
      // Not behind Guard: the handshake is its own door (ticket rides in
      // the subprotocol offer). A live socket must outlast any request
      // timeout policy the host installs.
      routes.MapGet("/sync/{doc}", (RequestDelegate)SyncEndpoint.HandleAsync)
          .DisableRequestTimeout();
      routes.Map("/sync/{doc}", context => HandleMethodNotAllowed(context, "GET")).WithOrder(1);
      MapShell(routes, "/sync/{doc}/reset", "POST");
      MapShell(routes, "/sync/{doc}/edit", "POST");
      MapShell(routes, "/sync/{doc}/state", "GET");

      foreach (var (method, history) in HistoryRoutes)
      {
        MapShell(routes, history, method);
      }

      if (options.Auth == "none" &&
          endpoints.ServiceProvider.GetService<IBlokAuthorization>() is null)
      {
        WarnOpenSyncRoutes(endpoints.ServiceProvider, pattern);
      }
    }

    routes.Map("/{**path}", HandleNotFound).WithOrder(int.MaxValue);

    return routes;
  }

  /// <summary>
  /// Its own category, not "Blok.Server.Collab": the standalone host forwards
  /// only that one to stderr, and its none mode is loopback-only by
  /// validation — a check the in-process host never runs, which is the case
  /// this warning exists for.
  /// </summary>
  private static void WarnOpenSyncRoutes(IServiceProvider services, string pattern)
  {
    var logger = services.GetService<ILoggerFactory>()?.CreateLogger("Blok.Server.AspNetCore");

    if (logger is null)
    {
      return;
    }

    LogOpenSyncRoutes(
        logger,
        $"GET {pattern}/sync/{{doc}}",
        $"POST {pattern}/sync/{{doc}}/reset",
        $"POST {pattern}/sync/{{doc}}/edit",
        $"GET {pattern}/sync/{{doc}}/state",
        string.Join(", ", HistoryRoutes.Select(route => $"{route.Method} {pattern}{route.Pattern}")),
        null);
  }

  private static void MapShell(RouteGroupBuilder routes, string pattern, string method)
  {
    RequestDelegate handler = pattern switch
    {
      "/unfurl" => UnfurlEndpoint.HandleAsync,
      "/sync/{doc}/state" => StateEndpoint.HandleAsync,
      "/upload" => UploadEndpoint.HandleAsync,
      "/delete" => DeleteEndpoint.HandleAsync,
      "/sync/{doc}/reset" => ResetEndpoint.HandleAsync,
      "/sync/{doc}/edit" => EditEndpoint.HandleAsync,
      "/sync/{doc}/history" => HistoryEndpoint.ListAsync,
      "/sync/{doc}/history/{lineage}/{sequence}" => HistoryEndpoint.ReadAsync,
      "/sync/{doc}/history/{lineage}" => HistoryEndpoint.DeleteAsync,
      "/sync/{doc}/history/{lineage}/{sequence}/restore" => HistoryEndpoint.RestoreAsync,
      "/sync/{doc}/history/{lineage}/{sequence}/changes" => HistoryEndpoint.ChangesAsync,
      _ => UploadByUrlEndpoint.HandleAsync,
    };

    routes.MapMethods(pattern, [method], Guard(handler, method != "GET"));
    routes.MapMethods(
        pattern,
        ["OPTIONS"],
        context => HandlePreflight(context, method))
        .AllowAnonymous();

    // The sync GET routes map GET only, so they must not advertise HEAD.
    var allowedMethods = method switch
    {
      "POST" => "OPTIONS, POST",
      "GET" when pattern.StartsWith("/sync/", StringComparison.Ordinal) => "GET, OPTIONS",
      "GET" => "GET, HEAD, OPTIONS",
      _ => $"{method}, OPTIONS",
    };
    routes.Map(pattern, context => HandleMethodNotAllowed(context, allowedMethods)).WithOrder(1);
  }

  private static RequestDelegate Guard(
      RequestDelegate next,
      bool requireWrite)
  {
    return async context =>
    {
      var guard = context.RequestServices.GetRequiredService<BlokServerRequestGuard>();

      if (await guard.AllowAsync(context, requireWrite))
      {
        await next(context);
      }
    };
  }

  private static async Task HandlePreflight(
      HttpContext context,
      string method)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var origin = BlokServerCors.RequestOrigin(context.Request);

    if (!BlokServerCors.IsAllowed(origin, options.AllowedOrigins))
    {
      context.Response.StatusCode = StatusCodes.Status403Forbidden;
      context.Response.ContentType = "text/plain; charset=utf-8";
      await context.Response.WriteAsync("origin not allowed\n");

      return;
    }

    context.Response.Headers.AccessControlAllowOrigin = origin;
    context.Response.Headers.AccessControlAllowMethods = $"{method}, OPTIONS";

    var requestedHeaders =
        context.Request.Headers.AccessControlRequestHeaders.FirstOrDefault() ?? "";

    if (requestedHeaders.Length > 0)
    {
      context.Response.Headers.AccessControlAllowHeaders = requestedHeaders;
      context.Response.Headers.Append(
          "Vary",
          "Access-Control-Request-Headers");
    }

    context.Response.Headers.AccessControlMaxAge = "600";
    context.Response.Headers.Append("Vary", "Origin");
    context.Response.StatusCode = StatusCodes.Status204NoContent;
  }

  private static async Task HandleHealth(
      HttpContext context,
      BlokServerOptions options)
  {
    context.Response.ContentType = "application/json";

    if (HttpMethods.IsHead(context.Request.Method))
    {
      return;
    }

    var body = JsonSerializer.Serialize(new { status = "ok", version = options.Version });
    await context.Response.WriteAsync(body + "\n");
  }

  private static async Task HandleMethodNotAllowed(
      HttpContext context,
      string allowedMethods)
  {
    context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
    context.Response.Headers.Allow = allowedMethods;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("Method Not Allowed\n");
  }

  private static async Task HandleNotFound(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("404 page not found\n");
  }
}
