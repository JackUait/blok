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
  public async Task CreatePageBecomesTheWebhookCreatorOnTheCliAndOnTheOptions()
  {
    var argv = new[] { "--source", "files:./docs", "--page-titles", "page-map", "--create-page", "http://127.0.0.1:9/pages" };
    var cli = await McpCommandLine.ConfigureAsync(BlokMcpHost.CreateRuntime(1), argv, new Dictionary<string, string>());
    var parsed = await BlokMcpCommandLine.ParseAsync(argv);
    var options = new BlokMcpOptions();

    parsed.ApplyTo(options);

    Assert.IsType<CreatePageWebhook>(cli.PageCreator);
    Assert.IsType<CreatePageWebhook>(options.PageCreator);
  }

  [Theory]
  [InlineData("--sync-url ws://127.0.0.1:9/sync --source files:./docs --page-titles page-map --create-page http://127.0.0.1:9/pages", "--create-page works in stored mode only: it cannot be used with live rooms (--sync-url)")]
  [InlineData("--page-titles page-map --create-page http://127.0.0.1:9/pages", "--create-page needs a document source (--source): the agent opens each new page through it")]
  public async Task CreatePageOutsideStoredModeWithASourceIsRefused(string line, string message)
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => BlokMcpCommandLine.ParseAsync(line.Split(' '), new Dictionary<string, string> { ["BLOK_SECRET"] = "s" }));

    Assert.Equal(message, refused.Message);
  }

  [Fact]
  public async Task HandleStoreFilesBecomesTheFilesStoreOnTheCliAndOnTheOptions()
  {
    var argv = new[] { "--source", "files:./docs", "--handle-store", $"files:{Path.Combine(dir, "handles")}" };
    var cli = await McpCommandLine.ConfigureAsync(BlokMcpHost.CreateRuntime(1), argv, new Dictionary<string, string>());
    var parsed = await BlokMcpCommandLine.ParseAsync(argv);
    var options = new BlokMcpOptions();

    parsed.ApplyTo(options);

    Assert.IsType<FilesHandleStore>(cli.HandleStore);
    Assert.IsType<FilesHandleStore>(options.HandleStore);
    Assert.True(Directory.Exists(Path.Combine(dir, "handles")));
  }

  [Fact]
  public async Task ARefusedCommandLineMakesNoHandleStoreDirectory()
  {
    var handles = Path.Combine(dir, "refused-handles");
    var argv = new[] { "--page-titles", "page-map", "--create-page", "http://127.0.0.1:9/pages", "--handle-store", $"files:{handles}" };

    await Assert.ThrowsAsync<BlokMcpConfigException>(() => BlokMcpCommandLine.ParseAsync(argv, new Dictionary<string, string>()));

    Assert.False(Directory.Exists(handles));
  }

  [Fact]
  public async Task TheAppDisposesTheHttpClientTheCommandLineMade()
  {
    var parsed = await BlokMcpCommandLine.ParseAsync(["--source", $"files:{dir}", "--authorize", "http://127.0.0.1:9/authorize"], new Dictionary<string, string>());
    var services = new ServiceCollection();

    services.AddBlokMcp(parsed.ApplyTo);
    var provider = services.BuildServiceProvider();
    var http = provider.GetRequiredService<Blok.Server.Mcp.Outbound.McpHttpCaller>();

    await provider.DisposeAsync();
    var failed = await Assert.ThrowsAsync<Blok.Server.Mcp.Outbound.McpUnreachableException>(() =>
        http.SendAsync(new Blok.Server.Mcp.Outbound.McpHttpRequest("GET", "http://127.0.0.1:9/", []), TimeSpan.FromSeconds(5)));

    Assert.IsType<ObjectDisposedException>(failed.InnerException);
  }

  [Fact]
  public async Task HandleStoreMemoryKeepsHandlesInTheProcess()
  {
    var cli = await McpCommandLine.ConfigureAsync(BlokMcpHost.CreateRuntime(1), ["--source", "files:./docs", "--handle-store", "memory"], new Dictionary<string, string>());

    Assert.Null(cli.HandleStore);
  }

  [Fact]
  public async Task AHandleStoreDirectoryOthersCanReachIsRefusedAtStart()
  {
    var open = Path.Combine(dir, "open");

    Directory.CreateDirectory(open);
    if (!OperatingSystem.IsWindows())
    {
      File.SetUnixFileMode(open, (UnixFileMode)0b111_111_111);
    }

    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => BlokMcpCommandLine.ParseAsync(["--source", "files:./docs", "--handle-store", $"files:{open}"]));

    Assert.Equal($"--handle-store directory {open} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)", refused.Message);
  }

  [Fact]
  public async Task RefusesABadFlagWithTheCliWords()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => BlokMcpCommandLine.ParseAsync(["--nope"]));

    Assert.Contains("--nope", refused.Message, StringComparison.Ordinal);
  }
}
