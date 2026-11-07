using System.Text;
using System.Text.Json;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// Rewrites each JSON message the SDK writes with JSON.stringify's escapes (<see cref="McpJson.Write"/>):
/// the SDK's encoder writes ", ', &lt;, &gt;, &amp;, non-ASCII and emoji as \u escapes. A line is a stdio
/// message, or an SSE "data: " line; any other line passes as written, and so does every line
/// while <c>when</c> says no (an HTTP body the SDK sized must keep its length).
/// </summary>
internal sealed class McpNodeBytesStream(Stream inner, Func<bool>? when = null) : Stream
{
  private static readonly byte[] DataPrefix = "data: "u8.ToArray();
  private readonly MemoryStream pending = new();

  public override bool CanRead => false;
  public override bool CanSeek => false;
  public override bool CanWrite => true;
  public override long Length => throw new NotSupportedException();
  public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

  public override void Write(byte[] buffer, int offset, int count)
  {
    Write(buffer.AsSpan(offset, count));
  }

  public override void Write(ReadOnlySpan<byte> buffer)
  {
    pending.Write(buffer);
    if (buffer.Contains((byte)'\n'))
    {
      inner.Write(TakeLines());
    }
  }

  public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
  {
    pending.Write(buffer.Span);
    if (buffer.Span.Contains((byte)'\n'))
    {
      await inner.WriteAsync(TakeLines(), cancellationToken);
    }
  }

  public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
  {
    return WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
  }

  // A line still open stays: the SDK flushes after whole messages.
  public override void Flush()
  {
    inner.Flush();
  }

  public override Task FlushAsync(CancellationToken cancellationToken)
  {
    return inner.FlushAsync(cancellationToken);
  }

  public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
  public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
  public override void SetLength(long value) => throw new NotSupportedException();

  protected override void Dispose(bool disposing)
  {
    if (disposing && pending.Length > 0)
    {
      inner.Write(Rewritten(pending.ToArray()));
      pending.SetLength(0);
    }
    base.Dispose(disposing);
  }

  public override async ValueTask DisposeAsync()
  {
    if (pending.Length > 0)
    {
      await inner.WriteAsync(Rewritten(pending.ToArray()));
      pending.SetLength(0);
    }
    await base.DisposeAsync();
  }

  // Every whole line in pending, rewritten; the rest stays.
  private byte[] TakeLines()
  {
    var bytes = pending.ToArray();
    var output = new MemoryStream();
    var start = 0;

    for (var newline = Array.IndexOf(bytes, (byte)'\n'); newline >= 0; newline = Array.IndexOf(bytes, (byte)'\n', start))
    {
      output.Write(Rewritten(bytes[start..newline]));
      output.WriteByte((byte)'\n');
      start = newline + 1;
    }
    pending.SetLength(0);
    pending.Write(bytes.AsSpan(start));

    return output.ToArray();
  }

  private byte[] Rewritten(byte[] line)
  {
    if (when?.Invoke() == false)
    {
      return line;
    }
    var data = line.AsSpan().StartsWith(DataPrefix) ? DataPrefix.Length : 0;
    var body = line.AsSpan(data);

    if (body.IsEmpty || (body[0] != (byte)'{' && body[0] != (byte)'['))
    {
      return line;
    }
    try
    {
      var text = McpJson.Write(McpJson.Parse(Encoding.UTF8.GetString(body.TrimEnd((byte)'\r'))));

      return [.. line.AsSpan(0, data), .. Encoding.UTF8.GetBytes(text), .. body.EndsWith("\r"u8) ? "\r"u8 : []];
    }
    catch (JsonException)
    {
      return line;
    }
  }
}
