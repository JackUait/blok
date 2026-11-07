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
  private readonly MemoryStream line = new();

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
    var read = inner.Read(buffer, offset, count);

    Seen(buffer.AsSpan(offset, read));

    return read;
  }

  public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
  {
    var read = await inner.ReadAsync(buffer, cancellationToken);

    Seen(buffer.Span[..read]);

    return read;
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
    while (bytes.Length > 0)
    {
      var end = bytes.IndexOf((byte)'\n');

      if (end < 0)
      {
        line.Write(bytes);

        return;
      }
      line.Write(bytes[..end]);
      Reserve(Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length));
      line.SetLength(0);
      bytes = bytes[(end + 1)..];
    }
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
      if (JsonNode.Parse(text) is JsonObject { } message && McpJson.String(message["method"]) == RequestMethods.ToolsCall
          && message["id"] is JsonNode id && McpJson.String(message["params"]?["arguments"]?["handle"]) is string handle)
      {
        core.Reserve(IdOf(id), handle);
      }
    }
    catch (JsonException)
    {
      // Not JSON: the SDK answers it.
    }
  }
}
