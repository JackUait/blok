using System.Text.Json;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Runtime;

public sealed class JintBlokRuntimeTests
{
  [Fact]
  public async Task ImportsMarkdown()
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1);

    var output = await runtime.InvokeAsync(
        "markdownToBlocks",
        """{"markdown":"# Hello"}""");

    var block = FirstBlock(output);
    Assert.Equal("header", block.GetProperty("type").GetString());
    Assert.Equal("Hello", block.GetProperty("data").GetProperty("text").GetString());
    Assert.Equal(1, block.GetProperty("data").GetProperty("level").GetInt32());
  }

  [Fact]
  public async Task ImportsMarkdownMath()
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1);

    var output = await runtime.InvokeAsync(
        "markdownToBlocks",
        """{"markdown":"$$E = mc^2$$"}""");

    var data = FirstBlock(output).GetProperty("data");
    Assert.Equal("E = mc^2", data.GetProperty("code").GetString());
    Assert.Equal("latex", data.GetProperty("language").GetString());
  }

  [Fact]
  public async Task RendersHtml()
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1);

    var output = await runtime.InvokeAsync(
        "blocksToHtml",
        """{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}""");

    Assert.Equal("<p>Hi <b>there</b></p>", output);
  }

  [Fact]
  public async Task RendersPlainText()
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1);

    var output = await runtime.InvokeAsync(
        "blocksToPlainText",
        """{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}""");

    Assert.Equal("Hi there", output);
  }

  [Fact]
  public async Task HandlesConcurrentCallsWithoutSharingAnEngine()
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 4);
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

    var calls = Enumerable.Range(0, 64).Select(async index =>
    {
      var expected = $"row-{index}";
      var input = JsonSerializer.Serialize(new
      {
        blocks = new[]
              {
                    new
                    {
                        type = "paragraph",
                        data = new { text = expected },
                    },
            },
      });

      var output = await runtime.InvokeAsync("blocksToPlainText", input, timeout.Token);
      Assert.Equal(expected, output);
    });

    await Task.WhenAll(calls).WaitAsync(timeout.Token);
  }

  [Fact]
  public async Task ReplacesAnEngineAfterCancellation()
  {
    const string script = """
            globalThis.blokServerInvoke = async (operation) => {
              if (operation === 'wait') return await new Promise(() => {});
              return 'ok';
            };
            """;
    var runtime = new JintBlokRuntime(script, poolSize: 1);
    using var cancelled = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => runtime.InvokeAsync("wait", "{}", cancelled.Token).AsTask());

    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var output = await runtime.InvokeAsync("ready", "{}", timeout.Token);
    Assert.Equal("ok", output);
  }

  [Fact]
  public async Task TimesOutInsteadOfHanging()
  {
    const string script = """
      globalThis.blokServerInvoke = function () {
        for (;;) {}
      };
      """;
    var runtime = new JintBlokRuntime(script, poolSize: 1, timeout: TimeSpan.FromMilliseconds(200));

    await Assert.ThrowsAnyAsync<Exception>(
        async () => await runtime.InvokeAsync("blocksToMarkdown", "{}"));
  }

  [Fact]
  public async Task ThrowsACatchableExceptionOnDeepRecursion()
  {
    const string script = """
      globalThis.blokServerInvoke = function () {
        const recurse = (depth) => depth === 0 ? 0 : recurse(depth - 1);
        return String(recurse(10000));
      };
      """;
    var runtime = new JintBlokRuntime(script, poolSize: 1);

    await Assert.ThrowsAnyAsync<Exception>(
        async () => await runtime.InvokeAsync("blocksToMarkdown", "{}"));
  }

  [Fact]
  public async Task KeepsServingAfterATimeout()
  {
    const string script = """
      globalThis.blokServerInvoke = function (operation) {
        if (operation === 'spin') { for (;;) {} }
        return 'ok';
      };
      """;
    var runtime = new JintBlokRuntime(script, poolSize: 1, timeout: TimeSpan.FromMilliseconds(200));

    // Repeated, not once: the pool is fixed size, so a slot that goes
    // unreturned even on the third failure leaves every later caller waiting
    // on a reader that will never be written to again.
    for (var attempt = 0; attempt < 3; attempt++)
    {
      await Assert.ThrowsAnyAsync<Exception>(
          async () => await runtime.InvokeAsync("spin", "{}"));

      Assert.Equal("ok", await runtime.InvokeAsync("blocksToMarkdown", "{}"));
    }
  }

  private static JsonElement FirstBlock(string output)
  {
    using var document = JsonDocument.Parse(output);
    return document.RootElement.GetProperty("blocks")[0].Clone();
  }
}
