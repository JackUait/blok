using System.Text.Json;
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
    var routes = endpoints.MapGroup(pattern);

    routes.MapMethods("/health", ["GET", "HEAD"], HandleHealth);
    routes.Map("/health", HandleMethodNotAllowed).WithOrder(1);

    if (!options.UnfurlDisabled)
    {
      MapShell(routes, "/unfurl", "GET");
    }

    if (options.HasStorage)
    {
      MapShell(routes, "/upload", "POST");

      if (!options.UnfurlDisabled)
      {
        MapShell(routes, "/upload-by-url", "POST");
      }
    }

    routes.Map("/{**path}", HandleNotFound).WithOrder(int.MaxValue);

    return routes;
  }

  private static void MapShell(RouteGroupBuilder routes, string pattern, string method)
  {
    routes.MapMethods(pattern, [method], HandleNotImplemented);
    routes.MapMethods(pattern, ["OPTIONS"], HandleNotImplemented);
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

  private static async Task HandleMethodNotAllowed(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
    context.Response.Headers.Allow = "GET, HEAD";
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("Method Not Allowed\n");
  }

  private static Task HandleNotImplemented(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status501NotImplemented;

    return Task.CompletedTask;
  }

  private static async Task HandleNotFound(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("404 page not found\n");
  }
}
