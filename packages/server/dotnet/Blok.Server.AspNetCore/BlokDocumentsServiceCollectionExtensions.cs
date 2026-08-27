using Blok.Server.Documents;
using Blok.Server.Runtime;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

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
  /// <returns>The same collection, for chaining.</returns>
  public static IServiceCollection AddBlokDocuments(this IServiceCollection services)
  {
    ArgumentNullException.ThrowIfNull(services);

    services.TryAddSingleton<IBlokRuntime>(static _ => JintBlokRuntime.FromEmbeddedResource());
    services.TryAddSingleton<IBlokDocumentConverter, BlokDocumentConverter>();

    return services;
  }
}
