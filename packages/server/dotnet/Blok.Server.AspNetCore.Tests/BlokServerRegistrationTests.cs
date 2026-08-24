using System.Security.Claims;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class BlokServerRegistrationTests
{
  [Fact]
  public async Task AddsTheEmbeddedRuntimeAndDenyByDefaultAuthorizationOnce()
  {
    var services = new ServiceCollection();

    services.AddBlokServer();
    services.AddBlokServer();

    var runtimeDescriptor = Assert.Single(
        services,
        descriptor => descriptor.ServiceType.FullName == "Blok.Server.Runtime.IBlokRuntime");
    Assert.Equal(ServiceLifetime.Singleton, runtimeDescriptor.Lifetime);
    Assert.NotNull(runtimeDescriptor.ImplementationFactory);

    using var provider = services.BuildServiceProvider();
    var runtime = provider.GetService(runtimeDescriptor.ServiceType);
    Assert.NotNull(runtime);
    Assert.Equal("Blok.Server.Runtime.JintBlokRuntime", runtime.GetType().FullName);

    var authorization = provider.GetRequiredService<IBlokAuthorization>();
    var user = new ClaimsPrincipal();
    Assert.False(await authorization.CanReadDocumentAsync(user, "document-1"));
    Assert.False(await authorization.CanWriteDocumentAsync(user, "document-1"));
  }

  [Fact]
  public void ReplacesTheDefaultAuthorization()
  {
    var services = new ServiceCollection();

    services.AddBlokServer().UseAuthorization<AllowAllAuthorization>();

    var authorizationDescriptor = Assert.Single(
        services,
        descriptor => descriptor.ServiceType == typeof(IBlokAuthorization));
    Assert.Equal(typeof(AllowAllAuthorization), authorizationDescriptor.ImplementationType);

    using var provider = services.BuildServiceProvider();
    Assert.IsType<AllowAllAuthorization>(provider.GetRequiredService<IBlokAuthorization>());
  }

  [Fact]
  public void MapsAnEmptyRouteGroup()
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer();
    var app = builder.Build();

    var routeGroup = app.MapBlokServer("/blok");

    Assert.IsType<RouteGroupBuilder>(routeGroup);
  }

  private sealed class AllowAllAuthorization : IBlokAuthorization
  {
    public ValueTask<bool> CanReadDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }

    public ValueTask<bool> CanWriteDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }
  }
}
