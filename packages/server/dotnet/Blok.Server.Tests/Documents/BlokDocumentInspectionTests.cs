using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// The two questions a host asks before it converts anything: can Blok read
/// this, and is there anything in it. Both used to require running a full
/// conversion and catching what came out.
/// </summary>
public sealed class BlokDocumentInspectionTests
{
  private static IBlokDocumentConverter Converter() => BlokDocuments.Create(poolSize: 1);

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("not json at all")]
  [InlineData("[]")]
  [InlineData("\"a string\"")]
  [InlineData("{\"blocks\":\"not an array\"}")]
  [InlineData("{}")]
  public async Task RefusesToCallSomethingADocumentThatIsNot(string? candidate)
  {
    var validation = await Converter().ValidateAsync(candidate);

    Assert.False(validation.IsDocument);
    Assert.Equal(BlokConversionFailure.InvalidDocument, validation.Failure);
  }

  /// <summary>Asking is not converting: a guard must never throw.</summary>
  [Fact]
  public async Task AnswersRatherThanThrowingOnRubbish()
  {
    var validation = await Converter().ValidateAsync("{\"blocks\":");

    Assert.False(validation.IsDocument);
    Assert.Empty(validation.UnrecognizedBlockTypes);
  }

  [Fact]
  public async Task ReadsAnEmptyDocumentAsEmptyAndValid()
  {
    var validation = await Converter().ValidateAsync("""{"blocks":[]}""");

    Assert.True(validation.IsDocument);
    Assert.True(validation.IsEmpty);
    Assert.Equal(0, validation.BlockCount);
    Assert.Null(validation.Failure);
  }

  /// <summary>
  /// The distinction the whole thing exists for. Both documents read as an
  /// empty string; only one of them is actually empty.
  /// </summary>
  [Fact]
  public async Task TellsNoTextApartFromRecognisedNothing()
  {
    var converter = Converter();

    var empty = await converter.ValidateAsync("""{"blocks":[]}""");
    var unreadable = await converter.ValidateAsync("""{"blocks":[{"type":"org-chart","data":{}}]}""");

    Assert.True(empty.IsEmpty);
    Assert.Empty(empty.UnrecognizedBlockTypes);

    Assert.True(unreadable.IsEmpty);
    Assert.Equal(1, unreadable.BlockCount);
    Assert.Equal(["org-chart"], unreadable.UnrecognizedBlockTypes);
  }

  /// <summary>A divider is recognised and textless; that is not a failure.</summary>
  [Fact]
  public async Task DoesNotCallABuiltInTextlessBlockUnrecognised()
  {
    var validation = await Converter().ValidateAsync("""{"blocks":[{"type":"divider","data":{}}]}""");

    Assert.True(validation.IsDocument);
    Assert.True(validation.IsEmpty);
    Assert.Empty(validation.UnrecognizedBlockTypes);
  }

  [Fact]
  public async Task CountsBlocksItCouldNotReadAtAll()
  {
    var validation = await Converter().ValidateAsync(
        """{"blocks":[{"type":"paragraph","data":{"text":"Body"}},{"nope":1}]}""");

    Assert.True(validation.IsDocument);
    Assert.False(validation.IsEmpty);
    Assert.Equal(1, validation.BlockCount);
    Assert.Equal(1, validation.MalformedBlockCount);
  }

  /// <summary>
  /// A document that is not a document is answered without ever spending an
  /// engine, so a host may guard every inbound payload with this.
  /// </summary>
  [Fact]
  public async Task AnswersANonDocumentWithoutTouchingTheRuntime()
  {
    var runtime = new CountingRuntime();
    var converter = new BlokDocumentConverter(runtime);

    Assert.False((await converter.ValidateAsync("nonsense")).IsDocument);
    Assert.False((await converter.ValidateAsync("{}")).IsDocument);
    Assert.Equal(0, runtime.Calls);
  }

  /// <summary>
  /// The shape check on its own: no converter, no engine, no await. Everything
  /// here is something a host would otherwise hand-roll around
  /// <see cref="System.Text.Json.Nodes.JsonNode.Parse(string, System.Text.Json.Nodes.JsonNodeOptions?, System.Text.Json.JsonDocumentOptions)"/>.
  /// </summary>
  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("   ")]
  [InlineData("\t\r\n")]
  [InlineData("not json at all")]
  [InlineData("[]")]
  [InlineData("42")]
  [InlineData("null")]
  [InlineData("\"a string\"")]
  [InlineData("{}")]
  [InlineData("{\"blocks\":null}")]
  [InlineData("{\"blocks\":\"not an array\"}")]
  [InlineData("{\"blocks\":{}}")]
  [InlineData("{\"blocks\":")]
  public void RefusesTheShapeOfSomethingThatIsNotADocument(string? candidate)
  {
    Assert.False(BlokDocuments.LooksLikeADocument(candidate));
  }

  [Theory]
  [InlineData("""{"blocks":[]}""")]
  [InlineData("""{"blocks":[{"type":"paragraph","data":{"text":"Body"}}]}""")]
  [InlineData("""{"version":"1.15.1","blocks":[{"type":"divider","data":{}}]}""")]
  public void AcceptsTheShapeOfASavedDocument(string candidate)
  {
    Assert.True(BlokDocuments.LooksLikeADocument(candidate));
  }

  /// <summary>
  /// A shape check, not a validation: a block type this build has never heard
  /// of still passes here, and only <see cref="IBlokDocumentConverter.ValidateAsync"/>
  /// can say so.
  /// </summary>
  [Fact]
  public void SaysNothingAboutWhetherTheBlocksAreReadable()
  {
    const string unreadable = """{"blocks":[{"type":"org-chart","data":{}}]}""";

    Assert.True(BlokDocuments.LooksLikeADocument(unreadable));
  }

  /// <summary>
  /// The two agree on what is not a document at all — the cheap check is the
  /// same bar, reached without an engine.
  /// </summary>
  [Fact]
  public async Task AgreesWithTheFullInspectionOnWhatIsNotADocument()
  {
    var converter = Converter();

    foreach (var candidate in new[] { null, "", "not json at all", "[]", "{}" })
    {
      Assert.Equal(
          BlokDocuments.LooksLikeADocument(candidate),
          (await converter.ValidateAsync(candidate)).IsDocument);
    }
  }

  private sealed class CountingRuntime : Blok.Server.Runtime.IBlokRuntime
  {
    public int Calls { get; private set; }

    public ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        CancellationToken cancellationToken = default)
    {
      Calls++;

      return ValueTask.FromResult("{}");
    }
  }
}
