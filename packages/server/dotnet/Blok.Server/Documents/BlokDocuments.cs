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
  public static IBlokDocumentConverter Create(int? poolSize = null)
  {
    return new BlokDocumentConverter(JintBlokRuntime.FromEmbeddedResource(poolSize));
  }
}
