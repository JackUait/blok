using System.Text.Json;
using Blok.Server.AspNetCore.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

public static class BlokServerEndpointRouteBuilderExtensions
{
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

    if (options.HasCollab)
    {
      // Not behind Guard: the handshake is its own door (ticket rides in
      // the subprotocol offer). A live socket must outlast any request
      // timeout policy the host installs.
      routes.MapGet("/sync/{doc}", (RequestDelegate)SyncEndpoint.HandleAsync)
          .DisableRequestTimeout();
      routes.Map("/sync/{doc}", context => HandleMethodNotAllowed(context, "GET")).WithOrder(1);
      MapShell(routes, "/sync/{doc}/reset", "POST");
    }

    routes.Map("/{**path}", HandleNotFound).WithOrder(int.MaxValue);

    return routes;
  }

  private static void MapShell(RouteGroupBuilder routes, string pattern, string method)
  {
    var handler = method == "GET"
      ? (RequestDelegate)UnfurlEndpoint.HandleAsync
      : pattern switch
      {
        "/upload" => UploadEndpoint.HandleAsync,
        "/delete" => DeleteEndpoint.HandleAsync,
        "/sync/{doc}/reset" => ResetEndpoint.HandleAsync,
        _ => UploadByUrlEndpoint.HandleAsync,
      };

    routes.MapMethods(pattern, [method], Guard(handler, method == "POST"));
    routes.MapMethods(
        pattern,
        ["OPTIONS"],
        context => HandlePreflight(context, method))
        .AllowAnonymous();

    var allowedMethods = method == "GET"
      ? "GET, HEAD, OPTIONS"
      : "OPTIONS, POST";
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
