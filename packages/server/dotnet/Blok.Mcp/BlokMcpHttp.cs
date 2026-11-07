using System.Net;
using Blok.Server.Mcp;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Blok.Mcp;

/// <summary>blok-mcp --http: Node's front door (Origin, Host, 404) over the library's endpoint.</summary>
internal static class BlokMcpHttp
{
  private const string Path = "/mcp";

  internal static async Task<int> RunAsync(BlokMcpHost host, McpConfig config)
  {
    var (address, port) = await ListenAsync(config.HttpListen!);
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(kestrel =>
    {
      kestrel.AddServerHeader = false;
      // McpRequestGate caps the body itself, after authentication, as Node does.
      kestrel.Limits.MaxRequestBodySize = null;
      kestrel.Listen(address, port);
    });
    builder.Services.AddBlokMcpServer(host, config);
    // Stop lets calls in flight finish and answer, as Node's stop drains them (STOP_DRAIN_MS).
    builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = TimeSpan.FromSeconds(45));
    await using var app = builder.Build();
    var bound = 0;
    var guard = new McpHttpGuard(config, () => bound, Path);

    app.Use(guard.InvokeAsync);
    app.UseRouting();
    if (config.OAuth is not null)
    {
      app.UseAuthentication();
      app.UseAuthorization();
    }
    app.MapBlokMcp(Path);
    var core = app.Services.GetRequiredService<McpServerCore>();

    // Runs before Kestrel stops, so it keeps serving while calls in flight finish, as Node's stop does.
    app.Lifetime.ApplicationStopping.Register(() => core.StopAsync().GetAwaiter().GetResult());
    await app.StartAsync();
    var url = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First());

    bound = url.Port;
    await Console.Error.WriteLineAsync($"blok-mcp: listening on http://{url.Host}:{url.Port}{Path}");
    await app.WaitForShutdownAsync();

    return 0;
  }

  // host:port, as Node splits it; port 0 picks a free one.
  private static async Task<(IPAddress Address, int Port)> ListenAsync(string listen)
  {
    var at = listen.LastIndexOf(':');
    var name = (at < 0 ? listen : listen[..at]).TrimStart('[').TrimEnd(']');
    var port = at < 0 ? 0 : int.Parse(listen[(at + 1)..], System.Globalization.CultureInfo.InvariantCulture);

    if (IPAddress.TryParse(name, out var address))
    {
      return (address, port);
    }
    var resolved = await Dns.GetHostAddressesAsync(name);

    return (resolved.First(), port);
  }
}
