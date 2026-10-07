using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// One runtime call runs under one timeout, and its cost grows with the HTML
/// it reads, so a large room is read in bounded calls.
/// </summary>
public sealed class RuntimeRichTextHtmlReaderTests
{
  [Fact]
  public async Task ReadsALargeBatchInBoundedCallsAndKeepsTheOrder()
  {
    var runtime = new EchoRuntime();
    var reader = new RuntimeRichTextHtmlReader(runtime);
    var html = new string('x', RuntimeRichTextHtmlReader.MaxCallChars / 4);
    var fields = Enumerable.Range(0, 10)
        .Select(index => new RichTextHtml("paragraph", "text", $"{index}:{html}"))
        .ToList();

    var read = await reader.ReadAsync(fields);

    Assert.Equal(4, runtime.Calls.Count);
    Assert.All(runtime.Calls, call => Assert.True(call.Sum(field => field.Length) <= RuntimeRichTextHtmlReader.MaxCallChars));
    Assert.Equal(
        fields.Select(field => field.Html),
        read.Select(segments => segments[0]!["text"]!.GetValue<string>()));
  }

  /// <summary>A field cannot be split; one larger than a call goes alone.</summary>
  [Fact]
  public async Task ReadsAnOversizedFieldInACallOfItsOwn()
  {
    var runtime = new EchoRuntime();
    var reader = new RuntimeRichTextHtmlReader(runtime);
    var huge = new string('h', RuntimeRichTextHtmlReader.MaxCallChars + 1);

    var read = await reader.ReadAsync(
    [
      new RichTextHtml("paragraph", "text", "a"),
      new RichTextHtml("paragraph", "text", huge),
      new RichTextHtml("paragraph", "text", "b"),
    ]);

    Assert.Equal([["a"], [huge], ["b"]], runtime.Calls);
    Assert.Equal(["a", huge, "b"], read.Select(segments => segments[0]!["text"]!.GetValue<string>()));
  }

  /// <summary>Answers each field with one segment holding its HTML, and records each call's HTML.</summary>
  private sealed class EchoRuntime : IBlokRuntime
  {
    internal List<List<string>> Calls { get; } = [];

    public ValueTask<string> InvokeAsync(
        string operation, string inputJson, CancellationToken cancellationToken = default)
    {
      Assert.Equal("htmlFieldsToSegments", operation);

      var request = (AnyArray)JsJson.Parse(inputJson)!;
      var answer = new AnyArray();
      var call = new List<string>();

      foreach (var entry in request)
      {
        var field = (AnyObject)entry!;
        field.TryGet("html", out var html);
        call.Add((string)html!);

        var segment = new AnyObject();
        segment.Add("text", html);
        var segments = new AnyArray { segment };
        var answered = new AnyObject();
        answered.Add("segments", segments);
        answer.Add(answered);
      }

      Calls.Add(call);

      return ValueTask.FromResult(JsJson.Stringify(answer));
    }
  }
}
