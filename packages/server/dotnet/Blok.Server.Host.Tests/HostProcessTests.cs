using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Blok.Server.AspNetCore;
using Blok.Server.Host;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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

    using var uploadByUrl = await host.Client.PostAsync(
        "/upload-by-url",
        new StringContent("", Encoding.UTF8, "application/json"));
    Assert.Equal(HttpStatusCode.BadRequest, uploadByUrl.StatusCode);
    Assert.Equal(
        "expected {\"url\": \"...\"}\n",
        await uploadByUrl.Content.ReadAsStringAsync());
  }

  [Fact]
  public async Task PublishedHostReportsTheSuppliedBuildVersion()
  {
    var outputDirectory = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-publish-version-{Guid.NewGuid():N}");
    Directory.CreateDirectory(outputDirectory);

    try
    {
      var projectPath = Path.GetFullPath(Path.Combine(
          AppContext.BaseDirectory,
          "..",
          "..",
          "..",
          "..",
          "Blok.Server.Host",
          "Blok.Server.Host.csproj"));
      var startInfo = new ProcessStartInfo("dotnet")
      {
        RedirectStandardError = true,
        RedirectStandardOutput = true,
        UseShellExecute = false,
      };

      // Reused MSBuild workers keep the redirected pipes open.
      startInfo.Environment["MSBUILDDISABLENODEREUSE"] = "1";

      foreach (var argument in new[]
      {
        "publish",
        projectPath,
        "--configuration",
        "Release",
        "--output",
        outputDirectory,
        "-p:AssemblyName=blok-server",
        "-p:BlokServerVersion=1.2.3",
      })
      {
        startInfo.ArgumentList.Add(argument);
      }

      using var publish = Process.Start(startInfo) ??
          throw new InvalidOperationException("Could not start dotnet publish");
      var standardOutput = publish.StandardOutput.ReadToEndAsync();
      var standardError = publish.StandardError.ReadToEndAsync();
      using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(2));

      try
      {
        await publish.WaitForExitAsync(deadline.Token);
      }
      catch (OperationCanceledException)
      {
        publish.Kill(entireProcessTree: true);
        await publish.WaitForExitAsync();
        throw new TimeoutException("dotnet publish did not exit within 2 minutes");
      }

      Assert.True(
          publish.ExitCode == 0,
          $"dotnet publish exited with {publish.ExitCode}:{Environment.NewLine}" +
          $"{await standardOutput}{Environment.NewLine}{await standardError}");

      await using var host = await StartHostAsync(
          ["--listen", AllocateListenAddress()],
          assemblyPath: Path.Combine(outputDirectory, "blok-server.dll"));
      using var health = await host.Client.GetAsync("/health");

      Assert.Equal(HttpStatusCode.OK, health.StatusCode);
      Assert.Equal(
          "{\"status\":\"ok\",\"version\":\"1.2.3\"}\n",
          await health.Content.ReadAsStringAsync());
    }
    finally
    {
      if (Directory.Exists(outputDirectory))
      {
        Directory.Delete(outputDirectory, recursive: true);
      }
    }
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
  public async Task RemovesTheEndpointSpoolAfterMalformedTrailingData()
  {
    const string boundary = "blok-host-malformed-cleanup-boundary";
    var root = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-malformed-cleanup-{Guid.NewGuid():N}");
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
      var body = Encoding.UTF8.GetBytes(
          $"--{boundary}\r\n" +
          "Content-Disposition: form-data; name=\"file\"; filename=\"first.txt\"\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "valid file\r\n" +
          $"--{boundary}\r\n" +
          "Content-Disposition: form-data; name=\"note\"\r\n" +
          "Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
          "=\r\n" +
          $"--{boundary}--\r\n");
      using var content = new ByteArrayContent(body);
      content.Headers.TryAddWithoutValidation(
          "Content-Type",
          $"multipart/form-data; boundary={boundary}");

      using var response = await host.Client.PostAsync("/upload", content);

      Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
      Assert.Equal(
          "malformed upload\n",
          await response.Content.ReadAsStringAsync());
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
  public async Task RemovesTheEndpointSpoolAfterStorageFailure()
  {
    var root = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-storage-failure-cleanup-{Guid.NewGuid():N}");
    var temporaryDirectory = Path.Combine(root, "temp");
    var storagePath = Path.Combine(root, "storage-file");
    Directory.CreateDirectory(temporaryDirectory);
    await File.WriteAllTextAsync(storagePath, "occupied");

    try
    {
      await using var host = await StartHostAsync(
      [
        "--listen", AllocateListenAddress(),
        "--storage-dir", storagePath,
      ],
      new Dictionary<string, string?>
      {
        ["TMPDIR"] = temporaryDirectory,
      });
      using var multipart = new MultipartFormDataContent(
          "blok-host-storage-failure-cleanup-boundary");
      using var file = new ByteArrayContent("uploaded bytes"u8.ToArray());
      multipart.Add(file, "file", "upload.bin");

      using var response = await host.Client.PostAsync("/upload", multipart);

      Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
      Assert.Equal(
          "upload failed\n",
          await response.Content.ReadAsStringAsync());
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
  public async Task CancelsBlockedStorageWorkAtTheHostDeadline()
  {
    using var upstream = new TcpListener(IPAddress.Loopback, 0);
    upstream.Start();
    var upstreamEndpoint = Assert.IsType<IPEndPoint>(upstream.LocalEndpoint);
    var listen = AllocateListenAddress();
    var options = new BlokServerOptions
    {
      ListenAddress = listen,
      S3AccessKey = "access-key",
      S3Addressing = "path",
      S3Bucket = "media",
      S3BucketUrl = "https://uploads.example/media",
      S3Endpoint = $"http://127.0.0.1:{upstreamEndpoint.Port}",
      S3Region = "eu-test-1",
      S3SecretKey = "secret-key",
    };
    await using var host = await StartDeadlineHostAsync(
        listen,
        options,
        TimeSpan.FromSeconds(2));
    using var client = new HttpClient
    {
      BaseAddress = new Uri($"http://{listen}"),
      Timeout = TimeSpan.FromSeconds(5),
    };
    using var multipart = new MultipartFormDataContent(
        "blok-host-storage-deadline-boundary");
    using var file = new ByteArrayContent("uploaded bytes"u8.ToArray());
    multipart.Add(file, "file", "slow.bin");
    var responseTask = client.PostAsync("/upload", multipart);
    using var acceptDeadline =
        new CancellationTokenSource(TimeSpan.FromSeconds(5));
    using var upstreamConnection = await upstream.AcceptTcpClientAsync(
        acceptDeadline.Token);
    await using var upstreamStream = upstreamConnection.GetStream();
    using var request = new MemoryStream();
    var buffer = new byte[4096];
    var expectedLength = -1L;
    var headerLength = -1;

    while (headerLength < 0 || request.Length < headerLength + expectedLength)
    {
      var received = await upstreamStream.ReadAsync(
          buffer,
          acceptDeadline.Token);
      Assert.NotEqual(0, received);
      request.Write(buffer, 0, received);
      var requestText = Encoding.ASCII.GetString(request.ToArray());
      var headerEnd = requestText.IndexOf("\r\n\r\n", StringComparison.Ordinal);

      if (headerEnd >= 0 && headerLength < 0)
      {
        headerLength = headerEnd + 4;
        var contentLengthHeader = requestText[..headerEnd]
            .Split("\r\n", StringSplitOptions.None)
            .Single(line => line.StartsWith(
                "Content-Length:",
                StringComparison.OrdinalIgnoreCase));
        expectedLength = long.Parse(
            contentLengthHeader["Content-Length:".Length..],
            System.Globalization.CultureInfo.InvariantCulture);
      }
    }

    using var response = await responseTask;
    Assert.Equal(HttpStatusCode.GatewayTimeout, response.StatusCode);

    var cancellationObserved = false;
    using var cancellationDeadline =
        new CancellationTokenSource(TimeSpan.FromSeconds(5));

    try
    {
      cancellationObserved = await upstreamStream.ReadAsync(
          buffer,
          cancellationDeadline.Token) == 0;
    }
    catch (IOException)
    {
      cancellationObserved = true;
    }

    Assert.True(
        cancellationObserved,
        "The timed-out request did not cancel the blocked blob-store request.");
  }

  [Fact]
  public async Task CancelsAStalledRequestBodyAtTheHostDeadline()
  {
    const string boundary = "blok-host-deadline-boundary";
    var listen = AllocateListenAddress();
    var port = int.Parse(
        listen[(listen.LastIndexOf(':') + 1)..],
        System.Globalization.CultureInfo.InvariantCulture);
    var directory = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-deadline-{Guid.NewGuid():N}");

    try
    {
      var options = new BlokServerOptions
      {
        ListenAddress = listen,
        PublicUrl = $"http://{listen}/files",
        StorageDirectory = directory,
      };
      await using var host = await StartDeadlineHostAsync(
          listen,
          options,
          TimeSpan.FromMilliseconds(500));
      using var connection = new TcpClient();
      await connection.ConnectAsync(IPAddress.Loopback, port);
      await using var stream = connection.GetStream();
      var request = Encoding.ASCII.GetBytes(
          "POST /upload HTTP/1.1\r\n" +
          $"Host: 127.0.0.1:{port}\r\n" +
          $"Content-Type: multipart/form-data; boundary={boundary}\r\n" +
          "Content-Length: 100000\r\n" +
          "Connection: close\r\n\r\n" +
          $"--{boundary}\r\n" +
          "Content-Disposition: form-data; name=\"file\"; filename=\"slow.bin\"\r\n" +
          "Content-Type: application/octet-stream\r\n\r\n" +
          "partial");
      await stream.WriteAsync(request);
      var response = new byte[4096];
      using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
      var received = await stream.ReadAsync(response, deadline.Token);

      Assert.Contains(
          "HTTP/1.1 504",
          Encoding.ASCII.GetString(response, 0, received),
          StringComparison.Ordinal);
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
  public async Task RefusesAMalformedLocalPublicUrlBeforeBinding()
  {
    var listen = AllocateListenAddress();
    var port = int.Parse(
        listen[(listen.LastIndexOf(':') + 1)..],
        System.Globalization.CultureInfo.InvariantCulture);
    using var process = StartProcess(
    [
      "--listen", listen,
      "--public-url", "https://uploads.example/%zz",
    ],
    environment: null);
    var exited = false;
    var listenerOpened = false;

    try
    {
      using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));

      try
      {
        await process.WaitForExitAsync(deadline.Token);
        exited = true;
      }
      catch (OperationCanceledException)
      {
        using var connectionDeadline =
            new CancellationTokenSource(TimeSpan.FromSeconds(1));
        using var client = new TcpClient();

        try
        {
          await client.ConnectAsync(
              IPAddress.Loopback,
              port,
              connectionDeadline.Token);
          listenerOpened = true;
        }
        catch (Exception error) when (
            error is OperationCanceledException or SocketException)
        {
        }
      }
    }
    finally
    {
      if (!process.HasExited)
      {
        process.Kill(entireProcessTree: true);
      }

      await process.WaitForExitAsync();
    }

    var standardError = await process.StandardError.ReadToEndAsync();
    Assert.True(exited, "Host did not refuse the malformed public URL.");
    Assert.False(listenerOpened, "Host opened a listener for the malformed public URL.");
    Assert.Equal(1, process.ExitCode);
    Assert.Contains("PublicUrl", standardError, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("*:4000")]
  [InlineData("+:4000")]
  public void UsesALoopbackPublicUrlForWildcardListeners(string listenAddress)
  {
    var parsed = HostArguments.Parse(
        ["--listen", listenAddress],
        _ => null);
    var options = Assert.IsType<BlokServerOptions>(parsed.Options);

    Assert.Equal("http://127.0.0.1:4000/files", options.PublicUrl);
  }

  [Theory]
  [InlineData("none", 0)]
  [InlineData("proxy", 0)]
  [InlineData("ticket", 60)]
  public void UsesTheAuthDefaultRateLimitWhenTheFlagIsOmitted(
      string auth,
      long expectedRateLimit)
  {
    var parsed = HostArguments.Parse(
        ["--auth", auth],
        _ => null);
    var options = Assert.IsType<BlokServerOptions>(parsed.Options);

    Assert.Equal(expectedRateLimit, options.RateLimitPerMinute);
  }

  [Fact]
  public void DescribesTheAutomaticRateLimitDefaults()
  {
    Assert.Contains(
        "ticket mode defaults to 60",
        HostArguments.Usage,
        StringComparison.Ordinal);
    Assert.Contains(
        "other modes default to 0",
        HostArguments.Usage,
        StringComparison.Ordinal);
    Assert.DoesNotContain(
        "default -1",
        HostArguments.Usage,
        StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("-1")]
  [InlineData("-2")]
  [InlineData("-010")]
  [InlineData("-0x1")]
  public void RejectsEveryExplicitNegativeRateLimit(string value)
  {
    var parsed = HostArguments.Parse(
        ["--rate-limit", value],
        _ => null);
    var options = Assert.IsType<BlokServerOptions>(parsed.Options);

    var error = Assert.Throws<InvalidOperationException>(options.Validate);

    Assert.Contains("--rate-limit", error.Message, StringComparison.Ordinal);
  }

  public static TheoryData<string> BaseZeroIntegerSpellings =>
    new()
    {
      "16",
      "+16",
      "020",
      "0o20",
      "0x10",
      "0b10000",
      "1_6",
    };

  [Theory]
  [MemberData(nameof(BaseZeroIntegerSpellings))]
  public async Task AcceptsTheFrozenBaseZeroIntegerGrammar(string value)
  {
    await using var host = await StartHostAsync(
    [
      "--listen", AllocateListenAddress(),
      "--storage-dir", "",
      "--max-upload", value,
      "--rate-limit", value,
    ]);

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
  }

  public static TheoryData<string, string> InvalidBaseZeroIntegers =>
    new()
    {
      { "--max-upload", "08" },
      { "--max-upload", "1__0" },
      { "--max-upload", "0x8000000000000000" },
      { "--rate-limit", "0x8000000000000000" },
    };

  [Theory]
  [MemberData(nameof(InvalidBaseZeroIntegers))]
  public async Task RefusesInvalidOrOverflowingBaseZeroIntegers(
      string flag,
      string value)
  {
    var result = await RunHostCommandAsync(
    [
      "--listen", "0.0.0.0:0",
      "--storage-dir", "",
      flag, value,
    ]);

    Assert.Equal(2, result.ExitCode);
    Assert.Contains(
        $"invalid value \"{value}\" for flag -{flag[2..]}",
        result.StandardError,
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task KeepsParseAndValidationExitCodesDistinctForSignedValues()
  {
    var result = await RunHostCommandAsync(
    [
      "--listen", "127.0.0.1:0",
      "--storage-dir", "",
      "--max-upload", "-0x1",
    ]);

    Assert.Equal(1, result.ExitCode);
    Assert.Contains(
        "--max-upload must be a positive number of bytes (got -1)",
        result.StandardError,
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task AcceptsASigned64BitRateLimit()
  {
    await using var host = await StartHostAsync(
    [
      "--listen", AllocateListenAddress(),
      "--storage-dir", "",
      "--rate-limit", "0x80000000",
    ]);

    using var health = await host.Client.GetAsync("/health");
    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
  }

  [Fact]
  public async Task TreatsALeadingZeroMaximumAsOctal()
  {
    const int formerDefaultMaximum = 8 << 20;
    var directory = Path.Combine(
        Path.GetTempPath(),
        $"blok-host-octal-upload-{Guid.NewGuid():N}");

    try
    {
      await using var host = await StartHostAsync(
      [
        "--listen", AllocateListenAddress(),
        "--storage-dir", directory,
        "--max-upload", "040000000",
      ]);
      using var content =
          new ByteArrayContent(new byte[formerDefaultMaximum + 1]);
      using var request = new HttpRequestMessage(HttpMethod.Post, "/upload")
      {
        Content = content,
      };
      request.Headers.ExpectContinue = true;
      using var response = await host.Client.SendAsync(request);

      Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
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
  public async Task TreatsALeadingZeroRateLimitAsOctal()
  {
    await using var host = await StartHostAsync(
    [
      "--listen", AllocateListenAddress(),
      "--storage-dir", "",
      "--rate-limit", "010",
    ]);

    for (var request = 1; request <= 8; request++)
    {
      using var accepted = await host.Client.GetAsync("/unfurl");
      Assert.Equal(HttpStatusCode.BadRequest, accepted.StatusCode);
    }

    using var rejected = await host.Client.GetAsync("/unfurl");
    Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
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

  [Fact]
  public async Task ReportsListeningOnlyAfterBindingSucceeds()
  {
    using var occupied = new TcpListener(IPAddress.Loopback, 0);
    occupied.Start();
    var port = ((IPEndPoint)occupied.LocalEndpoint).Port;

    var result = await RunHostCommandAsync(
    [
      "--listen", $"127.0.0.1:{port}",
      "--storage-dir", "",
    ]);

    Assert.Equal(1, result.ExitCode);
    Assert.Contains("refused to start", result.StandardError);
    Assert.DoesNotContain("listening on", result.StandardError);
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
        "--s3-endpoint must be a full HTTP(S) origin without credentials, a path, a query or a fragment",
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

  private static async Task<WebApplication> StartDeadlineHostAsync(
      string listenAddress,
      BlokServerOptions options,
      TimeSpan requestTimeout)
  {
    var builder = WebApplication.CreateBuilder(
        new WebApplicationOptions { Args = [] });
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls($"http://{listenAddress}");
    HostRequestTimeouts.Configure(builder, requestTimeout);
    builder.Services.AddBlokServer(options);
    var app = builder.Build();
    HostRequestTimeouts.Use(app);
    app.MapBlokServer();
    await app.StartAsync();

    return app;
  }

  private static async Task<RunningHost> StartHostAsync(
      string[] args,
      IReadOnlyDictionary<string, string?>? environment = null,
      string? assemblyPath = null)
  {
    var process = StartProcess(args, environment, assemblyPath);
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
