using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace Blok.Server.AspNetCore;

public static class BlokServerEndpointRouteBuilderExtensions
{
  public static RouteGroupBuilder MapBlokServer(
      this IEndpointRouteBuilder endpoints,
      string pattern = "")
  {
    ArgumentNullException.ThrowIfNull(endpoints);
    ArgumentNullException.ThrowIfNull(pattern);

    return endpoints.MapGroup(pattern);
  }
}
