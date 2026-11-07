using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// stdin as the stdio transport reads it, one line at a time in wire order. Each tools/call on a
/// handle takes its place in that handle's order here, before the SDK runs messages at once.
/// </summary>
internal sealed class McpOrderedInput(Stream inner, McpServerCore core) : Stream
{
  /*
   * Node's SDK holds at most 10 MiB of unread stdin (STDIO_DEFAULT_MAX_BUFFER_SIZE) and closes the
   * transport past it, so a longer message gets no answer and blok-mcp stops. Here a longer line ends
   * the input, and only whole lines are passed on, so the SDK never parses a cut one.
   */
  internal const int MaxMessageBytes = 10 * 1024 * 1024;

  private readonly MemoryStream line = new();
  private readonly byte[] chunk = new byte[64 * 1024];
  private byte[] ready = [];
  private int readyAt;
  private bool ended;

  public override bool CanRead => true;

  public override bool CanSeek => false;

  public override bool CanWrite => false;

  public override long Length => throw new NotSupportedException();

  public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

  /// <summary>A request id as the SDK's RequestId prints it.</summary>
  internal static string IdOf(JsonNode id)
  {
    return id.Deserialize<RequestId>(McpJsonUtilities.DefaultOptions).ToString();
  }

  public override int Read(byte[] buffer, int offset, int count)
  {
    return ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
  }

  public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
  {
    while (readyAt == ready.Length && !ended)
    {
      var read = await inner.ReadAsync(chunk, cancellationToken);

      if (read == 0)
      {
        // A last line with no newline is dropped, as Node's ReadBuffer drops it.
        ended = true;
        break;
      }
      Seen(chunk.AsSpan(0, read));
    }
    var taken = Math.Min(buffer.Length, ready.Length - readyAt);

    ready.AsSpan(readyAt, taken).CopyTo(buffer.Span);
    readyAt += taken;

    return taken;
  }

  public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
  {
    return ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
  }

  public override void Flush()
  {
  }

  public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

  public override void SetLength(long value) => throw new NotSupportedException();

  public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

  protected override void Dispose(bool disposing)
  {
    if (disposing)
    {
      inner.Dispose();
      line.Dispose();
    }
    base.Dispose(disposing);
  }

  private void Seen(ReadOnlySpan<byte> bytes)
  {
    using var whole = new MemoryStream();

    whole.Write(ready.AsSpan(readyAt));
    while (bytes.Length > 0 && !ended)
    {
      var end = bytes.IndexOf((byte)'\n');
      var part = end < 0 ? bytes : bytes[..end];

      if (line.Length + part.Length > MaxMessageBytes)
      {
        ended = true;
        line.SetLength(0);
        break;
      }
      line.Write(part);
      if (end < 0)
      {
        break;
      }
      if (Pass(line.GetBuffer().AsMemory(0, (int)line.Length)) is { } passed)
      {
        whole.Write(passed.Span);
        whole.WriteByte((byte)'\n');
      }
      line.SetLength(0);
      bytes = bytes[(end + 1)..];
    }
    ready = whole.ToArray();
    readyAt = 0;
  }

  // The line as the SDK should get it: null drops it (Node's SDK never answers it), and a
  // repeated key is written out with its last value, as JSON.parse reads it.
  private ReadOnlyMemory<byte>? Pass(ReadOnlyMemory<byte> bytes)
  {
    var text = Encoding.UTF8.GetString(bytes.Span);

    if (McpRequestShape.Read(bytes) is var (document, repeated))
    {
      using (document)
      {
        if (!McpRequestShape.IsMessage(document.RootElement))
        {
          return null;
        }
      }
      if (repeated)
      {
        text = McpJson.Write(McpJson.Parse(text));
        bytes = Encoding.UTF8.GetBytes(text);
      }
    }
    Reserve(text);

    return bytes;
  }

  private void Reserve(string text)
  {
    // Only a tools/call names a handle; anything else, or a line the SDK will refuse, takes no place.
    if (!text.Contains("\"tools/call\"", StringComparison.Ordinal))
    {
      return;
    }
    try
    {
      if (McpJson.Parse(text) is JsonObject message && McpJson.String(message["method"]) == RequestMethods.ToolsCall
          && message["id"] is JsonNode id && message["params"] is JsonObject call && call["arguments"] is JsonObject arguments
          && McpJson.String(arguments["handle"]) is string handle)
      {
        core.Reserve(IdOf(id), handle);
      }
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      // A line it cannot read takes no place; the SDK answers it.
    }
  }
}
