using System.Text;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Http;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>
/// The HTTP answers of Node's createMcpHandler (@modelcontextprotocol/server 2.4.0), which the
/// gate gives before the C# SDK sees the request.
/// </summary>
public sealed class McpHttpNodeParityTests
{
  private const string Both = "application/json, text/event-stream";
  private const string NotAMessage = """{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"},"id":ID}""";
  private const string Versions = "2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07";

  private static DefaultHttpContext Post(byte[] body, string? contentType = "application/json", string? accept = Both, string? version = null, string method = "POST")
  {
    var context = new DefaultHttpContext();

    context.Request.Method = method;
    context.Request.Path = "/mcp";
    context.Request.Headers.Host = "127.0.0.1:4321";
    context.Request.Body = new MemoryStream(body);
    if (contentType is not null)
    {
      context.Request.ContentType = contentType;
    }
    if (accept is not null)
    {
      context.Request.Headers.Accept = accept;
    }
    if (version is not null)
    {
      context.Request.Headers["MCP-Protocol-Version"] = version;
    }
    context.Response.Body = new MemoryStream();

    return context;
  }

  private static DefaultHttpContext Post(string body, string? contentType = "application/json", string? accept = Both, string? version = null, string method = "POST")
  {
    return Post(Encoding.UTF8.GetBytes(body), contentType, accept, version, method);
  }

  // The status and body the gate answered, or (0, the body the SDK got) when it passed the request on.
  private static async Task<(int Status, string Body)> GateAsync(DefaultHttpContext context)
  {
    string? passed = null;

    await McpRequestGate.InvokeAsync(context, inner =>
    {
      passed = new StreamReader(inner.Request.Body).ReadToEnd();

      return Task.CompletedTask;
    });
    if (passed is not null)
    {
      return (0, passed);
    }
    context.Response.Body.Position = 0;

    return (context.Response.StatusCode, new StreamReader(context.Response.Body).ReadToEnd());
  }

  // An SDK event goes out as JSON.stringify writes it; a body the SDK sized passes as it is.
  [Fact]
  public async Task WritesTheSdksEventsWithNodesRawBytes()
  {
    const string Escaped = "{\"result\":{\"t\":\"\\u0022a\\u0027\\u003C\\u00E9\\uD83D\\uDE00\\u2028\"},\"id\":7,\"jsonrpc\":\"2.0\"}";
    var context = Post(McpHttpTests.Ping, version: "2025-11-25");

    await McpRequestGate.InvokeAsync(context, async inner =>
    {
      inner.Response.ContentType = "text/event-stream";
      await inner.Response.WriteAsync("event: message\ndata: " + Escaped + "\n\n");
    });
    context.Response.Body.Position = 0;

    Assert.Equal(
        "event: message\ndata: {\"result\":{\"t\":\"\\\"a'<\u00e9\ud83d\ude00\u2028\"},\"id\":7,\"jsonrpc\":\"2.0\"}\n\n",
        new StreamReader(context.Response.Body).ReadToEnd());

    var sized = Post(McpHttpTests.Ping, version: "2025-11-25");

    await McpRequestGate.InvokeAsync(sized, async inner =>
    {
      inner.Response.ContentType = "application/json";
      inner.Response.ContentLength = Escaped.Length;
      await inner.Response.WriteAsync(Escaped);
    });
    sized.Response.Body.Position = 0;

    Assert.Equal(Escaped, new StreamReader(sized.Response.Body).ReadToEnd());
  }

  [Theory]
  [InlineData("PUT")]
  [InlineData("PATCH")]
  [InlineData("OPTIONS")]
  public async Task AnswersEveryMethodButPost405(string method)
  {
    var context = Post(McpHttpTests.Ping, method: method);
    var (status, body) = await GateAsync(context);

    Assert.Equal(405, status);
    Assert.Equal("POST", context.Response.Headers.Allow.ToString());
    Assert.Equal("application/json", context.Response.ContentType);
    Assert.Equal("""{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}""", body);
  }

  [Fact]
  public async Task AnswersHead405WithNoBody()
  {
    var context = Post(string.Empty, method: "HEAD");
    var (status, body) = await GateAsync(context);

    Assert.Equal(405, status);
    Assert.Equal("POST", context.Response.Headers.Allow.ToString());
    Assert.Equal("application/json", context.Response.ContentType);
    Assert.Equal(string.Empty, body);
  }

  [Theory]
  [InlineData(null)]
  [InlineData("text/plain")]
  [InlineData("application/jsonx")]
  public async Task RefusesABodyThatIsNotJson415(string? contentType)
  {
    var (status, body) = await GateAsync(Post(McpHttpTests.Ping, contentType: contentType));

    Assert.Equal(415, status);
    Assert.Equal("""{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}""", body);
  }

  [Theory]
  [InlineData("Application/JSON")]
  [InlineData("application/json; charset=latin1")]
  public async Task TakesAnyApplicationJsonContentType(string contentType)
  {
    Assert.Equal(0, (await GateAsync(Post(McpHttpTests.Ping, contentType: contentType))).Status);
  }

  [Theory]
  [InlineData(null)]
  [InlineData("*/*")]
  [InlineData("application/json")]
  [InlineData("text/event-stream")]
  public async Task NeedsBothMediaTypesInAccept406(string? accept)
  {
    var (status, body) = await GateAsync(Post(McpHttpTests.Ping, accept: accept));

    Assert.Equal(406, status);
    Assert.Equal("""{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}""", body);
  }

  [Theory]
  [InlineData("42", "null")]
  [InlineData("null", "null")]
  [InlineData("""{"id":9,"method":"ping"}""", "9")]
  [InlineData("""{"jsonrpc":"2.0","id":1.5,"method":"ping"}""", "1.5")]
  [InlineData("""{"jsonrpc":"2.0","id":null,"method":"ping"}""", "null")]
  [InlineData("""{"jsonrpc":"2.0","id":"x"}""", "null")]
  public async Task RefusesABodyNodesSchemaRefuses400(string sent, string id)
  {
    var (status, body) = await GateAsync(Post(sent));

    Assert.Equal(400, status);
    Assert.Equal(NotAMessage.Replace("ID", id, StringComparison.Ordinal), body);
  }

  [Theory]
  [InlineData("[]", "Bad Request: empty JSON-RPC batch")]
  [InlineData("[42]", "Bad Request: JSON-RPC batch contains an invalid message")]
  [InlineData("""[{"jsonrpc":"2.0","id":1,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}]""", "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later")]
  public async Task RefusesABatchNodeRefuses(string sent, string message)
  {
    var (status, body) = await GateAsync(Post(sent));

    Assert.Equal(400, status);
    Assert.Equal($$"""{"jsonrpc":"2.0","error":{"code":-32600,"message":"{{message}}"},"id":null}""", body);
  }

  // TextDecoder drops a leading BOM and reads invalid UTF-8 as U+FFFD.
  [Fact]
  public async Task ReadsTheBodyAsTextDecoderDoes()
  {
    var bom = (await GateAsync(Post([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(McpHttpTests.Ping)]))).Body;
    var invalid = await GateAsync(Post([.. Encoding.UTF8.GetBytes("""{"jsonrpc":"2.0","id":7,"method":"ping","params":{"x":"a"""), 0xFF, .. Encoding.UTF8.GetBytes("\"}}")]));

    Assert.Equal(McpHttpTests.Ping, bom);
    Assert.Equal(0, invalid.Status);
    Assert.Contains("a�", invalid.Body, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("")]
  [InlineData("1999-01-01")]
  public async Task RefusesAnUnsupportedLegacyVersionHeader(string version)
  {
    var (status, body) = await GateAsync(Post(McpHttpTests.Ping, version: version));

    Assert.Equal(400, status);
    Assert.Equal($$"""{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Unsupported protocol version: {{version}} (supported versions: {{Versions}})"},"id":null}""", body);
  }

  [Theory]
  [InlineData("2026-07-28")]
  [InlineData("2099-01-01")]
  public async Task RefusesAModernVersionHeaderWithNoMeta(string version)
  {
    var (status, body) = await GateAsync(Post(McpHttpTests.Ping, version: version));

    Assert.Equal(400, status);
    Assert.Equal(
        "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32602,\"message\":\"Invalid params: the MCP-Protocol-Version header names protocol revision " + version
        + ", but the request is missing the required per-request envelope key(s): _meta\",\"data\":{\"envelope\":{\"missing\":[\"_meta\"]}}},\"id\":7}",
        body);
  }

  [Fact]
  public async Task LetsAnInitializeNameAnyVersionHeader()
  {
    const string Initialize = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}""";

    Assert.Equal(0, (await GateAsync(Post(Initialize, version: "1999-01-01"))).Status);
  }
}
