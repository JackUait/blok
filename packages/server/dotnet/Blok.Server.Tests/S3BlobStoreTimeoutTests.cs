using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Blok.Server.Storage;
using Xunit;

namespace Blok.Server.Tests;

// The Go port mirrors these in internal/blob/s3_timeout_test.go.
public sealed class S3BlobStoreTimeoutTests
{
  private static readonly TimeSpan HeaderTimeout = TimeSpan.FromMilliseconds(300);
  private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(3);

  [Fact]
  public async Task ABodilessGetStillWaitsForHeadersOnlyUntilTheHeaderTimeout()
  {
    using var server = new RawServer(async (stream, stop) =>
        await Task.Delay(Timeout.Infinite, stop), readBody: true);
    using var store = Create(server.Port);

    var clock = Stopwatch.StartNew();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
        store.GetObjectAsync("collab/key"));

    Assert.InRange(clock.Elapsed, HeaderTimeout, RequestTimeout / 2);
  }

  [Fact]
  public async Task TheHeaderTimeoutCountsFromTheEndOfTheBody()
  {
    // The body is far larger than the socket buffers, so the client is
    // still writing it while the server waits; only then is it answered.
    var body = new byte[64 << 20];
    using var server = new RawServer(async (stream, stop) =>
    {
      await Task.Delay(HeaderTimeout * 3, stop);
      await Drain(stream, body.Length, stop);
      await Respond(stream, "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    }, readBody: false);
    using var store = Create(server.Port);

    await store.PutObjectAsync("collab/key", body);
  }

  [Fact]
  public async Task AStalledResponseBodyDiesAtTheRequestTimeout()
  {
    using var server = new RawServer(async (stream, stop) =>
    {
      await Respond(stream, "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nab");
      await Task.Delay(Timeout.Infinite, stop);
    }, readBody: true);
    using var store = Create(server.Port);

    var clock = Stopwatch.StartNew();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
        store.GetObjectAsync("collab/key"));

    Assert.InRange(clock.Elapsed, RequestTimeout, RequestTimeout * 2);
  }

  private static S3BlobStore Create(int port) =>
      new(
          new S3BlobStoreOptions(
              $"http://127.0.0.1:{port}",
              "us-east-1",
              "media",
              "AKIAEXAMPLE",
              "secret",
              "https://cdn.example.com/media",
              "path",
              1024,
              Path.GetTempPath(),
              RequestTimeout,
              HeaderTimeout),
          TimeProvider.System);

  private static async Task Drain(NetworkStream stream, long length, CancellationToken stop)
  {
    var buffer = new byte[1 << 16];
    var read = 0L;
    while (read < length)
    {
      var n = await stream.ReadAsync(buffer, stop);
      if (n == 0)
      {
        return;
      }

      read += n;
    }
  }

  private static async Task Respond(NetworkStream stream, string text)
  {
    var bytes = Encoding.ASCII.GetBytes(text);
    await stream.WriteAsync(bytes);
    await stream.FlushAsync();
  }

  // Reads one request's headers (and its body when readBody) and hands the
  // stream to the handler.
  private sealed class RawServer : IDisposable
  {
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly List<TcpClient> clients = [];
    private readonly CancellationTokenSource stop = new();

    internal RawServer(Func<NetworkStream, CancellationToken, Task> handle, bool readBody)
    {
      listener.Start();
      _ = Task.Run(async () =>
      {
        while (true)
        {
          TcpClient client;
          try
          {
            client = await listener.AcceptTcpClientAsync();
          }
          catch (Exception)
          {
            return;
          }

          lock (clients)
          {
            clients.Add(client);
          }

          _ = Task.Run(async () =>
          {
            try
            {
              var stream = client.GetStream();
              await ReadRequest(stream, readBody);
              await handle(stream, stop.Token);
            }
            catch (Exception)
            {
              // The client gave up; nothing to answer.
            }
          });
        }
      });
    }

    internal int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    public void Dispose()
    {
      stop.Cancel();
      listener.Stop();
      lock (clients)
      {
        foreach (var client in clients)
        {
          client.Dispose();
        }
      }
    }

    private static async Task ReadRequest(NetworkStream stream, bool readBody)
    {
      var buffer = new List<byte>();
      var one = new byte[1];
      while (!EndsWithBlankLine(buffer))
      {
        if (await stream.ReadAsync(one) == 0)
        {
          break;
        }

        buffer.Add(one[0]);
      }

      var head = Encoding.ASCII.GetString([.. buffer]);
      var length = 0;
      foreach (var line in head.Split("\r\n"))
      {
        if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
        {
          length = int.Parse(line["Content-Length:".Length..].Trim(), System.Globalization.CultureInfo.InvariantCulture);
        }
      }

      if (readBody)
      {
        await Drain(stream, length, CancellationToken.None);
      }
    }

    private static bool EndsWithBlankLine(List<byte> buffer) =>
        buffer.Count >= 4 &&
        buffer[^4] == '\r' && buffer[^3] == '\n' &&
        buffer[^2] == '\r' && buffer[^1] == '\n';
  }
}
