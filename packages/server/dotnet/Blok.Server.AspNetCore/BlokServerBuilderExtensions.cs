using Blok.Server.Collab;
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

  /// <summary>
  /// Registers <typeparamref name="T"/> as this server's collaboration
  /// operation store, replacing one registered earlier. It is resolved as a
  /// singleton.
  /// </summary>
  public static BlokServerBuilder UseCollabOperationStore<T>(this BlokServerBuilder builder)
      where T : class, ICollabOperationStore
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<ICollabOperationStore>();
    builder.Services.AddSingleton<ICollabOperationStore, T>();

    return builder;
  }
}
