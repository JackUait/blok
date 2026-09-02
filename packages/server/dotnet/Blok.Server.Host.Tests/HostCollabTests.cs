using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Blok.Server.Host.Tests;

/// <summary>
/// The host's collaboration wiring (plan decisions 17 and 19): WebSockets in
/// front of the sync endpoint, the SIGTERM drain, and the two timeout
/// windows a live socket must outlast. Every wait carries an explicit
/// deadline; nothing asserts a sub-second absence.
/// </summary>
public sealed class HostCollabTests
{
  private const string DocId = "doc-1";

  /// <summary>Lockstep fixture whose update carries an eight-block tree (see fixtures/collab/manifest.json).</summary>
  private const string FixtureCase = "hierarchy-3-deep";

  private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(10);

  /// <summary>HostOptions.ShutdownTimeout is 30s; a drain that misses it is a failure worth seeing.</summary>
  private static readonly TimeSpan ExitDeadline = TimeSpan.FromSeconds(35);

  [Fact]
  public async Task DrainsSyncRoomsOnSigterm()
  {
    if (OperatingSystem.IsWindows())
    {
      // No SIGTERM on Windows; the drain hook is covered in-process there.
      return;
    }

    var collabDirectory = UniqueDirectory("blok-host-sigterm");
    await using var endpoint = await FixtureDocEndpoint.StartAsync();
    var listen = HostProcess.AllocateListenAddress();
    using var process = HostProcess.Start(
    [
      "--listen", listen,
      "--auth", "none",
      "--storage-dir", "",
      "--rate-limit", "0",
      "--collab",
      "--collab-dir", collabDirectory,
      "--doc-endpoint", endpoint.Url,
    ],
    environment: null);

    try
    {
      await HostProcess.WaitForStandardErrorAsync(process, "listening on", Deadline);

      using var editor = await ConnectAsync(listen);
      await HandshakeAsync(editor);
      using var observer = await ConnectAsync(listen);
      await HandshakeAsync(observer);

      // The observer's relayed copy proves the room applied the edit.
      var update = CollabFixtures.Update(FixtureCase);
      await SendAsync(editor, SyncFrames.Update(update));
      Assert.Equal(update, await ReceiveSyncAsync(observer, SyncFrames.UpdateType));

      var sigterm = Stopwatch.StartNew();
      await SendSigtermAsync(process);

      Assert.Equal((1001, "server shutting down"), await ReceiveCloseAsync(editor));
      Assert.Equal((1001, "server shutting down"), await ReceiveCloseAsync(observer));

      using var exit = new CancellationTokenSource(ExitDeadline);
      await process.WaitForExitAsync(exit.Token);
      Assert.Equal(0, process.ExitCode);
      Assert.True(
          sigterm.Elapsed < ExitDeadline,
          $"the host took {sigterm.Elapsed} to exit after SIGTERM");

      // FlushLocked awaits the export before the 1001 goes out, so the PUT
      // is already recorded once the sockets have closed.
      var put = Assert.Single(endpoint.Puts, put => put.DocId == DocId);
      Assert.Equal(
          CollabFixtures.CanonicalBlockIds(FixtureCase),
          BlockIds(put.Body));

      var blob = new FileInfo(Path.Combine(collabDirectory, Sha256Hex(DocId)));
      Assert.True(blob.Exists, $"no working-set blob at {blob.FullName}");
      // 16 bytes is a header-only (empty-log) working set.
      Assert.True(blob.Length > 16, $"the working-set blob holds no frames ({blob.Length} bytes)");

      var trailingStandardError = await process.StandardError.ReadToEndAsync();
      Assert.DoesNotContain("Unhandled exception", trailingStandardError, StringComparison.Ordinal);
      Assert.DoesNotContain("error:", trailingStandardError, StringComparison.Ordinal);
    }
    finally
    {
      await KillIfRunningAsync(process);
      DeleteDirectory(collabDirectory);
    }
  }

  [Fact]
  public async Task ExitsCleanlyOnSigtermWithoutCollab()
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    using var process = HostProcess.Start(
    [
      "--listen", HostProcess.AllocateListenAddress(),
      "--storage-dir", "",
    ],
    environment: null);

    try
    {
      await HostProcess.WaitForStandardErrorAsync(process, "listening on", Deadline);
      await SendSigtermAsync(process);

      using var exit = new CancellationTokenSource(ExitDeadline);
      await process.WaitForExitAsync(exit.Token);

      Assert.Equal(0, process.ExitCode);
      var trailingStandardError = await process.StandardError.ReadToEndAsync();
      Assert.DoesNotContain("Unhandled exception", trailingStandardError, StringComparison.Ordinal);
      Assert.DoesNotContain("Collaboration is disabled", trailingStandardError, StringComparison.Ordinal);
    }
    finally
    {
      await KillIfRunningAsync(process);
    }
  }

  [Fact]
  public async Task SurfacesCollabWarningsOnStandardError()
  {
    var collabDirectory = UniqueDirectory("blok-host-collab-log");
    await using var endpoint = await FixtureDocEndpoint.StartAsync();
    endpoint.GetStatus = 500;
    var listen = HostProcess.AllocateListenAddress();
    using var process = HostProcess.Start(
    [
      "--listen", listen,
      "--storage-dir", "",
      "--collab",
      "--collab-dir", collabDirectory,
      "--doc-endpoint", endpoint.Url,
    ],
    environment: null);

    try
    {
      await HostProcess.WaitForStandardErrorAsync(process, "listening on", Deadline);

      using var socket = await ConnectAsync(listen);
      Assert.Equal(4503, (await ReceiveCloseAsync(socket)).Status);

      var lines = await HostProcess.WaitForStandardErrorAsync(process, "warning: collab:", Deadline);
      Assert.Contains(
          lines,
          line => line.Contains($"room \"{DocId}\" could not load", StringComparison.Ordinal));
    }
    finally
    {
      await KillIfRunningAsync(process);
      DeleteDirectory(collabDirectory);
    }
  }

  [Fact]
  public async Task ASyncSocketOutlivesTheRequestTimeout()
  {
    var requestTimeout = TimeSpan.FromSeconds(1);
    var root = UniqueDirectory("blok-host-request-timeout");
    await using var endpoint = await FixtureDocEndpoint.StartAsync();
    await using var app = await StartCollabHostAsync(
        endpoint,
        Path.Combine(root, "collab"),
        requestTimeout,
        keepAliveTimeout: TimeSpan.FromMinutes(2),
        storageDirectory: Path.Combine(root, "uploads"));

    try
    {
      var listen = ListenAddress(app);

      // Control: the shortened policy is live — a stalled upload body gets 504.
      await AssertStalledUploadTimesOutAsync(listen);

      using var socket = await ConnectAsync(listen);
      await HandshakeAsync(socket);
      await Task.Delay(requestTimeout * 2.5);
      await HandshakeAsync(socket);
    }
    finally
    {
      DeleteDirectory(root);
    }
  }

  [Fact]
  public async Task ASyncSocketOutlivesKestrelsKeepAliveTimeout()
  {
    var keepAliveTimeout = TimeSpan.FromSeconds(1);
    var collabDirectory = UniqueDirectory("blok-host-keep-alive");
    await using var endpoint = await FixtureDocEndpoint.StartAsync();
    await using var app = await StartCollabHostAsync(
        endpoint,
        collabDirectory,
        requestTimeout: TimeSpan.FromMinutes(10),
        keepAliveTimeout);

    try
    {
      var listen = ListenAddress(app);

      // Control: the shortened window is live — an idle HTTP/1.1 connection is closed.
      await AssertIdleHttpConnectionIsClosedAsync(listen);

      using var socket = await ConnectAsync(listen);
      await HandshakeAsync(socket);
      // Also past Kestrel's 5s request-body data-rate grace: an idle socket
      // must not be treated as a stalled request body.
      await Task.Delay(TimeSpan.FromSeconds(6));
      await HandshakeAsync(socket);
    }
    finally
    {
      DeleteDirectory(collabDirectory);
    }
  }

  [Fact]
  public async Task RefusesUpgradesBeyondTheConcurrentLimit()
  {
    const int limit = 2;
    var collabDirectory = UniqueDirectory("blok-host-upgrade-limit");
    await using var endpoint = await FixtureDocEndpoint.StartAsync();
    await using var app = await StartCollabHostAsync(
        endpoint,
        collabDirectory,
        requestTimeout: TimeSpan.FromMinutes(10),
        keepAliveTimeout: TimeSpan.FromMinutes(2),
        maxUpgradedConnections: limit);

    try
    {
      var listen = ListenAddress(app);
      using var first = await ConnectAsync(listen);
      await HandshakeAsync(first);
      using var second = await ConnectAsync(listen);
      await HandshakeAsync(second);

      // The service's own count answers 503 before a room is seeded; Kestrel's
      // limit behind it would have let the room seed and then answered 500.
      var refused = await Assert.ThrowsAsync<WebSocketException>(() => ConnectAsync(listen));
      Assert.Contains("503", refused.Message, StringComparison.Ordinal);

      // Kestrel frees the slot when the closed connection ends, a moment
      // after the client sees the close acknowledged — so retry to a deadline.
      await CloseAsync(first);
      using var third = await ConnectWhenAdmittedAsync(listen);
      await HandshakeAsync(third);
    }
    finally
    {
      DeleteDirectory(collabDirectory);
    }
  }

  [Fact]
  public void BoundsUpgradedConnectionsOnlyWithCollab()
  {
    var collabOptions = new BlokServerOptions
    {
      CollabDirectory = UniqueDirectory("blok-host-upgrade-default"),
      CollabEnabled = true,
      DocEndpoint = "https://app.example.test/api/blok-docs",
      ListenAddress = "127.0.0.1:0",
      StorageDirectory = "",
    };
    var plainOptions = new BlokServerOptions
    {
      ListenAddress = "127.0.0.1:0",
      StorageDirectory = "",
    };
    using var withCollab = BuildHost(
        collabOptions,
        HostRequestTimeouts.DefaultRequestTimeout,
        HostRequestTimeouts.DefaultKeepAliveTimeout,
        maxUpgradedConnections: null);
    using var withoutCollab = BuildHost(
        plainOptions,
        HostRequestTimeouts.DefaultRequestTimeout,
        HostRequestTimeouts.DefaultKeepAliveTimeout,
        maxUpgradedConnections: null);

    Assert.Equal(1024, MaxUpgradedConnections(withCollab));
    Assert.Null(MaxUpgradedConnections(withoutCollab));
    // The service counts against the same number, so it can answer 503
    // itself instead of letting Kestrel fail the upgrade after the seed.
    Assert.Equal(1024, collabOptions.CollabMaxConnections);
    Assert.Equal(0, plainOptions.CollabMaxConnections);
  }

  private static long? MaxUpgradedConnections(WebApplication app)
  {
    return app.Services
        .GetRequiredService<IOptions<KestrelServerOptions>>()
        .Value
        .Limits
        .MaxConcurrentUpgradedConnections;
  }

  /// <summary>Real Kestrel, composed the way Program.cs composes it, with shortened windows.</summary>
  private static async Task<WebApplication> StartCollabHostAsync(
      FixtureDocEndpoint endpoint,
      string collabDirectory,
      TimeSpan requestTimeout,
      TimeSpan keepAliveTimeout,
      string storageDirectory = "",
      long? maxUpgradedConnections = null)
  {
    var app = BuildHost(
        new BlokServerOptions
        {
          CollabDirectory = collabDirectory,
          CollabEnabled = true,
          DocEndpoint = endpoint.Url,
          ListenAddress = "127.0.0.1:0",
          PublicUrl = "http://127.0.0.1/files",
          StorageDirectory = storageDirectory,
        },
        requestTimeout,
        keepAliveTimeout,
        maxUpgradedConnections);
    await app.StartAsync();

    return app;
  }

  private static WebApplication BuildHost(
      BlokServerOptions options,
      TimeSpan requestTimeout,
      TimeSpan keepAliveTimeout,
      long? maxUpgradedConnections)
  {
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    HostRequestTimeouts.Configure(builder, requestTimeout, keepAliveTimeout);
    HostCollab.Configure(
        builder,
        options,
        maxUpgradedConnections ?? HostCollab.DefaultMaxUpgradedConnections);
    builder.Services.AddBlokServer(options);
    var app = builder.Build();
    HostRequestTimeouts.Use(app);
    HostCollab.Use(app, options);
    app.MapBlokServer();

    return app;
  }

  private static string ListenAddress(WebApplication app)
  {
    return new Uri(app.Urls.Single()).Authority;
  }

  private static async Task AssertStalledUploadTimesOutAsync(string listen)
  {
    const string boundary = "blok-host-collab-timeout-boundary";
    var port = int.Parse(
        listen[(listen.LastIndexOf(':') + 1)..],
        System.Globalization.CultureInfo.InvariantCulture);
    using var connection = new TcpClient();
    await connection.ConnectAsync(IPAddress.Loopback, port);
    await using var stream = connection.GetStream();
    await stream.WriteAsync(Encoding.ASCII.GetBytes(
        "POST /upload HTTP/1.1\r\n" +
        $"Host: {listen}\r\n" +
        $"Content-Type: multipart/form-data; boundary={boundary}\r\n" +
        "Content-Length: 100000\r\n" +
        "Connection: close\r\n\r\n" +
        $"--{boundary}\r\n" +
        "Content-Disposition: form-data; name=\"file\"; filename=\"slow.bin\"\r\n" +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "partial"));
    var response = new byte[4096];
    using var deadline = new CancellationTokenSource(Deadline);
    var received = await stream.ReadAsync(response, deadline.Token);

    Assert.Contains(
        "HTTP/1.1 504",
        Encoding.ASCII.GetString(response, 0, received),
        StringComparison.Ordinal);
  }

  private static async Task AssertIdleHttpConnectionIsClosedAsync(string listen)
  {
    var port = int.Parse(
        listen[(listen.LastIndexOf(':') + 1)..],
        System.Globalization.CultureInfo.InvariantCulture);
    using var connection = new TcpClient();
    await connection.ConnectAsync(IPAddress.Loopback, port);
    await using var stream = connection.GetStream();
    await stream.WriteAsync(Encoding.ASCII.GetBytes(
        $"GET /health HTTP/1.1\r\nHost: {listen}\r\n\r\n"));
    var buffer = new byte[4096];
    using var deadline = new CancellationTokenSource(Deadline);
    var received = await stream.ReadAsync(buffer, deadline.Token);
    Assert.Contains(
        "HTTP/1.1 200",
        Encoding.ASCII.GetString(buffer, 0, received),
        StringComparison.Ordinal);

    // Now idle: Kestrel must close the connection once the keep-alive window passes.
    var closed = false;

    try
    {
      while (!closed)
      {
        closed = await stream.ReadAsync(buffer, deadline.Token) == 0;
      }
    }
    catch (IOException)
    {
      closed = true;
    }

    Assert.True(closed, "Kestrel kept the idle HTTP/1.1 connection open past the keep-alive window");
  }

  private static async Task<ClientWebSocket> ConnectAsync(string listen)
  {
    var socket = new ClientWebSocket();
    using var deadline = new CancellationTokenSource(Deadline);

    try
    {
      await socket.ConnectAsync(new Uri($"ws://{listen}/sync/{DocId}"), deadline.Token);
    }
    catch
    {
      socket.Dispose();
      throw;
    }

    return socket;
  }

  /// <summary>Retries the upgrade until the server admits it or the deadline passes.</summary>
  private static async Task<ClientWebSocket> ConnectWhenAdmittedAsync(string listen)
  {
    var deadline = DateTime.UtcNow + Deadline;
    WebSocketException? lastRefusal = null;

    while (DateTime.UtcNow < deadline)
    {
      try
      {
        return await ConnectAsync(listen);
      }
      catch (WebSocketException refusal)
      {
        lastRefusal = refusal;
      }

      await Task.Delay(50);
    }

    throw new TimeoutException($"the server kept refusing upgrades for {Deadline}: {lastRefusal?.Message}");
  }

  private static async Task CloseAsync(ClientWebSocket socket)
  {
    using var deadline = new CancellationTokenSource(Deadline);
    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", deadline.Token);
  }

  /// <summary>SyncStep1 with an empty state vector; the reply is SyncStep2 then SyncStep1.</summary>
  private static async Task HandshakeAsync(ClientWebSocket socket)
  {
    await SendAsync(socket, SyncFrames.Step1Empty);
    await ReceiveSyncAsync(socket, SyncFrames.Step2Type);
    await ReceiveSyncAsync(socket, SyncFrames.Step1Type);
  }

  private static Task SendAsync(ClientWebSocket socket, byte[] frame)
  {
    using var deadline = new CancellationTokenSource(Deadline);

    return socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, deadline.Token);
  }

  /// <summary>The payload of the next sync frame of the given sub-type; other frames (queryAwareness, other sub-types) are skipped.</summary>
  private static async Task<byte[]> ReceiveSyncAsync(ClientWebSocket socket, byte subType)
  {
    while (true)
    {
      var (type, frame) = await ReceiveFrameAsync(socket);

      if (type == WebSocketMessageType.Close)
      {
        Assert.Fail(
            $"expected a sync frame but the socket closed with {(int?)socket.CloseStatus} " +
            $"\"{socket.CloseStatusDescription}\"");
      }

      if (SyncFrames.TryReadSyncPayload(frame, subType, out var payload))
      {
        return payload;
      }
    }
  }

  private static async Task<(int Status, string Description)> ReceiveCloseAsync(ClientWebSocket socket)
  {
    while (true)
    {
      var (type, _) = await ReceiveFrameAsync(socket);

      if (type != WebSocketMessageType.Close)
      {
        continue;
      }

      if (socket.State == WebSocketState.CloseReceived)
      {
        using var deadline = new CancellationTokenSource(Deadline);
        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", deadline.Token);
      }

      return ((int)(socket.CloseStatus ?? WebSocketCloseStatus.Empty), socket.CloseStatusDescription ?? "");
    }
  }

  private static async Task<(WebSocketMessageType Type, byte[] Frame)> ReceiveFrameAsync(ClientWebSocket socket)
  {
    var buffer = new byte[64 * 1024];
    using var frame = new MemoryStream();
    using var deadline = new CancellationTokenSource(Deadline);

    while (true)
    {
      var result = await socket.ReceiveAsync(buffer, deadline.Token);

      if (result.MessageType == WebSocketMessageType.Close)
      {
        return (result.MessageType, []);
      }

      frame.Write(buffer, 0, result.Count);

      if (result.EndOfMessage)
      {
        return (result.MessageType, frame.ToArray());
      }
    }
  }

  private static async Task SendSigtermAsync(Process process)
  {
    using var kill = Process.Start(new ProcessStartInfo("/bin/kill")
    {
      ArgumentList = { "-TERM", process.Id.ToString(System.Globalization.CultureInfo.InvariantCulture) },
      UseShellExecute = false,
    }) ?? throw new InvalidOperationException("Could not start /bin/kill");
    using var deadline = new CancellationTokenSource(Deadline);
    await kill.WaitForExitAsync(deadline.Token);
    Assert.Equal(0, kill.ExitCode);
  }

  private static async Task KillIfRunningAsync(Process process)
  {
    if (!process.HasExited)
    {
      process.Kill(entireProcessTree: true);
    }

    await process.WaitForExitAsync();
  }

  private static string[] BlockIds(JsonNode? outputData)
  {
    var blocks = outputData?["blocks"]?.AsArray() ??
        throw new InvalidDataException($"the export carries no blocks array: {outputData}");

    return blocks
        .Select(block => block?["id"]?.GetValue<string>() ?? "")
        .ToArray();
  }

  private static string Sha256Hex(string value)
  {
    return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
  }

  private static string UniqueDirectory(string prefix)
  {
    return Path.Combine(Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}");
  }

  private static void DeleteDirectory(string directory)
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }
}

/// <summary>
/// The four bytes of y-protocols framing these tests need, hand-rolled: the
/// codec itself is Blok.Server-internal and pinned there. Layout:
/// [varuint type][varuint sub-type][varuint length][payload].
/// </summary>
internal static class SyncFrames
{
  internal const byte Step1Type = 0;
  internal const byte Step2Type = 1;
  internal const byte UpdateType = 2;

  /// <summary>Sync 0 / step 1 with the one-byte empty state vector.</summary>
  internal static readonly byte[] Step1Empty = [0, Step1Type, 1, 0];

  internal static byte[] Update(byte[] update)
  {
    var frame = new List<byte> { 0, UpdateType };
    WriteVarUint(frame, (ulong)update.Length);
    frame.AddRange(update);

    return [.. frame];
  }

  internal static bool TryReadSyncPayload(byte[] frame, byte subType, out byte[] payload)
  {
    payload = [];
    var input = new ReadOnlySpan<byte>(frame);

    if (!TryReadVarUint(ref input, out var type) || type != 0 ||
        !TryReadVarUint(ref input, out var actualSubType) || actualSubType != subType ||
        !TryReadVarUint(ref input, out var length) || length != (ulong)input.Length)
    {
      return false;
    }

    payload = input.ToArray();

    return true;
  }

  private static void WriteVarUint(List<byte> output, ulong value)
  {
    while (value >= 0x80)
    {
      output.Add((byte)(value | 0x80));
      value >>= 7;
    }

    output.Add((byte)value);
  }

  private static bool TryReadVarUint(ref ReadOnlySpan<byte> input, out ulong value)
  {
    value = 0;
    var shift = 0;

    while (input.Length > 0 && shift < 64)
    {
      var next = input[0];
      input = input[1..];
      value |= (ulong)(next & 0x7F) << shift;

      if ((next & 0x80) == 0)
      {
        return true;
      }

      shift += 7;
    }

    return false;
  }
}

/// <summary>Reads the lockstep collab fixtures by walking up from the test output (as Blok.Server.Tests does).</summary>
internal static class CollabFixtures
{
  private const string RelativeRoot = "test/unit/server-conformance/fixtures/collab";

  private static readonly Lazy<string> Root = new(LocateRoot);

  internal static byte[] Update(string caseName)
  {
    return Convert.FromBase64String(
        File.ReadAllText(Path.Combine(Root.Value, caseName, "update.b64")));
  }

  internal static string[] CanonicalBlockIds(string caseName)
  {
    var canonical = JsonNode.Parse(
        File.ReadAllText(Path.Combine(Root.Value, caseName, "canonical.json")))?.AsArray() ??
        throw new InvalidDataException($"{caseName}/canonical.json is not an array");

    return canonical
        .Select(block => block?["id"]?.GetValue<string>() ?? "")
        .ToArray();
  }

  private static string LocateRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, RelativeRoot);

      if (File.Exists(Path.Combine(candidate, "manifest.json")))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException(
        $"collab fixtures not found: no ancestor of {AppContext.BaseDirectory} holds {RelativeRoot}/manifest.json");
  }
}
