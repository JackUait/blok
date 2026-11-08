using Blok.Server.Mcp;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Http;

namespace Blok.Mcp;

/// <summary>blok-mcp's command line: the same flags, env vars and exit codes as the Node CLI.</summary>
internal static class BlokMcpCli
{
  internal static async Task<int> RunAsync(string[] args, TextWriter stdout)
  {
    var host = BlokMcpHost.CreateRuntime();

    try
    {
      var config = await McpCommandLine.ConfigureAsync(host, args, McpCommandLine.ProcessEnvironment());

      if (config.HttpListen is null)
      {
        return await BlokMcpStdio.RunAsync(host, config);
      }

      return await BlokMcpHttp.RunAsync(host, config);
    }
    catch (BlokMcpConfigException error)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: {error.Message}");

      return 2;
    }
    catch (McpListenException error)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: {error.Message}");

      return 1;
    }
    // Node's top-level await: any other startup failure prints and exits 1.
    catch (Exception error)
    {
      await Console.Error.WriteLineAsync($"Error: {error.Message}");

      return 1;
    }
    finally
    {
      host.Http.Dispose();
    }
  }
}
