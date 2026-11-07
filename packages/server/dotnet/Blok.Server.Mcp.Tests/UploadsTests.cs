using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The library's uploader hook (BlokMcpOptions.uploads in packages/mcp/types/index.d.ts).</summary>
public sealed class UploadsTests : IClassFixture<BundleFixture>, IDisposable
{
  private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01];
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-uploads-").FullName;
  private readonly BundleFixture fixture;
  private readonly List<(BlokMcpUploadFile File, BlokMcpUploadContext Context)> sent = [];

  public UploadsTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private BlokMcpUploads Uploads() => new()
  {
    Uploader = new BlokMcpUploader
    {
      UploadByFile = (file, context, _) =>
      {
        sent.Add((file, context));

        return ValueTask.FromResult(new BlokMcpUploadedFile(new Uri("https://cdn.test/cat.png")) { FileName = "stored.png" });
      },
      UploadByUrl = (url, _, _) => ValueTask.FromResult(new BlokMcpUploadedFile(url)),
    },
    Limits = new Dictionary<string, BlokMcpUploadLimits> { ["image"] = new() { Types = ["image/*"], MaxSize = 1024 } },
  };

  [Fact]
  public void TheHookHasNodesShape()
  {
    var options = new BlokMcpOptions { Uploads = Uploads() };

    Assert.NotNull(options.Uploads?.Uploader.UploadByFile);
    Assert.NotNull(options.Uploads?.Uploader.UploadByUrl);
    Assert.Equal(1024, options.Uploads?.Limits?["image"].MaxSize);
  }

  private async Task<JsonNode?> ExecuteAsync(params JsonObject[] commands)
  {
    await using var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir), Uploads = Uploads() }, new McpHttpCaller());
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var opened = await core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, caller, null, CancellationToken.None);
    var ran = await core.CallToolAsync("blok_execute", new JsonObject
    {
      ["handle"] = opened.Answer?["structuredContent"]?["handle"]?.DeepClone(),
      ["commands"] = new JsonArray(commands),
    }, caller, null, CancellationToken.None);

    return ran.Answer?["structuredContent"];
  }

  private static JsonObject Upload(string data) =>
      new() { ["name"] = "image.uploadFile", ["args"] = new JsonObject { ["data"] = data, ["fileName"] = "cat.png" } };

  [Fact]
  public async Task AnUploadSendsTheBytesTheBatchChecked()
  {
    var answer = await ExecuteAsync(Upload(Convert.ToBase64String(Png)));

    Assert.Equal(true, McpJson.Bool(answer?["ok"]));
    var (file, context) = Assert.Single(sent);
    Assert.Equal(Png, file.Bytes.ToArray());
    Assert.Equal("cat.png", file.Name);
    Assert.Equal("image/png", file.Type);
    Assert.Equal("image", context.Kind);
    Assert.Contains("https://cdn.test/cat.png", File.ReadAllText(Path.Combine(dir, "doc.json")), StringComparison.Ordinal);
  }

  [Fact]
  public async Task AnUploadAsTheSecondCommandIsRefusedAndUploadsNothing()
  {
    var answer = await ExecuteAsync(new JsonObject { ["name"] = "doc.setTitle", ["args"] = new JsonObject { ["title"] = "T" } }, Upload(Convert.ToBase64String(Png)));

    Assert.Equal("INVALID_ARGS", McpJson.String(answer?["error"]?["code"]));
    Assert.Equal(1, (int?)answer?["error"]?["commandIndex"]);
    Assert.Empty(sent);
  }

  [Fact]
  public async Task BadBase64IsAnErrorAndUploadsNothing()
  {
    var answer = await new UploadPorts(Uploads()).RunAsync(JsonNode.Parse("""{"op":"uploadByFile","fileName":"a.png","type":"image/png","size":3,"kind":"image","tool":"image","data":"!!!!"}""")!.AsObject(), CancellationToken.None);

    Assert.NotNull(McpJson.String(answer["error"]));
    Assert.Empty(sent);
  }

  [Fact]
  public async Task BytesOfAnotherLengthThanTheBatchCheckedAreRefused()
  {
    var answer = await new UploadPorts(Uploads()).RunAsync(JsonNode.Parse("""{"op":"uploadByFile","fileName":"a.png","type":"image/png","size":5,"kind":"image","tool":"image","data":"AAAA"}""")!.AsObject(), CancellationToken.None);

    Assert.Contains("not the 5", McpJson.String(answer["error"]), StringComparison.Ordinal);
    Assert.Empty(sent);
  }

  [Fact]
  public async Task AHostThrowIsLoggedInFullAndAnsweredAsNodeAnswersIt()
  {
    var logged = new List<Exception>();
    var failing = new BlokMcpUploads
    {
      Uploader = new BlokMcpUploader { UploadByFile = (_, _, _) => throw new InvalidOperationException("db.internal refused") },
    };
    var ports = new UploadPorts(failing, (_, error) => logged.Add(error));

    var answer = await ports.RunAsync(JsonNode.Parse("""{"op":"uploadByFile","fileName":"a.png","type":"image/png","size":3,"kind":"image","tool":"image","data":"AAAA"}""")!.AsObject(), CancellationToken.None);

    // Node's prepareAt forwards the throw's message (executor.ts), so this matches it.
    Assert.Equal("db.internal refused", McpJson.String(answer["error"]));
    Assert.IsType<InvalidOperationException>(Assert.Single(logged));
  }
}
