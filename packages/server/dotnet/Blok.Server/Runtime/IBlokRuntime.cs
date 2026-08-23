namespace Blok.Server.Runtime;

internal interface IBlokRuntime
{
  ValueTask<string> InvokeAsync(
      string operation,
      string inputJson,
      CancellationToken cancellationToken = default);
}
