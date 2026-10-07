namespace Blok.Server.Runtime;

internal interface IBlokRuntime
{
  /// <param name="operation">The runtime operation to run.</param>
  /// <param name="inputJson">Its input.</param>
  /// <param name="timeout">
  /// This call's wall-clock budget, in place of the runtime's default. For a
  /// one-off job that may need more; ordinary calls leave it null.
  /// </param>
  /// <param name="cancellationToken">Ends the wait for an engine and the call.</param>
  ValueTask<string> InvokeAsync(
      string operation,
      string inputJson,
      TimeSpan? timeout = null,
      CancellationToken cancellationToken = default);
}
