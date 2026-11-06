using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>
/// How Jint runs an await inside a declaration list, the shape esbuild makes when it
/// joins declarations. Measured: a plain declarator before the await runs AGAIN when the
/// await resumes; one that awaits itself does not. So a bundle site is safe only while its
/// earlier plain declarators are pure (history.restore's String(...) and the page
/// backend's lookup are); one that builds a value the await mutates is not (723a7c36).
/// </summary>
public sealed class JintDeclarationAwaitTests
{
  private static async Task<string> RunAsync(string body)
  {
    var script = "globalThis.blokServerInvoke = async (operation, input) => {" +
        "let calls = 0; const count = () => ++calls; const tick = (value) => Promise.resolve(value);" +
        body + "};";
    var runtime = new JintBlokRuntime(script, 1);

    return await runtime.InvokeAsync("probe", "{}");
  }

  [Fact]
  public async Task RunsAnEarlierPlainDeclaratorAgainWhenALaterAwaitResumes()
  {
    var answer = await RunAsync("const first = count(), second = await tick(2); return JSON.stringify({ first, second, calls });");

    Assert.Equal("""{"first":2,"second":2,"calls":2}""", answer);
  }

  [Fact]
  public async Task LosesWhatTheAwaitWroteIntoAnEarlierDeclarator()
  {
    var answer = await RunAsync("const seen = new Set(), done = await tick(seen.add(1)); return JSON.stringify({ size: seen.size });");

    Assert.Equal("""{"size":0}""", answer);
  }

  [Fact]
  public async Task KeepsADeclaratorApartByAStatementBetween()
  {
    var answer = await RunAsync("const first = count(); void 0; const second = await tick(2); return JSON.stringify({ first, calls });");

    Assert.Equal("""{"first":1,"calls":1}""", answer);
  }

  [Fact]
  public async Task DoesNotRunAnEarlierAwaitingDeclaratorAgain()
  {
    var answer = await RunAsync("const version = String(7), listed = (await tick(count()))[0], read = await tick(count()); return JSON.stringify({ version, read, calls });");

    Assert.Equal("""{"version":"7","read":2,"calls":2}""", answer);
  }
}
