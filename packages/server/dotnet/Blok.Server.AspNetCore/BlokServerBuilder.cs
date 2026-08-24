using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

public sealed class BlokServerBuilder
{
  internal BlokServerBuilder(IServiceCollection services)
  {
    Services = services;
  }

  internal IServiceCollection Services { get; }
}
