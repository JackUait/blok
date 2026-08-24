using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Xunit;

namespace Blok.Server.Host.Tests;

public sealed class HostProcessTests
{
  private const string ValidSecret = "a-secret-value-with-at-least-32-characters";

  [Fact]
  public async Task StartsWithDefaultsAndReportsTheDevelopmentVersion()
  {
    await using var host = await StartHostAsync(["--listen", AllocateListenAddress()]);

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    Assert.Equal("application/json", health.Content.Headers.ContentType?.ToString());
    Assert.Equal("{\"status\":\"ok\",\"version\":\"dev\"}\n", await health.Content.ReadAsStringAsync());

    using var unfurl = await host.Client.GetAsync("/unfurl");
    Assert.Equal(HttpStatusCode.BadRequest, unfurl.StatusCode);
    Assert.Equal("{\"success\":0}\n", await unfurl.Content.ReadAsStringAsync());

    using var upload = await host.Client.PostAsync("/upload", new StringContent(""));
    Assert.Equal(HttpStatusCode.BadRequest, upload.StatusCode);
    Assert.Equal("malformed upload\n", await upload.Content.ReadAsStringAsync());

    using var uploadByUrl = await host.Client.PostAsync("/upload-by-url", new StringContent(""));
    Assert.Equal(HttpStatusCode.NotImplemented, uploadByUrl.StatusCode);
  }

  [Fact]
  public async Task AcceptsAnUploadBetweenKestrelsDefaultAndTheConfiguredDefaultCap()
  {
    const int fileSize = 30_100_000;
    var directory = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-large-upload-{Guid.NewGuid():N}");

    try
    {
      await using var host = await StartHostAsync(
      [
        "--listen", AllocateListenAddress(),
        "--storage-dir", directory,
      ]);
      using var client = new HttpClient
      {
        BaseAddress = host.Client.BaseAddress,
        Timeout = TimeSpan.FromSeconds(30),
      };
      using var multipart = new MultipartFormDataContent(
          "blok-host-large-upload-boundary");
      using var file = new ByteArrayContent(new byte[fileSize]);
      file.Headers.ContentType = new("application/octet-stream");
      multipart.Add(file, "file", "large.bin");

      using var response = await client.PostAsync("/upload", multipart);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      using var payload = JsonDocument.Parse(
          await response.Content.ReadAsStringAsync());
      Assert.Equal(
          fileSize,
          payload.RootElement.GetProperty("size").GetInt64());
    }
    finally
    {
      if (Directory.Exists(directory))
      {
        Directory.Delete(directory, recursive: true);
      }
    }
  }

  [Fact]
  public async Task RemovesTheEndpointSpoolAfterASuccessfulUpload()
  {
    var root = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-upload-cleanup-{Guid.NewGuid():N}");
    var temporaryDirectory = Path.Combine(root, "temp");
    var storageDirectory = Path.Combine(root, "storage");
    Directory.CreateDirectory(temporaryDirectory);

    try
    {
      await using var host = await StartHostAsync(
      [
        "--listen", AllocateListenAddress(),
        "--storage-dir", storageDirectory,
      ],
      new Dictionary<string, string?>
      {
        ["TMPDIR"] = temporaryDirectory,
      });
      using var multipart = new MultipartFormDataContent(
          "blok-host-spool-cleanup-boundary");
      using var file = new ByteArrayContent("uploaded bytes"u8.ToArray());
      multipart.Add(file, "file", "upload.bin");

      using var response = await host.Client.PostAsync("/upload", multipart);

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      Assert.Empty(
          Directory.GetFiles(temporaryDirectory, ".blok-upload-*"));
    }
    finally
    {
      if (Directory.Exists(root))
      {
        Directory.Delete(root, recursive: true);
      }
    }
  }

  [Fact]
  public async Task AcceptsEveryFlagAndLetsAnExplicitSecretOverrideTheEnvironment()
  {
    var listen = AllocateListenAddress();
    await using var host = await StartHostAsync(
    [
      "--listen", listen,
      "--auth", "ticket",
      "--secret", ValidSecret,
      "--allow-origin", "https://app.example.com, https://admin.example.com",
      "--storage-dir", "",
      "--public-url", "https://uploads.example.com/files",
      "--max-upload", "1024",
      "--rate-limit", "7",
      "--no-unfurl",
      "--s3-endpoint", "https://s3.example.com",
      "--s3-region", "eu-central-1",
      "--s3-bucket", "blok",
      "--s3-bucket-url", "https://uploads.example.com",
      "--s3-addressing", "path",
    ],
    new Dictionary<string, string?>
    {
      ["BLOK_SECRET"] = "short",
      ["BLOK_S3_ACCESS_KEY"] = "access-key",
      ["BLOK_S3_SECRET_KEY"] = "secret-key",
    });

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);

    using var unfurl = await host.Client.GetAsync("/unfurl");
    Assert.Equal(HttpStatusCode.NotFound, unfurl.StatusCode);

    using var upload = await host.Client.PostAsync("/upload", new StringContent(""));
    Assert.Equal(HttpStatusCode.Forbidden, upload.StatusCode);
    Assert.Equal("origin not allowed\n", await upload.Content.ReadAsStringAsync());

    using var uploadByUrl = await host.Client.PostAsync("/upload-by-url", new StringContent(""));
    Assert.Equal(HttpStatusCode.NotFound, uploadByUrl.StatusCode);
  }

  [Fact]
  public async Task ReadsTheTicketSecretFromTheEnvironment()
  {
    await using var host = await StartHostAsync(
    [
      "--listen", AllocateListenAddress(),
      "--auth", "ticket",
      "--allow-origin", "https://app.example.com",
      "--storage-dir", "",
    ],
    new Dictionary<string, string?> { ["BLOK_SECRET"] = ValidSecret });

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
  }

  [Fact]
  public async Task StartsOnABlankHostListenerInTicketMode()
  {
    var listen = $":{AllocatePort()}";
    await using var host = await StartHostAsync(
    [
      "--listen", listen,
      "--auth", "ticket",
      "--secret", ValidSecret,
      "--allow-origin", "https://app.example.com",
      "--storage-dir", "",
    ]);

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
  }

  [Fact]
  public async Task KeepsPortZeroWhenBindingABlankHostListener()
  {
    using var process = StartProcess(
    [
      "--listen", ":0",
      "--auth", "ticket",
      "--secret", ValidSecret,
      "--allow-origin", "https://app.example.com",
      "--storage-dir", "",
    ],
    environment: null);

    try
    {
      await WaitForStandardErrorAsync(process, "listening on :0", TimeSpan.FromSeconds(10));
      var exited = process.WaitForExitAsync();
      var remainedRunning = Task.Delay(500);

      Assert.Same(remainedRunning, await Task.WhenAny(exited, remainedRunning));
    }
    finally
    {
      if (!process.HasExited)
      {
        process.Kill(entireProcessTree: true);
      }

      await process.WaitForExitAsync();
    }
  }

  [Fact]
  public async Task AnExplicitSecretWinsEvenWhenItIsInvalid()
  {
    var result = await RunHostCommandAsync(
    [
      "--listen", AllocateListenAddress(),
      "--auth", "ticket",
      "--secret", "short",
      "--allow-origin", "https://app.example.com",
    ],
    new Dictionary<string, string?> { ["BLOK_SECRET"] = ValidSecret });

    Assert.Equal(1, result.ExitCode);
    Assert.Contains("--secret must be at least 32 characters (got 5)", result.StandardError);
  }

  public static TheoryData<string[], int, string, Dictionary<string, string?>?> InvalidCommandCases =>
    new()
    {
      { ["--help"], 0, "Usage of blok-server:", null },
      { ["--not-a-real-flag"], 2, "flag provided but not defined: -not-a-real-flag", null },
      { ["--max-upload", "not-a-number"], 2, "invalid value \"not-a-number\" for flag -max-upload", null },
      { ["--auth", "unknown"], 1, "--auth must be none, proxy, or ticket (got \"unknown\")", null },
      { ["--listen", "0.0.0.0:4000"], 1, "--auth none", null },
      { ["--listen", $":{AllocatePort()}"], 1, "--auth none", null },
      { ["--listen", $":{AllocatePort()}", "--auth", "proxy"], 1, "--auth proxy", null },
      {
        ["--listen", "localhost"],
        1,
        "listen tcp: address localhost: missing port in address",
        null
      },
      {
        ["--listen", "localhost:65536"],
        1,
        "listen tcp: address 65536: invalid port",
        null
      },
      {
        ["--auth", "ticket", "--secret", "short", "--allow-origin", "https://app.example.com"],
        1,
        "--secret must be at least 32 characters (got 5)",
        null
      },
      {
        ["--auth", "ticket", "--secret", ValidSecret],
        1,
        "a public service needs --allow-origin",
        null
      },
      { ["--s3-bucket", "blok"], 1, "--s3-bucket needs --s3-endpoint", null },
      {
        [
          "--s3-bucket", "blok",
          "--s3-endpoint", "s3.example.test",
          "--s3-region", "eu-central-1",
          "--s3-bucket-url", "https://uploads.example.test",
        ],
        1,
        "--s3-endpoint must be a full URL with a scheme and a host",
        S3Credentials()
      },
      {
        [
          "--s3-bucket", "blok",
          "--s3-endpoint", "https://s3.example.test",
          "--s3-bucket-url", "https://uploads.example.test",
        ],
        1,
        "--s3-bucket needs --s3-region",
        S3Credentials()
      },
      {
        [
          "--s3-bucket", "blok",
          "--s3-endpoint", "https://s3.example.test",
          "--s3-region", "eu-central-1",
        ],
        1,
        "--s3-bucket needs --s3-bucket-url",
        S3Credentials()
      },
      {
        [
          "--s3-bucket", "blok",
          "--s3-endpoint", "https://s3.example.test",
          "--s3-region", "eu-central-1",
          "--s3-bucket-url", "https://uploads.example.test",
        ],
        1,
        "BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY",
        null
      },
      {
        [
          "--s3-bucket", "blok",
          "--s3-endpoint", "https://s3.example.test",
          "--s3-region", "eu-central-1",
          "--s3-bucket-url", "https://uploads.example.test",
          "--s3-addressing", "dns",
        ],
        1,
        "--s3-addressing must be \"path\" or \"virtual\"",
        S3Credentials()
      },
      {
        ["--listen", "127.0.0.1:0", "--storage-dir", "", "--max-upload", "0"],
        1,
        "--max-upload must be a positive number of bytes (got 0): a zero cap refuses every upload",
        null
      },
    };

  [Theory]
  [MemberData(nameof(InvalidCommandCases))]
  public async Task ExitsWithTheContractCode(
      string[] args,
      int expectedExitCode,
      string expectedError,
      Dictionary<string, string?>? environment)
  {
    var result = await RunHostCommandAsync(args, environment);

    Assert.Equal(expectedExitCode, result.ExitCode);
    Assert.Contains(expectedError, result.StandardError);
  }

  private static Dictionary<string, string?> S3Credentials()
  {
    return new Dictionary<string, string?>
    {
      ["BLOK_S3_ACCESS_KEY"] = "access-key",
      ["BLOK_S3_SECRET_KEY"] = "secret-key",
    };
  }

  private static async Task<RunningHost> StartHostAsync(
      string[] args,
      IReadOnlyDictionary<string, string?>? environment = null)
  {
    var process = StartProcess(args, environment);
    var listen = RequiredListenAddress(args);
    var clientAddress = listen.StartsWith(':')
      ? $"127.0.0.1{listen}"
      : listen;
    var client = new HttpClient
    {
      BaseAddress = new Uri($"http://{clientAddress}"),
      Timeout = TimeSpan.FromSeconds(1),
    };
    var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
    Exception? lastError = null;

    while (DateTime.UtcNow < deadline)
    {
      if (process.HasExited)
      {
        var exitCode = process.ExitCode;
        var standardError = await process.StandardError.ReadToEndAsync();
        process.Dispose();
        client.Dispose();
        throw new InvalidOperationException(
            $"Host exited before becoming healthy with code {exitCode}: {standardError}");
      }

      try
      {
        using var response = await client.GetAsync("/health");

        if (response.StatusCode == HttpStatusCode.OK)
        {
          return new RunningHost(process, client);
        }
      }
      catch (HttpRequestException error)
      {
        lastError = error;
      }
      catch (TaskCanceledException error)
      {
        lastError = error;
      }

      await Task.Delay(50);
    }

    process.Kill(entireProcessTree: true);
    await process.WaitForExitAsync();
    process.Dispose();
    client.Dispose();
    throw new TimeoutException($"Host did not become healthy: {lastError?.Message}");
  }

  private static async Task<CommandResult> RunHostCommandAsync(
      string[] args,
      IReadOnlyDictionary<string, string?>? environment = null)
  {
    using var process = StartProcess(args, environment);
    var standardError = process.StandardError.ReadToEndAsync();
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));

    try
    {
      await process.WaitForExitAsync(deadline.Token);
    }
    catch (OperationCanceledException)
    {
      process.Kill(entireProcessTree: true);
      await process.WaitForExitAsync();
      throw new TimeoutException("Host command did not exit within 5 seconds");
    }

    return new CommandResult(process.ExitCode, await standardError);
  }

  private static Process StartProcess(
      string[] args,
      IReadOnlyDictionary<string, string?>? environment)
  {
    var startInfo = new ProcessStartInfo("dotnet")
    {
      RedirectStandardError = true,
      UseShellExecute = false,
      WorkingDirectory = Path.GetTempPath(),
    };
    startInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Blok.Server.Host.dll"));

    foreach (var arg in args)
    {
      startInfo.ArgumentList.Add(arg);
    }

    startInfo.Environment["BLOK_SECRET"] = "";
    startInfo.Environment["BLOK_S3_ACCESS_KEY"] = "";
    startInfo.Environment["BLOK_S3_SECRET_KEY"] = "";

    if (environment is not null)
    {
      foreach (var (key, value) in environment)
      {
        startInfo.Environment[key] = value ?? "";
      }
    }

    return Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start the host process");
  }

  private static async Task WaitForStandardErrorAsync(
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
        return;
      }
    }
  }

  private static string RequiredListenAddress(string[] args)
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

  private static string AllocateListenAddress()
  {
    return $"127.0.0.1:{AllocatePort()}";
  }

  private static int AllocatePort()
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var endpoint = Assert.IsType<IPEndPoint>(listener.LocalEndpoint);

    return endpoint.Port;
  }

  private sealed record CommandResult(
      int ExitCode,
      string StandardError);

  private sealed class RunningHost : IAsyncDisposable
  {
    public RunningHost(Process process, HttpClient client)
    {
      Process = process;
      Client = client;
    }

    public HttpClient Client { get; }

    private Process Process { get; }

    public async ValueTask DisposeAsync()
    {
      Client.Dispose();

      if (!Process.HasExited)
      {
        Process.Kill(entireProcessTree: true);
      }

      await Process.WaitForExitAsync();
      Process.Dispose();
    }
  }
}
