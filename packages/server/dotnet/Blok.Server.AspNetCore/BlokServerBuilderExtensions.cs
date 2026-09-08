using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Blok.Server.AspNetCore;

/// <summary>The opt-in hooks a host may put behind a registered Blok server.</summary>
public static class BlokServerBuilderExtensions
{
  /// <summary>
  /// Registers <typeparamref name="T"/> as this server's per-document access
  /// decision, replacing one registered earlier. It is resolved as a singleton.
  /// </summary>
  /// <remarks>
  /// Without this call no <see cref="IBlokAuthorization"/> is resolved and the
  /// document routes admit every caller the transport authenticated — which,
  /// under <c>Auth</c> "none", is anyone who can reach the app.
  /// </remarks>
  /// <typeparam name="T">The application's access decision.</typeparam>
  /// <param name="builder">The server being built.</param>
  /// <returns>The same builder, so hooks chain.</returns>
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
  /// <remarks>
  /// This call is what turns the journal on. Without it no
  /// <see cref="ICollabOperationStore"/> is resolved, the server negotiates
  /// blok-sync.v1, and an acknowledged operation is durable only as far as the
  /// working set — read
  /// <see cref="ICollabOperationStore"/>'s remarks before writing one, because
  /// every guarantee the protocol makes to a client rests on the store keeping
  /// them.
  /// </remarks>
  /// <typeparam name="T">The application's operation store.</typeparam>
  /// <param name="builder">The server being built.</param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseCollabOperationStore<T>(this BlokServerBuilder builder)
      where T : class, ICollabOperationStore
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<ICollabOperationStore>();
    builder.Services.AddSingleton<ICollabOperationStore, T>();

    return builder;
  }

  /// <summary>
  /// Registers <typeparamref name="T"/> as this server's collaboration
  /// activity observer, replacing one registered earlier. It is resolved as a
  /// singleton.
  /// </summary>
  /// <remarks>
  /// Blok keeps no activity history of its own, so this call is the only way a
  /// host learns when a person was last in a document. Without it no
  /// <see cref="ICollabActivityObserver"/> is resolved and a room makes no
  /// calls at all — the feature costs nothing when it is not used.
  /// </remarks>
  /// <typeparam name="T">The application's activity observer.</typeparam>
  /// <param name="builder">The server being built.</param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseCollabActivityObserver<T>(this BlokServerBuilder builder)
      where T : class, ICollabActivityObserver
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<ICollabActivityObserver>();
    builder.Services.AddSingleton<ICollabActivityObserver, T>();

    return builder;
  }
}
