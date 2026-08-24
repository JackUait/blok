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

    if (options.S3Bucket != "")
    {
      services.TryAddSingleton<IBlobStore>(
          provider => new S3BlobStore(
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
              provider.GetRequiredService<TimeProvider>()));
    }
    else if (options.StorageDirectory != "")
    {
      services.TryAddSingleton<IBlobStore>(
          new LocalBlobStore(options.StorageDirectory, options.PublicUrl));
    }

    return new BlokServerBuilder(services);
  }
}
