using Blok.Server.AspNetCore.Collab;
using Blok.Server.Collab;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Blok.Server.AspNetCore;

public static class BlokServerServiceCollectionExtensions
{
  private static readonly TimeSpan DocEndpointRequestTimeout = TimeSpan.FromSeconds(30);
  private static readonly Action<ILogger, string, Exception?> LogCollab =
      LoggerMessage.Define<string>(LogLevel.Warning, new EventId(1, "Collab"), "{Message}");

  public static BlokServerBuilder AddBlokServer(this IServiceCollection services)
  {
    return services.AddBlokServer(new BlokServerOptions());
  }

  public static BlokServerBuilder AddBlokServer(
      this IServiceCollection services,
      Action<BlokServerOptions> configure)
  {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(configure);

    var options = new BlokServerOptions();
    configure(options);

    return services.AddBlokServer(options);
  }

  public static BlokServerBuilder AddBlokServer(
      this IServiceCollection services,
      BlokServerOptions options)
  {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(options);
    options.Validate();

    services.TryAddSingleton(options);
    services.TryAddSingleton(TimeProvider.System);
    services.AddBlokDocuments();
    services.TryAddSingleton<IGuardedOutboundPolicy, GuardedOutboundPolicy>();
    services.TryAddSingleton<IGuardedOutboundFetcher>(provider =>
        new GuardedOutboundFetcher(
            provider.GetRequiredService<IGuardedOutboundPolicy>()));
    services.TryAddSingleton<FixedWindowRateLimiter>();
    services.TryAddSingleton<BlokServerRequestGuard>();

    services.TryAddSingleton<IBlobStore>(provider =>
    {
      var effectiveOptions = provider.GetRequiredService<BlokServerOptions>();
      effectiveOptions.Validate();

      if (effectiveOptions.S3Bucket != "")
      {
        return CreateS3BlobStore(
            effectiveOptions,
            provider.GetRequiredService<TimeProvider>());
      }

      if (effectiveOptions.StorageDirectory != "")
      {
        return new LocalBlobStore(
            effectiveOptions.StorageDirectory,
            effectiveOptions.PublicUrl);
      }

      throw new InvalidOperationException("Blob storage is disabled.");
    });

    services.TryAddSingleton<ICollabWorkingSetStore>(provider =>
    {
      var effectiveOptions = RequireCollabOptions(provider);

      if (effectiveOptions.CollabS3Prefix != "")
      {
        return new S3CollabStore(
            CreateS3BlobStore(
                effectiveOptions,
                provider.GetRequiredService<TimeProvider>()),
            effectiveOptions.CollabS3Prefix);
      }

      if (effectiveOptions.CollabDirectory != "")
      {
        // UseCollabOperationStore<T>() cannot cancel this registration itself:
        // it runs after AddBlokServer, so TryAddSingleton has already claimed
        // the service type, and WHICH branch applies is only known once the
        // effective options resolve. The claim therefore lands here. IsService
        // asks about the registration without constructing the consumer's
        // store. Task 1.4 needs the same predicate.
        if (provider.GetRequiredService<IServiceProviderIsService>()
            .IsService(typeof(ICollabOperationStore)))
        {
          throw new InvalidOperationException(
              "the registered ICollabOperationStore owns " +
              $"\"{effectiveOptions.CollabDirectory}\": a working-set store " +
              "would be a second writer of the same document bytes");
        }

        return new LocalCollabStore(effectiveOptions.CollabDirectory);
      }

      throw new InvalidOperationException(
          "The collaboration working set needs CollabDirectory or CollabS3Prefix.");
    });

    services.TryAddSingleton<SyncHandshake>();
    services.TryAddSingleton<SyncConnectionTable>();

    services.TryAddSingleton<CollabRoomManager>(provider =>
    {
      var effectiveOptions = RequireCollabOptions(provider);
      var timeProvider = provider.GetRequiredService<TimeProvider>();

      return new CollabRoomManager(
          provider.GetRequiredService<ICollabWorkingSetStore>(),
          new DocEndpointClient(
              new DocEndpointOptions(
                  new Uri(effectiveOptions.DocEndpoint),
                  effectiveOptions.DocEndpointAuth,
                  DocEndpointRequestTimeout)),
          new CollabDocConverter(timeProvider, CollabLog(provider)),
          new CollabRoomOptions
          {
            AnnouncedMaxMessageBytes = effectiveOptions.CollabMaxMessageBytes,
          },
          timeProvider,
          CollabLog(provider));
    });

    // The endpoints need the concrete manager; the interface is the host's
    // drain handle. Both resolve to the one instance.
    services.TryAddSingleton<ICollabRoomManager>(provider =>
        provider.GetRequiredService<CollabRoomManager>());

    return new BlokServerBuilder(services);
  }

  private static Action<string>? CollabLog(IServiceProvider provider)
  {
    var logger = provider.GetService<ILoggerFactory>()?.CreateLogger("Blok.Server.Collab");

    return logger is null
      ? null
      : message => LogCollab(logger, message, null);
  }

  private static BlokServerOptions RequireCollabOptions(IServiceProvider provider)
  {
    var effectiveOptions = provider.GetRequiredService<BlokServerOptions>();
    effectiveOptions.Validate();

    if (!effectiveOptions.CollabEnabled)
    {
      throw new InvalidOperationException("Collaboration is disabled.");
    }

    return effectiveOptions;
  }

  private static S3BlobStore CreateS3BlobStore(
      BlokServerOptions options,
      TimeProvider timeProvider)
  {
    return new S3BlobStore(
        new S3BlobStoreOptions(
            options.S3Endpoint,
            options.S3Region,
            options.S3Bucket,
            options.S3AccessKey,
            options.S3SecretKey,
            options.S3BucketUrl,
            options.S3Addressing,
            options.MaxUploadBytes,
            Path.GetTempPath()),
        timeProvider);
  }
}
