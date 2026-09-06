using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

/// <summary>
/// What <see cref="BlokServerServiceCollectionExtensions.AddBlokServer(Microsoft.Extensions.DependencyInjection.IServiceCollection)"/>
/// hands back: the receiver for this server's opt-in hooks.
/// </summary>
/// <remarks>
/// The constructor and the service collection behind it are internal, so the
/// only way to hold one is to have registered the server first — a hook
/// cannot be applied to services Blok has not been added to.
/// </remarks>
public sealed class BlokServerBuilder
{
  internal BlokServerBuilder(IServiceCollection services)
  {
    Services = services;
  }

  internal IServiceCollection Services { get; }
}
