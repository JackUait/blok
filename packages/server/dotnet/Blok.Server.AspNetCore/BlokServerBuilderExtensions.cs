using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Blok.Server.AspNetCore;

public static class BlokServerBuilderExtensions
{
  public static BlokServerBuilder UseAuthorization<T>(this BlokServerBuilder builder)
      where T : class, IBlokAuthorization
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<IBlokAuthorization>();
    builder.Services.AddSingleton<IBlokAuthorization, T>();

    return builder;
  }
}
