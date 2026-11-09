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
  /// <para>
  /// To purge documents, <typeparamref name="T"/> must also implement
  /// <see cref="ICollabOperationPurgeStore"/>. Without it
  /// <see cref="ICollabDocumentPurger.PurgeDocumentAsync"/> throws
  /// <see cref="NotSupportedException"/> and changes nothing.
  /// </para>
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
  /// Refuses, with 421 "host not allowed", a guarded request whose
  /// <c>Host</c> is not <c>localhost</c>, a 127.x.x.x address, <c>[::1]</c>,
  /// or the host of an <see cref="BlokServerOptions.AllowedOrigins"/> entry
  /// or of <see cref="BlokServerOptions.PublicUrl"/>, when
  /// <see cref="BlokServerOptions.Auth"/> is "none" or "proxy". The port is
  /// not checked, and a request with no <c>Host</c> passes.
  /// </summary>
  /// <remarks>
  /// This stops DNS rebinding: a page whose name now points at 127.0.0.1
  /// sends its own name as <c>Host</c>. The standalone host turns it on. Turn
  /// it on in your app when it listens on loopback only; leave it off when
  /// the app serves the routes under its own public name.
  /// </remarks>
  /// <param name="builder">The server being built.</param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseLoopbackHostCheck(this BlokServerBuilder builder)
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.TryAddSingleton<LoopbackHostCheck>();

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

  /// <summary>
  /// Keeps a note of who wrote each journal record: a person or an agent,
  /// the agent's client and the person it acted for. The history routes then
  /// return actor kinds. Registered as a singleton.
  /// </summary>
  /// <remarks>
  /// The note is written right after its record, but not atomically with it:
  /// a crash in between loses that one note. Blok never deletes notes; delete
  /// a document's notes when you purge it.
  /// </remarks>
  /// <typeparam name="T">The application's notes store, or <see cref="InMemoryCollabRecordNotes"/>.</typeparam>
  /// <param name="builder">The server being built.</param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseCollabRecordNotes<T>(this BlokServerBuilder builder)
      where T : class, ICollabRecordNotes
  {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.RemoveAll<ICollabRecordNotes>();
    builder.Services.AddSingleton<ICollabRecordNotes, T>();

    return builder;
  }
}
