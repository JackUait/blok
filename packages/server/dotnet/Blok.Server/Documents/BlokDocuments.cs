using Blok.Server.Runtime;

namespace Blok.Server.Documents;

/// <summary>Entry point for document conversion outside dependency injection.</summary>
public static class BlokDocuments
{
  /// <summary>
  /// The smallest <c>allocationBudgetBytes</c> <see cref="Create"/> accepts:
  /// 8 MiB. Below this the embedded bundle cannot even be loaded into an
  /// engine, so no conversion could ever run.
  /// </summary>
  /// <remarks>
  /// A floor, not a recommendation. Loading the bundle was measured to allocate
  /// just over 8 MiB, and 9 MiB is the smallest value measured to load AND
  /// convert a short document. A service converting real articles wants the
  /// 512 MiB default; lower it only to bound a hostile document, and measure
  /// against your own content when you do.
  /// </remarks>
  public const long MinimumAllocationBudgetBytes = JintBlokRuntime.MinimumAllocationBudgetBytes;

  /// <summary>
  /// The smallest <c>timeout</c> <see cref="Create"/> accepts: 100 milliseconds.
  /// </summary>
  /// <remarks>
  /// A floor, not a recommendation. Loading the bundle runs under this same
  /// timeout and was measured to need between 300 and 350 milliseconds on one
  /// machine, so a value anywhere near this floor will fail at construction on
  /// most of them. It is here to catch a host that passed milliseconds meaning
  /// seconds. Leave the ten-second default unless a conversion is measured
  /// against it.
  /// </remarks>
  public static readonly TimeSpan MinimumTimeout = JintBlokRuntime.MinimumTimeout;

  /// <summary>
  /// Creates a converter over a fresh engine pool. Creating one is expensive —
  /// each engine parses the embedded Blok bundle — so hold the instance for the
  /// lifetime of the process rather than creating one per request.
  /// </summary>
  /// <param name="poolSize">
  /// How many documents may convert concurrently; further callers wait for a
  /// free engine. Defaults to the processor count, capped at four.
  /// </param>
  /// <param name="timeout">
  /// How long one conversion may run before it is abandoned and its engine
  /// replaced. It also bounds loading the bundle into each engine, so a value
  /// under a second or so fails here rather than at conversion time. Defaults
  /// to ten seconds, and must be at least <see cref="MinimumTimeout"/>.
  /// </param>
  /// <param name="allocationBudgetBytes">
  /// How much ONE conversion may allocate. This is allocation churn per call,
  /// NOT resident memory: the runtime counts every allocation a conversion
  /// makes rather than what it still holds, and nothing is reserved, so a host
  /// that converts small documents pays nothing for a large budget. Defaults to
  /// 512 MiB, which is what a long article carrying inline markup, or one
  /// holding a large inline base64 image, was measured to need. Lower it only
  /// to bound a hostile document. Must be at least
  /// <see cref="MinimumAllocationBudgetBytes"/>.
  /// </param>
  /// <exception cref="ArgumentOutOfRangeException">
  /// <paramref name="poolSize"/> is under one, <paramref name="timeout"/> is under
  /// <see cref="MinimumTimeout"/>, or <paramref name="allocationBudgetBytes"/> is
  /// under <see cref="MinimumAllocationBudgetBytes"/>.
  /// </exception>
  /// <exception cref="BlokRuntimeStartupException">
  /// The bundle could not be loaded into an engine — which above the floors
  /// still means a starved timeout or allocation budget. The message names the
  /// one that ran out.
  /// </exception>
  public static IBlokDocumentConverter Create(
      int? poolSize = null,
      TimeSpan? timeout = null,
      long? allocationBudgetBytes = null)
  {
    return new BlokDocumentConverter(
        JintBlokRuntime.FromEmbeddedResource(poolSize, timeout, allocationBudgetBytes));
  }
}
