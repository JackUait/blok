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
  /// Keeps this server's collaboration history in <typeparamref name="T"/>.
  /// </summary>
  /// <remarks>
  /// The store also claims the configured collaboration directory: the built-in
  /// working-set store is no longer created for it, because two writers of the
  /// same document bytes is exactly what the journal replaces.
  /// </remarks>
  public static BlokServerBuilder UseCollabOperationStore<T>(this BlokServerBuilder builder)
      where T : class, ICollabOperationStore
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<ICollabOperationStore>();
    builder.Services.AddSingleton<ICollabOperationStore, T>();

    return builder;
  }
}
