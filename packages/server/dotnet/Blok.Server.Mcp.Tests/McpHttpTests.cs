using System.Text;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Http;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class McpHttpTests
{
  private const int Port = 4321;

  private static DefaultHttpContext Request(string method, string path, string? host = "127.0.0.1:4321", string? origin = null, string? body = null)
  {
    var context = new DefaultHttpContext();

    context.Request.Method = method;
    context.Request.Path = path;
    if (host is not null)
    {
      context.Request.Headers.Host = host;
    }
    if (origin is not null)
    {
      context.Request.Headers.Origin = origin;
    }
    if (body is not null)
    {
      context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
    }
    context.Response.Body = new MemoryStream();

    return context;
  }

  private static async Task<int> GuardAsync(DefaultHttpContext context, bool isPublic = false)
  {
    var reached = false;
    var guard = new McpHttpGuard(new McpConfig { HttpListen = "127.0.0.1:0", Public = isPublic }, () => Port, "/mcp");

    await guard.InvokeAsync(context, _ =>
    {
      reached = true;

      return Task.CompletedTask;
    });

    return reached ? 0 : context.Response.StatusCode;
  }

  private static string BodyOf(HttpContext context)
  {
    context.Response.Body.Position = 0;

    return new StreamReader(context.Response.Body).ReadToEnd();
  }

  [Theory]
  [InlineData("http://localhost:9", 0)]
  [InlineData("http://127.0.0.1", 0)]
  [InlineData("http://[::1]:5", 0)]
  [InlineData("http://LOCALHOST", 403)]
  [InlineData("https://localhost", 403)]
  [InlineData("null", 403)]
  [InlineData("http://localhost.evil.test", 403)]
  [InlineData("http://127.0.0.1:80/x", 403)]
  public async Task LetsOnlyALoopbackHttpOriginThrough(string origin, int status)
  {
    Assert.Equal(status, await GuardAsync(Request("POST", "/mcp", origin: origin)));
  }

  [Theory]
  [InlineData("127.0.0.1:4321", 0)]
  [InlineData("LOCALHOST:4321", 0)]
  [InlineData("[::1]:4321", 0)]
  [InlineData("127.0.0.1", 403)]
  [InlineData("localhost:1", 403)]
  [InlineData("evil.test:4321", 403)]
  [InlineData("127.0.0.1:04321", 403)]
  [InlineData("127.0.0.2:4321", 403)]
  public async Task NeedsALoopbackHostOnTheBoundPort(string host, int status)
  {
    Assert.Equal(status, await GuardAsync(Request("POST", "/mcp", host: host)));
  }

  [Fact]
  public async Task SkipsTheHostCheckWhenPublic()
  {
    Assert.Equal(0, await GuardAsync(Request("POST", "/mcp", host: "mcp.example.com"), isPublic: true));
  }

  [Theory]
  [InlineData("/other")]
  [InlineData("/mcp/")]
  [InlineData("/.well-known/oauth-protected-resource")]
  public async Task AnswersEveryOtherPath404(string path)
  {
    Assert.Equal(404, await GuardAsync(Request("POST", path)));
  }

  [Fact]
  public async Task ChecksOriginBeforeThePath()
  {
    Assert.Equal(403, await GuardAsync(Request("GET", "/nowhere", origin: "http://evil.test")));
  }

  [Fact]
  public async Task RefusesABodyOverFourMebibytes()
  {
    var context = Request("POST", "/mcp", body: new string('a', McpRequestGate.MaxBodyBytes + 1));

    await McpRequestGate.InvokeAsync(context, _ => Task.CompletedTask);

    Assert.Equal(413, context.Response.StatusCode);
    Assert.Null(context.Response.ContentType);
  }

  [Fact]
  public async Task ReadsExactlyFourMebibytesAndRefusesItAsAParseError()
  {
    var context = Request("POST", "/mcp", body: new string('a', McpRequestGate.MaxBodyBytes));

    await McpRequestGate.InvokeAsync(context, _ => Task.CompletedTask);

    Assert.Equal(400, context.Response.StatusCode);
    Assert.Contains("\"code\":-32700", BodyOf(context), StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("GET")]
  [InlineData("DELETE")]
  public async Task AnswersGetAndDelete405AsNodesSdkDoes(string method)
  {
    var context = Request(method, "/mcp");

    await McpRequestGate.InvokeAsync(context, _ => Task.CompletedTask);

    Assert.Equal(405, context.Response.StatusCode);
    Assert.Equal("POST", context.Response.Headers.Allow.ToString());
    Assert.Equal("""{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}""", BodyOf(context));
  }

  [Fact]
  public async Task IgnoresASessionIdAsAStatelessServer()
  {
    var context = Request("POST", "/mcp", body: "{}");
    var seen = "unset";

    context.Request.Headers["Mcp-Session-Id"] = "made-up";
    await McpRequestGate.InvokeAsync(context, inner =>
    {
      seen = inner.Request.Headers["Mcp-Session-Id"].ToString();

      return Task.CompletedTask;
    });

    Assert.Equal(string.Empty, seen);
  }

  // The SDK cannot read a lone surrogate escape; the decided policy reads it as U+FFFD.
  [Fact]
  public async Task PassesALoneSurrogateOnAsTheReplacementCharacter()
  {
    var context = Request("POST", "/mcp", body: """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"a\ud800"}}}""");
    var seen = "unset";

    await McpRequestGate.InvokeAsync(context, inner =>
    {
      seen = new StreamReader(inner.Request.Body).ReadToEnd();

      return Task.CompletedTask;
    });

    Assert.Equal("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_open\",\"arguments\":{\"documentId\":\"a\uFFFD\"}}}", seen);
  }

  [Fact]
  public async Task Serves20241007AsNodeDoes()
  {
    var context = Request("POST", "/mcp", body: "{}");
    var seen = "unset";

    context.Request.Headers["MCP-Protocol-Version"] = "2024-10-07";
    await McpRequestGate.InvokeAsync(context, inner =>
    {
      seen = inner.Request.Headers["MCP-Protocol-Version"].ToString();

      return Task.CompletedTask;
    });

    Assert.Equal("2024-11-05", seen);
  }

  [Fact]
  public async Task LeavesA20241007InitializeToTheWireFilter()
  {
    var context = Request("POST", "/mcp", body: """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-10-07"}}""");
    var seen = "unset";

    context.Request.Headers["MCP-Protocol-Version"] = "2024-10-07";
    await McpRequestGate.InvokeAsync(context, inner =>
    {
      seen = inner.Request.Headers["MCP-Protocol-Version"].ToString();

      return Task.CompletedTask;
    });

    Assert.Equal(string.Empty, seen);
  }

  [Fact]
  public async Task Answers20260728WithOneJsonBody()
  {
    var context = Request("POST", "/mcp", body: "{}");

    context.Request.Headers["MCP-Protocol-Version"] = "2026-07-28";
    await McpRequestGate.InvokeAsync(context, async inner =>
    {
      inner.Response.ContentType = "text/event-stream";
      await inner.Response.WriteAsync("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n");
    });

    Assert.Equal("application/json", context.Response.ContentType);
    Assert.Equal("""{"jsonrpc":"2.0","id":1,"result":{}}""", BodyOf(context));
  }

  [Fact]
  public async Task NamesAMissingMethodAndGivesAnEnvelopeRefusalDataOn20260728()
  {
    var context = Request("POST", "/mcp", body: "{}");

    context.Request.Headers["MCP-Protocol-Version"] = "2026-07-28";
    await McpRequestGate.InvokeAsync(context, async inner =>
    {
      inner.Response.StatusCode = 400;
      inner.Response.ContentType = "application/json";
      await inner.Response.WriteAsync("""{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"Mcp-Method is missing."}}""");
    });

    Assert.Equal("""{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"Mcp-Method is missing.","data":"Mcp-Method is missing."}}""", BodyOf(context));
  }
}
