using Blok.Server.Documents;
using Blok.Server.Runtime;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Blok.Server.AspNetCore;

/// <summary>Registration for document conversion on its own.</summary>
public static class BlokDocumentsServiceCollectionExtensions
{
  /// <summary>
  /// Registers <see cref="IBlokDocumentConverter"/> as a singleton, without the
  /// upload and link-preview services <c>AddBlokServer</c> brings — converting a
  /// document needs no storage, no outbound network access and no route.
  /// </summary>
  /// <param name="services">The service collection.</param>
  /// <param name="poolSize">
  /// How many documents may convert at once; further callers wait for a free
  /// engine. Defaults to the processor count, capped at four.
  /// </param>
  /// <param name="timeout">
  /// How long one conversion may run before it is abandoned. Defaults to ten
  /// seconds. Raise it for a service that converts long documents: the embedded
  /// runtime is an interpreter, so a conversion costs far more here than the
  /// same code costs in a browser, and it grows with the document.
  /// </param>
  /// <param name="warmUp">
  /// Build the converter at startup rather than on the first conversion.
  /// Building it parses the embedded bundle into every engine of its pool and
  /// costs about a second; warming up moves that off the first request after a
  /// deploy. Pass <c>false</c> for a host that starts many times and converts
  /// rarely — a test host, for instance.
  /// </param>
  /// <returns>The same collection, for chaining.</returns>
  public static IServiceCollection AddBlokDocuments(
      this IServiceCollection services,
      int? poolSize = null,
      TimeSpan? timeout = null,
      bool warmUp = true)
  {
    ArgumentNullException.ThrowIfNull(services);

    services.TryAddSingleton<IBlokRuntime>(_ => JintBlokRuntime.FromEmbeddedResource(poolSize, timeout));
    services.TryAddSingleton<IBlokDocumentConverter, BlokDocumentConverter>();

    if (warmUp)
    {
      services.AddHostedService<BlokDocumentWarmUp>();
    }

    return services;
  }
}

/// <summary>
/// Resolves the converter once at startup so its engine pool is built before
/// the first request rather than during it.
/// </summary>
/// <param name="converter">Resolved for its construction cost, not called.</param>
internal sealed class BlokDocumentWarmUp(IBlokDocumentConverter converter) : IHostedService
{
  public Task StartAsync(CancellationToken cancellationToken)
  {
    _ = converter;

    return Task.CompletedTask;
  }

  public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
