using Blok.Server.Collab;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Blok.Server.AspNetCore;

public static class BlokServerServiceCollectionExtensions
{
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
        return new LocalCollabStore(effectiveOptions.CollabDirectory);
      }

      throw new InvalidOperationException(
          "The collaboration working set needs CollabDirectory or CollabS3Prefix.");
    });

    services.TryAddSingleton<ICollabRoomManager>(provider =>
    {
      RequireCollabOptions(provider);

      throw new NotImplementedException(
          "The collaboration room manager lands with the Phase 2 room task.");
    });

    return new BlokServerBuilder(services);
  }

  private static BlokServerOptions RequireCollabOptions(IServiceProvider provider)
  {
    var effectiveOptions = provider.GetRequiredService<BlokServerOptions>();
    effectiveOptions.Validate();

    if (!effectiveOptions.HasCollab)
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
