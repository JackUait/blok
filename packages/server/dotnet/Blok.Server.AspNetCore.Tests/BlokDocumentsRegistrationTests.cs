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
  /// pool. Registered as a plain singleton that is a cost the first request
  /// after a deploy pays; warming up moves it to startup, where nobody is
  /// waiting on it.
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
  /// Building the engines is not the whole cost. The first conversion in the
  /// process also pays for the .NET tiered JIT to promote the interpreter's hot
  /// paths: measured on this runtime, that first call costs 1135-1557 ms of CPU
  /// against 200-300 ms once warm, and switching tiered compilation off cuts it
  /// by 61% — which is what identifies it. So the warm-up has to CONVERT
  /// something, not merely resolve the converter.
  /// </summary>
  [Fact]
  public async Task ConvertsSomethingAtStartupRatherThanOnlyBuildingThePool()
  {
    var services = new ServiceCollection();
    var converter = new CountingConverter();

    services.AddSingleton<IBlokDocumentConverter>(converter);
    services.AddBlokDocuments();

    using var provider = services.BuildServiceProvider();

    foreach (var service in provider.GetServices<IHostedService>())
    {
      await service.StartAsync(CancellationToken.None);

      /**
       * Awaited here, not by startup: warming runs in the background so a slow
       * conversion can never delay or fail an application's start.
       */
      if (service is BlokDocumentWarmUp warmUp)
      {
        await warmUp.Warmed;
      }
    }

    Assert.True(converter.Conversions >= 1, "the warm-up ran no conversion");

    /**
     * A tiny document runs the same functions but not enough times to promote
     * them: measured, a 1.3 KB warm-up left the first real conversion at
     * 1230-1507 ms, statistically the same as no warm-up at all.
     */
    Assert.True(
        converter.LongestDocument >= 30_000,
        $"the warm-up document is too small to promote anything: {converter.LongestDocument}");
  }

  private sealed class CountingConverter : StubConverter
  {
    public int Conversions { get; private set; }

    public int LongestDocument { get; private set; }

    public override ValueTask<string> ToPlainTextAsync(
        string documentJson,
        CancellationToken cancellationToken = default)
    {
      Conversions++;
      LongestDocument = Math.Max(LongestDocument, documentJson.Length);

      return ValueTask.FromResult(string.Empty);
    }
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

  /// <summary>
  /// Mapping the server routes must not warm the converter. Warming builds the
  /// whole engine pool and converts a document through it, and an app that
  /// mapped uploads and link previews may never convert anything — on a loaded
  /// host, building that pool can reach the runtime's own timeout, so it is not
  /// a cost to impose on an app that did not ask for it.
  /// </summary>
  [Fact]
  public void MappingTheServerRoutesDoesNotWarmTheConverter()
  {
    var services = new ServiceCollection();

    services.AddBlokServer(options =>
    {
      options.StorageDirectory = "/local/storage";
      options.PublicUrl = "https://uploads.example";
    });

    Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IBlokDocumentConverter));
    Assert.DoesNotContain(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
  }

  private class StubConverter : IBlokDocumentConverter
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

    /** The one method the warm-up calls, so it answers rather than throwing. */
    public virtual ValueTask<string> ToPlainTextAsync(
        string documentJson,
        CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(string.Empty);

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
