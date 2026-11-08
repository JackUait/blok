using Blok.Server.Mcp.Core;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>BlokMcpCommandLine: blok-mcp's flags, applied to BlokMcpOptions, start the same server the CLI starts.</summary>
public sealed class CommandLineTests : IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-cli-").FullName;

  public CommandLineTests()
  {
    File.WriteAllText(Path.Combine(dir, "manifest.json"), """{"formatVersion":1,"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  [Theory]
  [InlineData("--source files:./docs --authorize http://127.0.0.1:9/authorize")]
  [InlineData("--source endpoint:http://127.0.0.1:9/docs --source-list http://127.0.0.1:9/list --authorize http://127.0.0.1:9/a --page-titles page-map")]
  [InlineData("--source files:./docs --authorize http://127.0.0.1:9/a --schema full --handle-idle-ms 1000 --max-handles 3 --no-comments")]
  [InlineData("--ticket-url http://127.0.0.1:9/tickets --sync-url ws://127.0.0.1:9/sync --http 127.0.0.1:0")]
  public async Task AppliedOptionsGiveTheSurfaceTheCliGives(string line)
  {
    var argv = line.Split(' ');
    var environment = new Dictionary<string, string> { ["BLOK_MCP_HOST_TOKEN"] = "host-token" };
    var host = BlokMcpHost.CreateRuntime(1);
    var cli = await McpCommandLine.ConfigureAsync(host, argv, environment);
    var parsed = await BlokMcpCommandLine.ParseAsync(argv, environment);
    var options = new BlokMcpOptions();

    parsed.ApplyTo(options);
    var services = new ServiceCollection().AddSingleton(host).BuildServiceProvider();
    var applied = BlokMcpServiceCollectionExtensions.ConfigOf(options, services);

    Assert.Equal(cli.SurfaceFlags().ToJsonString(), applied.SurfaceFlags().ToJsonString());
    Assert.Equal(cli.HttpListen, parsed.HttpListen);
    Assert.Equal(cli.Authorize is null, options.Authorize is null);
  }

  [Fact]
  public async Task AppliesAManifestFile()
  {
    var argv = new[] { "--source", "files:./docs", "--authorize", "http://127.0.0.1:9/a", "--manifest", Path.Combine(dir, "manifest.json") };
    var parsed = await BlokMcpCommandLine.ParseAsync(argv);
    var options = new BlokMcpOptions();

    parsed.ApplyTo(options);

    Assert.NotNull(options.Manifest);
  }

  [Fact]
  public async Task RefusesABadFlagWithTheCliWords()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => BlokMcpCommandLine.ParseAsync(["--nope"]));

    Assert.Contains("--nope", refused.Message, StringComparison.Ordinal);
  }
}
