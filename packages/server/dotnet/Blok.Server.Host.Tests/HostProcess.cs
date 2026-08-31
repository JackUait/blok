using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Xunit;

namespace Blok.Server.Host.Tests;

/// <summary>Starts the built host as a real child process and reads its stderr.</summary>
internal static class HostProcess
{
  internal static Process Start(
      string[] args,
      IReadOnlyDictionary<string, string?>? environment,
      string? assemblyPath = null)
  {
    var startInfo = new ProcessStartInfo("dotnet")
    {
      RedirectStandardError = true,
      UseShellExecute = false,
      WorkingDirectory = Path.GetTempPath(),
    };
    startInfo.ArgumentList.Add(
        assemblyPath ?? Path.Combine(AppContext.BaseDirectory, "Blok.Server.Host.dll"));

    foreach (var arg in args)
    {
      startInfo.ArgumentList.Add(arg);
    }

    startInfo.Environment["BLOK_SECRET"] = "";
    startInfo.Environment["BLOK_S3_ACCESS_KEY"] = "";
    startInfo.Environment["BLOK_S3_SECRET_KEY"] = "";
    startInfo.Environment["BLOK_DOC_ENDPOINT_AUTH"] = "";

    if (environment is not null)
    {
      foreach (var (key, value) in environment)
      {
        startInfo.Environment[key] = value ?? "";
      }
    }

    return Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start the host process");
  }

  internal static async Task<IReadOnlyList<string>> WaitForStandardErrorAsync(
      Process process,
      string expected,
      TimeSpan timeout)
  {
    using var deadline = new CancellationTokenSource(timeout);
    var lines = new List<string>();

    while (true)
    {
      string? line;

      try
      {
        line = await process.StandardError.ReadLineAsync(deadline.Token);
      }
      catch (OperationCanceledException)
      {
        throw new TimeoutException(
            $"Host did not write {expected} within {timeout}: {string.Join(Environment.NewLine, lines)}");
      }

      if (line is null)
      {
        throw new InvalidOperationException(
            $"Host exited before writing {expected}: {string.Join(Environment.NewLine, lines)}");
      }

      lines.Add(line);

      if (line.Contains(expected, StringComparison.Ordinal))
      {
        return lines;
      }
    }
  }

  internal static string RequiredListenAddress(string[] args)
  {
    for (var index = 0; index < args.Length; index++)
    {
      if (args[index] == "--listen" && index + 1 < args.Length)
      {
        return args[index + 1];
      }

      const string prefix = "--listen=";

      if (args[index].StartsWith(prefix, StringComparison.Ordinal))
      {
        return args[index][prefix.Length..];
      }
    }

    throw new InvalidOperationException("Host process test needs an explicit --listen address");
  }

  internal static string AllocateListenAddress()
  {
    return $"127.0.0.1:{AllocatePort()}";
  }

  internal static int AllocatePort()
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var endpoint = Assert.IsType<IPEndPoint>(listener.LocalEndpoint);

    return endpoint.Port;
  }
}
