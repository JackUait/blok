namespace Blok.Server.Documents;

/// <summary>
/// Blok's embedded JavaScript runtime could not be built, so no conversion can
/// run through it.
/// </summary>
/// <remarks>
/// Blok's own so that a host never has to reference the engine package or name
/// its exception types to understand why its process would not start — the same
/// promise <see cref="BlokDocumentConversionException"/> makes for a conversion.
/// The engine's exception is kept as <see cref="Exception.InnerException"/> for
/// a log, not for a type test.
/// <para>
/// It derives from <see cref="InvalidOperationException"/> because that is what
/// building a runtime threw before it had a type of its own; a host already
/// catching that keeps working.
/// </para>
/// </remarks>
public sealed class BlokRuntimeStartupException : InvalidOperationException
{
  /// <inheritdoc/>
  public BlokRuntimeStartupException()
      : base("Blok's runtime bundle could not be loaded into an engine.")
  {
  }

  /// <inheritdoc/>
  public BlokRuntimeStartupException(string message)
      : base(message)
  {
  }

  /// <inheritdoc/>
  public BlokRuntimeStartupException(string message, Exception innerException)
      : base(message, innerException)
  {
  }
}
