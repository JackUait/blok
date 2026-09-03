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

  /// <summary>
  /// The protection that matters is that the process survives: a .NET
  /// StackOverflowException cannot be caught and takes the host with it. The
  /// stack guard converts it into an ordinary JavaScript error, which means the
  /// engine is still usable afterwards — so the pool must NOT treat it as
  /// poison, and the second call here is what proves the slot was not lost.
  /// </summary>
  [Fact]
  public async Task SurvivesRunawayRecursionAndKeepsServing()
  {
    const string script = """
      globalThis.blokServerInvoke = function (operation) {
        if (operation === 'runaway') {
          const recurse = (depth) => depth === 0 ? 0 : recurse(depth - 1) + 1;
          return String(recurse(1000000));
        }
        return 'ok';
      };
      """;
    var runtime = new JintBlokRuntime(script, poolSize: 1);

    await Assert.ThrowsAnyAsync<Exception>(
        async () => await runtime.InvokeAsync("runaway", "{}"));

    Assert.Equal("ok", await runtime.InvokeAsync("blocksToMarkdown", "{}"));
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

  /// <summary>
  /// A long article has to convert under the engine's own memory limit. Joining
  /// the finished segments by repeated concatenation allocated the whole
  /// document again for every block, which is quadratic: 250 KB already
  /// allocated past 64 MB and the conversion failed outright rather than merely
  /// running slowly. Sized at 600 KB deliberately — well past where the old
  /// shape died — so the limit is proven to scale with the document rather than
  /// merely to have been nudged.
  ///
  /// <para>blocksToHtml was left out when that was fixed and failed for its own
  /// reason: it sanitized every inline field, and sanitizing parses the fragment
  /// twice — once for a &lt;div&gt; parse context rebuilt per call. A field with no
  /// markup now skips the parser entirely, so every reader here is covered.</para>
  /// </summary>
  [Theory]
  [InlineData("blocksToPlainText")]
  [InlineData("blocksToMarkdown")]
  [InlineData("blocksToHtml")]
  public async Task ConvertsALongArticleWithoutExhaustingTheMemoryLimit(string operation)
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1, timeout: TimeSpan.FromMinutes(5));
    var paragraph = string.Join(' ', Enumerable.Repeat("слово", 30));
    var blocks = Enumerable.Range(0, 3600).Select(index => new
    {
      id = $"b{index}",
      type = "paragraph",
      data = new { text = paragraph },
    });
    var input = JsonSerializer.Serialize(new { blocks });

    Assert.True(input.Length > 600_000, $"the document has to be long enough to matter: {input.Length}");

    var output = await runtime.InvokeAsync(operation, input);

    Assert.Contains(paragraph, output, StringComparison.Ordinal);
  }

  /// <summary>
  /// A deeply indented outline has to convert. The readers recurse once per
  /// nesting level, and a frame COUNT on one function definition cannot tell an
  /// ordinary nested list from a runaway recursion — it stops both. The
  /// protection that matters is that the process survives, and that is a
  /// property of the native stack, not of a frame count.
  /// </summary>
  [Theory]
  [InlineData("blocksToPlainText")]
  [InlineData("blocksToMarkdown")]
  public async Task ConvertsADeeplyNestedOutline(string operation)
  {
    var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1, timeout: TimeSpan.FromMinutes(2));
    var blocks = Enumerable.Range(0, 120).Select(depth => new
    {
      id = $"n{depth}",
      parent = depth == 0 ? null : $"n{depth - 1}",
      type = "list",
      data = new { style = "unordered", text = $"level {depth}" },
    });
    var input = JsonSerializer.Serialize(new { blocks });

    var output = await runtime.InvokeAsync(operation, input);

    Assert.Contains("level 119", output, StringComparison.Ordinal);
  }

  private static JsonElement FirstBlock(string output)
  {
    using var document = JsonDocument.Parse(output);
    return document.RootElement.GetProperty("blocks")[0].Clone();
  }
}
