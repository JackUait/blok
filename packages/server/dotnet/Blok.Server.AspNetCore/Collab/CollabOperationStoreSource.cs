using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// The operation store the room manager and the handshake share: the one the
/// host registered, else the built-in journal when the options the provider
/// holds ask for it, else none. Read at resolve time, like every other collab
/// service, so a host-registered options instance or a later CollabJournal
/// change is honoured. Lazy, because the built-in store holds file locks and
/// there must be exactly one per process.
/// </summary>
internal sealed class CollabOperationStoreSource(IServiceProvider provider)
{
  private readonly Lazy<ICollabOperationStore?> store = new(() =>
  {
    if (provider.GetService<ICollabOperationStore>() is { } registered)
    {
      return registered;
    }

    var options = provider.GetRequiredService<BlokServerOptions>();
    options.Validate();

    return options.CollabEnabled && options.CollabJournal
      ? new LocalCollabOperationStore(options.CollabDirectory)
      : null;
  });

  internal ICollabOperationStore? Store => store.Value;
}
