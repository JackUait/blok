using Blok.Server.Runtime;
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
    services.TryAddSingleton<IBlokRuntime>(static _ => JintBlokRuntime.FromEmbeddedResource());
    services.TryAddSingleton<IBlokAuthorization, DenyBlokAuthorization>();
    services.TryAddSingleton<FixedWindowRateLimiter>();
    services.TryAddSingleton<BlokServerRequestGuard>();

    services.TryAddSingleton<IBlobStore>(provider =>
    {
      var effectiveOptions = provider.GetRequiredService<BlokServerOptions>();

      if (effectiveOptions.S3Bucket != "")
      {
        return new S3BlobStore(
            new S3BlobStoreOptions(
                effectiveOptions.S3Endpoint,
                effectiveOptions.S3Region,
                effectiveOptions.S3Bucket,
                effectiveOptions.S3AccessKey,
                effectiveOptions.S3SecretKey,
                effectiveOptions.S3BucketUrl,
                effectiveOptions.S3Addressing,
                effectiveOptions.MaxUploadBytes,
                Path.GetTempPath()),
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

    return new BlokServerBuilder(services);
  }
}
