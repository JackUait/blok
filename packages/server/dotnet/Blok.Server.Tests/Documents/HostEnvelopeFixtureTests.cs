using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/documents/host.json, which the Go
/// blokdocs package reads too. Each case drives one converter method over a
/// fake runtime and pins the exact request it sends and what it returns or
/// throws. C# is the reference: run with BLOK_CAPTURE_HOST_FIXTURE=1 to
/// rewrite the expectations from this implementation.
/// </summary>
public sealed class HostEnvelopeFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/documents/host.json";

  private static string FixturePath => Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

  private static JsonArray ReadCases() =>
      JsonNode.Parse(File.ReadAllText(FixturePath))?.AsArray()
          ?? throw new InvalidDataException($"{FixturePath} holds JSON null");

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in ReadCases())
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesTheSharedFixture(string name)
  {
    var entry = ReadCases().Single(entry => entry!["name"]!.GetValue<string>() == name)!.AsObject();
    var actual = await Run(entry);

    Assert.True(
        JsonNode.DeepEquals(entry["request"], actual["request"]),
        $"request\n got {actual["request"]?.ToJsonString()}\nwant {entry["request"]?.ToJsonString()}");
    Assert.True(
        JsonNode.DeepEquals(entry["hrefCalls"], actual["hrefCalls"]),
        $"hrefCalls\n got {actual["hrefCalls"]?.ToJsonString()}\nwant {entry["hrefCalls"]?.ToJsonString()}");
    Assert.True(
        JsonNode.DeepEquals(entry["expect"], actual["expect"]),
        $"expect\n got {actual["expect"]?.ToJsonString()}\nwant {entry["expect"]?.ToJsonString()}");
  }

  [Fact]
  public async Task CapturesTheFixtureWhenAsked()
  {
    if (Environment.GetEnvironmentVariable("BLOK_CAPTURE_HOST_FIXTURE") != "1")
    {
      return;
    }

    var cases = ReadCases();

    foreach (var entry in cases)
    {
      var actual = await Run(entry!.AsObject());

      entry["request"] = actual["request"]?.DeepClone();
      entry["hrefCalls"] = actual["hrefCalls"]?.DeepClone();
      entry["expect"] = actual["expect"]?.DeepClone();
    }

    var options = new JsonSerializerOptions
    {
      WriteIndented = true,
      IndentSize = 2,
      Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    await File.WriteAllTextAsync(FixturePath, cases.ToJsonString(options) + "\n");
  }

  private static async Task<JsonObject> Run(JsonObject entry)
  {
    var args = entry["args"]!.AsObject();
    var runtime = new FixtureRuntime(entry["runtime"]!.AsObject());
    var converter = new BlokDocumentConverter(runtime);
    var hrefCalls = new JsonArray();
    JsonObject expect;

    try
    {
      expect = new JsonObject { ["result"] = await Call(converter, entry["method"]!.GetValue<string>(), args, hrefCalls) };
    }
    catch (BlokDocumentConversionException exception)
    {
      expect = Error("conversion", ("reason", exception.Reason.ToString()), ("message", exception.Message));
    }
    catch (ArgumentException exception)
    {
      var suffix = $" (Parameter '{exception.ParamName}')";

      Assert.EndsWith(suffix, exception.Message, StringComparison.Ordinal);
      expect = Error(
          "argument",
          ("param", exception.ParamName),
          ("message", exception.Message[..^suffix.Length]));
    }
    catch (JsonException)
    {
      expect = Error("json");
    }
    catch (InvalidOperationException exception)
    {
      expect = Error("invalidOperation", ("message", exception.Message));
    }

    return new JsonObject
    {
      ["request"] = runtime.Request,
      ["hrefCalls"] = hrefCalls.Count > 0 ? hrefCalls : null,
      ["expect"] = expect,
    };
  }

  private static JsonObject Error(string kind, params (string Key, string? Value)[] fields)
  {
    var error = new JsonObject { ["kind"] = kind };

    foreach (var (key, value) in fields)
    {
      error[key] = value;
    }

    return new JsonObject { ["error"] = error };
  }

  private static async Task<JsonNode?> Call(
      BlokDocumentConverter converter,
      string method,
      JsonObject args,
      JsonArray hrefCalls)
  {
    var document = args["document"]?.GetValue<string>();
    var includeHidden = args["includeHiddenText"]?.GetValue<bool>() ?? false;
    var includeCode = args["includeCode"]?.GetValue<bool>() ?? false;
    var href = Href(args, hrefCalls);

    return method switch
    {
      "ToMarkdown" => Shape(await converter.ToMarkdownAsync(document!)),
      "ToMarkdownWithPages" => Shape(await converter.ToMarkdownAsync(document!, Pages(args)!, href)),
      "ToMarkdownWithTitle" => Shape(await converter.ToMarkdownWithTitleAsync(document!)),
      "ToMarkdownWithTitleAndPages" => Shape(await converter.ToMarkdownWithTitleAsync(document!, Pages(args)!, href)),
      "ToHtml" => await converter.ToHtmlAsync(document!),
      "ToHtmlWithPages" => await converter.ToHtmlAsync(document!, Pages(args)!, href),
      "ToHtmlWithTitle" => await converter.ToHtmlWithTitleAsync(document!),
      "ToHtmlWithTitleAndPages" => await converter.ToHtmlWithTitleAsync(document!, Pages(args)!, href),
      "ToPlainText" => await converter.ToPlainTextAsync(document!, includeHidden),
      "ToPlainTextWithTitle" => await converter.ToPlainTextWithTitleAsync(document!, includeHidden),
      "ToPlainTextWithReport" => JsonSerializer.SerializeToNode(await converter.ToPlainTextWithReportAsync(document!, includeHidden)),
      "ExtractTexts" => JsonSerializer.SerializeToNode(await converter.ExtractTextsAsync(document!, includeCode)),
      "InjectTexts" => await converter.InjectTextsAsync(document!, Texts(args)!, includeCode),
      "PageIndex" => JsonSerializer.SerializeToNode(await converter.GetPageIndexAsync(document!)),
      "RemapPageDocument" => await converter.RemapPageDocumentAsync(document!, Ids(args, "blockIds")!, Ids(args, "pageIds")!),
      "Validate" => Shape(await converter.ValidateAsync(document)),
      "FromMarkdown" => Shape(await converter.FromMarkdownAsync(args["text"]!.GetValue<string>())),
      "FromHtml" => Shape(await converter.FromHtmlAsync(args["text"]!.GetValue<string>())),
      _ => throw new InvalidDataException($"Unknown method {method}"),
    };
  }

  private static JsonNode? Shape(BlokMarkdownConversion conversion) => JsonSerializer.SerializeToNode(conversion);

  private static JsonObject Shape(BlokImportConversion conversion) => new JsonObject
  {
    ["document"] = conversion.DocumentJson,
    ["warnings"] = JsonSerializer.SerializeToNode(conversion.Warnings),
  };

  private static JsonObject Shape(BlokDocumentValidation validation) => new JsonObject
  {
    ["isDocument"] = validation.IsDocument,
    ["isEmpty"] = validation.IsEmpty,
    ["blockCount"] = validation.BlockCount,
    ["malformedBlockCount"] = validation.MalformedBlockCount,
    ["unrecognizedBlockTypes"] = JsonSerializer.SerializeToNode(validation.UnrecognizedBlockTypes),
    ["failure"] = validation.Failure?.ToString(),
    ["isFullyUnderstood"] = validation.IsFullyUnderstood,
  };

  private static Dictionary<string, BlokPageInfo?>? Pages(JsonObject args)
  {
    if (args["pages"] is not JsonObject given)
    {
      return null;
    }

    var pages = new Dictionary<string, BlokPageInfo?>();

    foreach (var (pageId, raw) in given)
    {
      if (raw is null)
      {
        pages[pageId] = null;
        continue;
      }

      var icon = raw["icon"] switch
      {
        null => null,
        JsonNode node when node["emoji"] is JsonNode emoji => BlokPageIcon.Emoji(emoji.GetValue<string>()),
        JsonNode node => BlokPageIcon.Image(node["image"]!.GetValue<string>()),
      };

      pages[pageId] = new BlokPageInfo
      {
        Title = raw["title"]?.GetValue<string>(),
        Icon = icon,
        NoAccess = raw["noAccess"]?.GetValue<bool>() ?? false,
      };
    }

    return pages;
  }

  private static Func<string, string>? Href(JsonObject args, JsonArray calls)
  {
    if (args["pageHrefs"] is not JsonObject hrefs)
    {
      return null;
    }

    return pageId =>
    {
      calls.Add(pageId);

      return hrefs[pageId]?.GetValue<string>()!;
    };
  }

  private static string[]? Texts(JsonObject args) =>
      args["texts"] is JsonArray texts ? [.. texts.Select(text => text!.GetValue<string>())] : null;

  private static Dictionary<string, string>? Ids(JsonObject args, string name) =>
      args[name]?.AsObject().ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>());

  private sealed class FixtureRuntime(JsonObject script) : IBlokRuntime
  {
    public JsonObject? Request { get; private set; }

    public ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      Assert.Null(Request);
      Request = new JsonObject { ["op"] = operation, ["input"] = inputJson };

      if (script["error"] is JsonNode error)
      {
        throw new BlokDocumentConversionException(
            Enum.Parse<BlokConversionFailure>(error.GetValue<string>()),
            new InvalidOperationException("fake runtime failure"));
      }

      return ValueTask.FromResult(script["answer"]!.GetValue<string>());
    }
  }
}
