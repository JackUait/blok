using System.Text.Json.Nodes;
using Blok.Server.Mcp.Protocol;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>
/// The SDK runs each line it read on the thread pool, so the tracker can see a cancel before
/// the request it names. A cancelled request is never answered, so nothing may wait for it.
/// </summary>
public sealed class McpAnswerTrackerTests : IAsyncDisposable
{
  private readonly McpServerOptions options = new();
  private readonly McpAnswerTracker tracker = new();
  private readonly StreamServerTransport transport = new(new MemoryStream(), new MemoryStream(), "t", NullLoggerFactory.Instance);
  private readonly McpServer server;

  public McpAnswerTrackerTests()
  {
    tracker.Install(options);
    server = McpServer.Create(transport, options, NullLoggerFactory.Instance);
  }

  public async ValueTask DisposeAsync()
  {
    await server.DisposeAsync();
    await transport.DisposeAsync();
  }

  private Task IncomingAsync(JsonRpcMessage message)
  {
    return options.Filters.Message.IncomingFilters[0]((_, _) => Task.CompletedTask)(new MessageContext(server, message), CancellationToken.None);
  }

  private Task OutgoingAsync(JsonRpcMessage message)
  {
    return options.Filters.Message.OutgoingFilters[0]((_, _) => Task.CompletedTask)(new MessageContext(server, message), CancellationToken.None);
  }

  private static JsonRpcRequest Call(long id) => new() { Id = new RequestId(id), Method = RequestMethods.ToolsCall };

  private static JsonRpcNotification Cancel(long id) => new()
  {
    Method = NotificationMethods.CancelledNotification,
    Params = new JsonObject { ["requestId"] = id },
  };

  private async Task<bool> DrainsAtOnceAsync()
  {
    var drain = tracker.DrainAsync(TimeSpan.FromSeconds(30));

    return await Task.WhenAny(drain, Task.Delay(TimeSpan.FromMilliseconds(500))) == drain;
  }

  [Fact]
  public async Task ACancelSeenBeforeItsRequestLeavesNothingToDrain()
  {
    await IncomingAsync(Cancel(77));
    await IncomingAsync(Call(77));

    Assert.True(await DrainsAtOnceAsync());
  }

  [Fact]
  public async Task ACancelSeenAfterItsRequestLeavesNothingToDrain()
  {
    await IncomingAsync(Call(77));
    await IncomingAsync(Cancel(77));

    Assert.True(await DrainsAtOnceAsync());
  }

  [Fact]
  public async Task ARequestWithNoAnswerYetIsWaitedFor()
  {
    await IncomingAsync(Call(77));

    Assert.False(await DrainsAtOnceAsync());
  }

  // A late cancel names a request already answered. It must not swallow the next request with that id.
  [Fact]
  public async Task ACancelOfAnAnsweredRequestDoesNotHideALaterRequestWithItsId()
  {
    await IncomingAsync(Call(77));
    await OutgoingAsync(new JsonRpcResponse { Id = new RequestId(77), Result = new JsonObject() });
    await IncomingAsync(Cancel(77));
    await IncomingAsync(Call(77));

    Assert.False(await DrainsAtOnceAsync());
  }
}
