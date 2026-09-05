using System.Text;
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
  /// Build the converter at startup rather than on the first conversion, and
  /// run one conversion through it in the background. Building it parses the
  /// embedded bundle into every engine of its pool; the first conversion
  /// additionally warms the .NET JIT for the interpreter's hot paths, which
  /// costs far more than the parse. Warming up moves both off the first request
  /// after a deploy. It never delays or fails startup — it is started, not
  /// awaited. Pass <c>false</c> for a host that starts many times and converts
  /// rarely — a test host, for instance.
  /// </param>
  /// <param name="allocationBudgetBytes">
  /// How much ONE conversion may allocate. This is allocation churn per call,
  /// NOT resident memory: the runtime counts every allocation a conversion
  /// makes rather than what it still holds, and nothing is reserved, so a host
  /// that converts small documents pays nothing for a large budget. Defaults to
  /// 512 MiB, which is what a long article carrying inline markup, or one
  /// holding a large inline base64 image, was measured to need. Lower it only
  /// to bound a hostile document.
  /// </param>
  /// <returns>The same collection, for chaining.</returns>
  public static IServiceCollection AddBlokDocuments(
      this IServiceCollection services,
      int? poolSize = null,
      TimeSpan? timeout = null,
      bool warmUp = true,
      long? allocationBudgetBytes = null)
  {
    ArgumentNullException.ThrowIfNull(services);

    services.TryAddSingleton<IBlokRuntime>(
        _ => JintBlokRuntime.FromEmbeddedResource(poolSize, timeout, allocationBudgetBytes));
    services.TryAddSingleton<IBlokDocumentConverter, BlokDocumentConverter>();

    if (warmUp)
    {
      services.AddHostedService<BlokDocumentWarmUp>();
    }

    return services;
  }
}

/// <summary>
/// Builds the engine pool at startup AND converts one document through it, so
/// the first request pays for neither.
/// </summary>
/// <remarks>
/// Resolving the converter alone is not enough. Building the engines parses the
/// bundle; the first CONVERSION additionally pays for the .NET tiered JIT to
/// promote the interpreter's hot paths, which was measured at 1135-1557 ms of
/// CPU against 200-300 ms once warm — and running with tiered compilation off
/// cuts that first call by 61%, which is what identifies it as the JIT rather
/// than anything inside the engine. The document has to be a realistic size for
/// the same reason: a 1.3 KB warm-up runs the same functions but not enough
/// times to promote them, and left the first real conversion no faster than no
/// warm-up at all.
/// </remarks>
/// <param name="converter">Resolved for its construction cost, then exercised.</param>
internal sealed class BlokDocumentWarmUp(IBlokDocumentConverter converter) : IHostedService
{
  /// <summary>The warm-up run, so a test can wait for what startup does not.</summary>
  internal Task Warmed { get; private set; } = Task.CompletedTask;

  /**
   * Started, not awaited, and its failure is swallowed. Warming is an
   * optimization: an application must not refuse to start because a conversion
   * was slow, and on a loaded host that conversion can reach the runtime's own
   * timeout. Racing the first request is the situation warming exists to
   * improve, so losing that race is no worse than not warming at all.
   */
  public Task StartAsync(CancellationToken cancellationToken)
  {
    Warmed = Task.Run(
        async () =>
        {
          try
          {
            await converter.ToPlainTextAsync(WarmUpDocument(), cancellationToken: cancellationToken);
          }
          catch (Exception)
          {
            // Deliberately ignored; see above.
          }
        },
        cancellationToken);

    return Task.CompletedTask;
  }

  public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

  /// <summary>
  /// A document shaped like a long article — inline markup, an entity, and a
  /// list — because the paths worth promoting are the ones a real document
  /// takes. Built rather than embedded so the package carries no literal of it.
  /// </summary>
  private static string WarmUpDocument()
  {
    const string paragraph = "Warm up <b>the</b> reader with <a href=\\\"https://example.com\\\">a link</a> "
        + "and enough plain prose after it to be worth reading, paragraph ";
    var blocks = new StringBuilder("{\"blocks\":[");

    for (var index = 0; index < 220; index++)
    {
      if (index > 0)
      {
        blocks.Append(',');
      }

      blocks.Append("{\"id\":\"w").Append(index).Append('"');

      blocks.Append(index % 7 == 0
          ? ",\"type\":\"list\",\"data\":{\"style\":\"unordered\",\"text\":\"item &amp; more "
          : ",\"type\":\"paragraph\",\"data\":{\"text\":\"" + paragraph);

      blocks.Append(index).Append("\"}}");
    }

    return blocks.Append("]}").ToString();
  }
}
