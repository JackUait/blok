using Blok.Server.Runtime;
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
    services.TryAddSingleton<IBlokRuntime>(static _ => JintBlokRuntime.FromEmbeddedResource());
    services.TryAddSingleton<IBlokAuthorization, DenyBlokAuthorization>();

    return new BlokServerBuilder(services);
  }
}
