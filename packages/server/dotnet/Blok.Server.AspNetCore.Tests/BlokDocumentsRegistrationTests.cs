using Blok.Server.Documents;
using Blok.Server.Storage;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

public sealed class BlokDocumentsRegistrationTests
{
  /// <summary>
  /// An app that only wants to convert documents must not be made to configure
  /// blob storage: <see cref="BlokServerServiceCollectionExtensions.AddBlokServer(IServiceCollection)"/>
  /// registers an <see cref="IBlobStore"/> that throws unless a bucket or a
  /// directory was supplied, and the upload routes it exists for are a separate
  /// decision from reading a document.
  /// </summary>
  [Fact]
  public void RegistersTheConverterWithoutRequiringStorage()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments();

    Assert.DoesNotContain(services, descriptor => descriptor.ServiceType == typeof(IBlobStore));

    using var provider = services.BuildServiceProvider();
    Assert.NotNull(provider.GetRequiredService<IBlokDocumentConverter>());
  }

  [Fact]
  public void RegistersOneConverterAcrossRepeatedAndMixedRegistration()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments();
    services.AddBlokDocuments();
    services.AddBlokServer(options =>
    {
      options.StorageDirectory = "/local/storage";
      options.PublicUrl = "https://uploads.example";
    });

    Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IBlokDocumentConverter));

    using var provider = services.BuildServiceProvider();
    Assert.Same(
        provider.GetRequiredService<IBlokDocumentConverter>(),
        provider.GetRequiredService<IBlokDocumentConverter>());
  }

  [Fact]
  public async Task ResolvesAConverterThatRunsTheEmbeddedRuntime()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments();

    using var provider = services.BuildServiceProvider();
    var converter = provider.GetRequiredService<IBlokDocumentConverter>();

    var conversion = await converter.ToMarkdownAsync(
        """{"blocks":[{"type":"header","data":{"text":"Hi","level":1}}]}""");

    Assert.Equal("# Hi", conversion.Markdown);
  }
}
