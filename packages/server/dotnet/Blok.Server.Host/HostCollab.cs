using Blok.Server.AspNetCore;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Blok.Server.Host;

/// <summary>
/// The host's side of --collab (plan decisions 17 and 19). Everything here
/// is gated on the flag so a host without it composes exactly as before.
/// </summary>
internal static class HostCollab
{
  /// <summary>
  /// Long enough for a drain (flush every room to its blob and the doc
  /// endpoint) plus Kestrel's graceful stop; set explicitly so the
  /// framework default cannot move it.
  /// </summary>
  internal static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(30);

  /// <summary>
  /// Kestrel's default is unlimited, which would let an unauthenticated
  /// accept-and-hold flood pin every upgraded socket the process can hold.
  /// A constant, not a flag: the per-user cap is an option, not a flag,
  /// too (plan decision 18). Tests lower it to prove the refusal.
  /// </summary>
  internal const long DefaultMaxUpgradedConnections = 1024;

  internal static void Configure(
      WebApplicationBuilder builder,
      BlokServerOptions options,
      long maxUpgradedConnections = DefaultMaxUpgradedConnections)
  {
    builder.Services.Configure<HostOptions>(host => host.ShutdownTimeout = ShutdownTimeout);

    if (!options.CollabEnabled)
    {
      return;
    }

    builder.WebHost.ConfigureKestrel(kestrel =>
        kestrel.Limits.MaxConcurrentUpgradedConnections = maxUpgradedConnections);
    // The same number for the service's own count, which refuses 503 before
    // a room is seeded; Kestrel's limit is the backstop and answers 500.
    options.CollabMaxConnections = maxUpgradedConnections;
    builder.Logging.AddProvider(new CollabStandardErrorLoggerProvider());
    builder.Services.AddHostedService<CollabDrainService>();
  }

  /// <summary>Must run before MapBlokServer: the sync endpoint refuses upgrades with 500 without the WebSocket feature.</summary>
  internal static void Use(WebApplication app, BlokServerOptions options)
  {
    if (!options.CollabEnabled)
    {
      return;
    }

    // The accept context sets the same values per socket; these are the
    // fallback for any accept that does not.
    var webSockets = new WebSocketOptions
    {
      KeepAliveInterval = options.CollabKeepAliveInterval,
    };

    if (options.CollabKeepAliveInterval > TimeSpan.Zero)
    {
      webSockets.KeepAliveTimeout = options.CollabKeepAliveInterval * 2;
    }

    app.UseWebSockets(webSockets);
  }
}

/// <summary>
/// Drains the sync rooms on shutdown. Host.StopAsync runs, in order: the
/// ApplicationStopping event, IHostedLifecycleService.StoppingAsync (this),
/// IHostedService.StopAsync in reverse registration order (the web host's,
/// which stops listening and aborts leftover connections at the shutdown
/// timeout), StoppedAsync, ApplicationStopped. Draining here — not on the
/// synchronous ApplicationStopping event — lets the drain be awaited under
/// the shutdown-timeout token and finish before Kestrel touches a socket:
/// new upgrades get 503, every room flushes blob + export, members close 1001.
/// </summary>
internal sealed class CollabDrainService(IServiceProvider services) : IHostedLifecycleService
{
  public Task StartingAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }

  public Task StartAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }

  public Task StartedAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }

  public async Task StoppingAsync(CancellationToken cancellationToken)
  {
    try
    {
      // Resolved here, not injected: a host that never opened a room never
      // builds the room manager, store or doc-endpoint client at startup.
      await services.GetRequiredService<ICollabRoomManager>().DrainAsync(cancellationToken);
    }
    catch (Exception error)
    {
      // Rooms log their own flush failures; this is the drain as a whole
      // (typically the shutdown timeout). Kestrel still stops below.
      Console.Error.WriteLine($"warning: collab: the shutdown drain did not complete: {error.Message}");
    }
  }

  public Task StopAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }

  public Task StoppedAsync(CancellationToken cancellationToken)
  {
    return Task.CompletedTask;
  }
}

/// <summary>
/// The host clears every logging provider; this one writes the room
/// manager's warnings ("Blok.Server.Collab") as the same one-line
/// "warning: ..." stderr records the host uses for its own.
/// </summary>
internal sealed class CollabStandardErrorLoggerProvider : ILoggerProvider
{
  private const string Category = "Blok.Server.Collab";

  private static readonly StandardErrorLogger Logger = new();

  public ILogger CreateLogger(string categoryName)
  {
    return categoryName == Category ? Logger : NullLogger.Instance;
  }

  public void Dispose()
  {
  }

  private sealed class StandardErrorLogger : ILogger
  {
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull
    {
      return null;
    }

    public bool IsEnabled(LogLevel logLevel)
    {
      return logLevel >= LogLevel.Warning;
    }

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
      if (!IsEnabled(logLevel))
      {
        return;
      }

      var kind = logLevel >= LogLevel.Error ? "error" : "warning";
      Console.Error.WriteLine($"{kind}: {formatter(state, exception)}");
    }
  }
}
