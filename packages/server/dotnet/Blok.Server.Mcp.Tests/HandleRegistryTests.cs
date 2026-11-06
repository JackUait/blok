using Blok.Server.Mcp.Core;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class HandleRegistryTests
{
  private sealed class Session;

  private long clock = 1_000;
  private int next;

  private HandleRegistry<Session> Registry(List<Session>? expired = null, double max = 2)
  {
    return new HandleRegistry<Session>(
        idleMs: 100,
        maxPerPrincipal: max,
        onExpire: session =>
        {
          expired?.Add(session);

          return Task.CompletedTask;
        },
        now: () => clock,
        newHandle: () => $"h{++next}");
  }

  [Fact]
  public void RefusesAPrincipalOverTheCapWithNodesMessage()
  {
    var registry = Registry();

    registry.Add("alice", "a", new Session());
    registry.Add("alice", "b", new Session());
    registry.Add("bob", "a", new Session());

    var refused = Assert.Throws<McpHostError>(() => registry.AssertRoom("alice"));

    Assert.Equal("HANDLE_LIMIT", refused.Code);
    Assert.Equal("You already have 2 open documents. Close one with blok_close.", refused.Message);
    Assert.Equal(2, registry.Count("alice"));
  }

  [Fact]
  public async Task AnotherPrincipalsHandleIsUnknown()
  {
    var registry = Registry();
    var handle = registry.Add("alice", "a", new Session());

    var refused = await Assert.ThrowsAsync<McpHostError>(() => registry.UseAsync(handle, "bob", (_, _) => Task.FromResult(1)));

    Assert.Equal("UNKNOWN_HANDLE", refused.Code);
    Assert.Equal("No open document has this handle. It may have expired; call blok_open again.", refused.Message);
  }

  [Fact]
  public async Task RunsOneCallAtATimePerHandle()
  {
    var registry = Registry();
    var handle = registry.Add("alice", "a", new Session());
    var first = new TaskCompletionSource();
    var order = new List<string>();

    var running = registry.UseAsync(handle, "alice", async (_, _) =>
    {
      order.Add("first starts");
      await first.Task;
      order.Add("first ends");

      return 1;
    });
    var waiting = registry.UseAsync(handle, "alice", (_, _) =>
    {
      order.Add("second runs");

      return Task.FromResult(2);
    });

    Assert.Equal(["first starts"], order);
    first.SetResult();
    await Task.WhenAll(running, waiting);
    Assert.Equal(["first starts", "first ends", "second runs"], order);
  }

  [Fact]
  public async Task ExpiresOnlyIdleHandlesThatAreNotBusy()
  {
    var expired = new List<Session>();
    var registry = Registry(expired);
    var idle = registry.Add("alice", "a", new Session());
    var busy = registry.Add("alice", "b", new Session());
    var hold = new TaskCompletionSource();
    var call = registry.UseAsync(busy, "alice", async (_, _) =>
    {
      await hold.Task;

      return 0;
    });

    clock += 101;

    Assert.Equal(1, await registry.SweepAsync());
    Assert.Single(expired);
    await Assert.ThrowsAsync<McpHostError>(() => registry.UseAsync(idle, "alice", (_, _) => Task.FromResult(0)));
    hold.SetResult();
    await call;
    Assert.Equal(0, await registry.SweepAsync());
  }

  [Fact]
  public async Task RefusesNewOpensOnceClosed()
  {
    var registry = Registry();

    registry.Add("alice", "a", new Session());
    await registry.CloseAllAsync(_ => Task.CompletedTask);

    var refused = Assert.Throws<McpHostError>(() => registry.AssertRoom("alice"));

    Assert.Equal("SOURCE_UNAVAILABLE", refused.Code);
    Assert.Equal("The server is shutting down.", refused.Message);
  }
}
