using Blok.Server.Runtime;

namespace Blok.Server.Documents;

/// <summary>Entry point for document conversion outside dependency injection.</summary>
public static class BlokDocuments
{
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
  /// to ten seconds.
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
  public static IBlokDocumentConverter Create(
      int? poolSize = null,
      TimeSpan? timeout = null,
      long? allocationBudgetBytes = null)
  {
    return new BlokDocumentConverter(
        JintBlokRuntime.FromEmbeddedResource(poolSize, timeout, allocationBudgetBytes));
  }
}
