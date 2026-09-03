using Blok.Server.Documents;
using Blok.Server.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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

  /// <summary>
  /// Building the converter parses the embedded bundle into every engine of its
  /// pool and costs about a second. Registered as a plain singleton that is a
  /// cost the first request after a deploy pays; warming up moves it to
  /// startup, where nobody is waiting on it.
  /// </summary>
  [Fact]
  public async Task BuildsTheConverterAtStartupInsteadOfOnTheFirstRequest()
  {
    var services = new ServiceCollection();
    var built = false;

    // Registered first so `TryAddSingleton` inside AddBlokDocuments stands down
    // and the warm-up resolves this one — which is how the resolve is observed
    // without the real pool's second of work.
    services.AddSingleton<IBlokDocumentConverter>(_ =>
    {
      built = true;

      return new StubConverter();
    });
    services.AddBlokDocuments();

    using var provider = services.BuildServiceProvider();
    Assert.False(built);

    foreach (var service in provider.GetServices<IHostedService>())
    {
      await service.StartAsync(CancellationToken.None);
    }

    Assert.True(built);
  }

  /// <summary>
  /// The embedded runtime is an interpreter, so a conversion costs far more
  /// than the same code costs in a browser and grows with the document. A
  /// service that stores long articles has to be able to say so; without this
  /// its only options were the ten-second default or building the converter by
  /// hand and losing the registration.
  /// </summary>
  [Fact]
  public async Task TakesTheTimeoutTheCallerAsksFor()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments(poolSize: 1, timeout: TimeSpan.FromMinutes(2), warmUp: false);

    using var provider = services.BuildServiceProvider();
    var conversion = await provider.GetRequiredService<IBlokDocumentConverter>()
        .ToMarkdownAsync("""{"blocks":[{"type":"paragraph","data":{"text":"Hi"}}]}""");

    Assert.Equal("Hi", conversion.Markdown);
  }

  /// <summary>
  /// A timeout under a second or so fails while the bundle is being loaded into
  /// each engine, which is the honest place for it to fail — not later, on
  /// somebody's document.
  /// </summary>
  [Fact]
  public void RefusesATimeoutTooShortToLoadTheBundle()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments(poolSize: 1, timeout: TimeSpan.FromMilliseconds(1), warmUp: false);

    using var provider = services.BuildServiceProvider();

    Assert.ThrowsAny<Exception>(() => provider.GetRequiredService<IBlokDocumentConverter>());
  }

  [Fact]
  public void SkipsTheWarmUpWhenItIsNotWanted()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments(warmUp: false);

    Assert.DoesNotContain(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
  }

  /// <summary>
  /// A host that both maps the server routes and converts documents registers
  /// the warm-up once, not once per call.
  /// </summary>
  [Fact]
  public void RegistersOneWarmUpAcrossRepeatedAndMixedRegistration()
  {
    var services = new ServiceCollection();

    services.AddBlokDocuments();
    services.AddBlokDocuments();
    services.AddBlokServer(options =>
    {
      options.StorageDirectory = "/local/storage";
      options.PublicUrl = "https://uploads.example";
    });

    Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
  }

  private sealed class StubConverter : IBlokDocumentConverter
  {
    public ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default) =>
        ValueTask.FromResult("0.0.0");

    public ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
        string documentJson,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<string> GetSchemaAsync(CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<IReadOnlyList<string>> ExtractTextsAsync(
        string documentJson,
        bool includeCode = false,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<string> InjectTextsAsync(
        string documentJson,
        IReadOnlyList<string> texts,
        bool includeCode = false,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<string> ToPlainTextAsync(string documentJson, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public ValueTask<BlokImportConversion> FromMarkdownAsync(
        string markdown,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
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
