using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>--create-page's webhook wire, as src/mcp/create-page.ts sends and reads it.</summary>
public sealed class CreatePageWebhookTests
{
  private static readonly BlokPageCreateRequest Request = new(new BlokAgentActor("agent:alice:desk", "desk (for alice)", "alice"))
  {
    ParentDocumentId = "parent",
    Principal = "alice",
    SuggestedPageId = "suggested1",
  };

  // One HTTP/1.1 exchange on loopback: the raw request, and the canned answer sent back.
  private static async Task<(string? Answer, Exception? Error, string Request)> AskAsync(string response, BlokPageCreateRequest? request = null)
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    var accepted = Task.Run(async () =>
    {
      using var client = await listener.AcceptTcpClientAsync();
      var stream = client.GetStream();
      var seen = new MemoryStream();
      var buffer = new byte[4096];

      while (true)
      {
        var text = Encoding.UTF8.GetString(seen.ToArray());
        var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);

        if (end >= 0)
        {
          var length = text[..end].Split("\r\n").Select(line => line.Split(':', 2)).Where(pair => pair[0].Equals("content-length", StringComparison.OrdinalIgnoreCase)).Select(pair => int.Parse(pair[1].Trim(), System.Globalization.CultureInfo.InvariantCulture)).FirstOrDefault();

          if (seen.Length >= end + 4 + length)
          {
            break;
          }
        }
        var read = await stream.ReadAsync(buffer);

        if (read == 0)
        {
          break;
        }
        seen.Write(buffer, 0, read);
      }
      await stream.WriteAsync(Encoding.UTF8.GetBytes(response));

      return Encoding.UTF8.GetString(seen.ToArray());
    });
    using var http = new McpHttpCaller();
    var creator = CreatePageWebhook.Create($"http://127.0.0.1:{port}/pages", http);

    try
    {
      var answer = await creator.CreateAsync(request ?? Request);

      return (answer, null, await accepted.WaitAsync(TimeSpan.FromSeconds(5)));
    }
    catch (Exception error) when (error is not Xunit.Sdk.XunitException)
    {
      return (null, error, await accepted.WaitAsync(TimeSpan.FromSeconds(5)));
    }
  }

  private static string Answer(int status, string body) =>
      $"HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {Encoding.UTF8.GetByteCount(body)}\r\nconnection: close\r\n\r\n{body}";

  [Fact]
  public async Task PostsTheRequestAsJsonAndTakesThePageId()
  {
    var (answer, error, request) = await AskAsync(Answer(200, """{"pageId":"host-1"}"""));

    Assert.Null(error);
    Assert.Equal("host-1", answer);
    Assert.StartsWith("POST /pages HTTP/1.1\r\n", request, StringComparison.Ordinal);
    Assert.Contains("\r\nContent-Type: application/json\r\n", request, StringComparison.OrdinalIgnoreCase);
    Assert.DoesNotContain("charset", request, StringComparison.OrdinalIgnoreCase);
    Assert.EndsWith(
        """{"parentDocumentId":"parent","principal":"alice","actor":{"id":"agent:alice:desk","name":"desk (for alice)","onBehalfOf":"alice"},"suggestedPageId":"suggested1"}""",
        request,
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task AnActorWithNoOneBehindItSendsOnBehalfOfNull()
  {
    var (_, _, request) = await AskAsync(Answer(200, """{"pageId":"host-1"}"""), Request with { Actor = new BlokAgentActor("bot", "Bot") });

    Assert.Contains("""
        "actor":{"id":"bot","name":"Bot","onBehalfOf":null}
        """, request, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ALoneSurrogateEscapeReachesTheIdCheckAsItIs()
  {
    var (answer, error, _) = await AskAsync(Answer(200, """{"pageId":"page\ud800"}"""));

    Assert.Null(error);
    Assert.Equal("page\ud800", answer);
  }

  [Theory]
  [InlineData("""{"pageId":null}""")]
  [InlineData("""{"pageId":"a","pageId":null}""")]
  public async Task ANullPageIdIsARefusal(string body)
  {
    var (answer, error, _) = await AskAsync(Answer(200, body));

    Assert.Null(error);
    Assert.Null(answer);
  }

  [Theory]
  [InlineData(201, """{"pageId":"host-1"}""", "answered 201")]
  [InlineData(500, """{"error":"database down"}""", "answered 500")]
  [InlineData(200, "{}", "no \"pageId\"")]
  [InlineData(200, """{"pageId":42}""", "no \"pageId\"")]
  [InlineData(200, "[]", "no \"pageId\"")]
  [InlineData(200, "not json", "not JSON")]
  [InlineData(200, """{"pageId":""}""", "no valid page id")]
  public async Task AnythingElseIsAHostErrorNotARefusal(int status, string body, string logged)
  {
    var (answer, error, _) = await AskAsync(Answer(status, body));

    Assert.Null(answer);
    Assert.NotNull(error);
    Assert.Contains(logged, error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ARedirectIsNotFollowed()
  {
    var (answer, error, _) = await AskAsync("HTTP/1.1 307 Temporary Redirect\r\nlocation: http://127.0.0.1:9/pages2\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");

    Assert.Null(answer);
    Assert.Contains("answered 307", error?.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task AHostThatCannotBeReachedIsAHostError()
  {
    using var http = new McpHttpCaller();
    var creator = CreatePageWebhook.Create("http://127.0.0.1:9/pages", http);

    await Assert.ThrowsAnyAsync<Exception>(async () => await creator.CreateAsync(Request));
  }

  [Fact]
  public async Task MCPNeverResolvesThroughTheWebhook()
  {
    using var http = new McpHttpCaller();
    var creator = CreatePageWebhook.Create("http://127.0.0.1:9/pages", http);

    await Assert.ThrowsAsync<NotSupportedException>(async () => await creator.ResolveAsync("p", Request.Actor));
    await Assert.ThrowsAsync<NotSupportedException>(async () => await creator.CreateAsync(Request.Actor));
  }
}
