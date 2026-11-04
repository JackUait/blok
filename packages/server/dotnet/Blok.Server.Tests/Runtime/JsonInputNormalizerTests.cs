using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Runtime;

public sealed class JsonInputNormalizerTests
{
  [Theory]
  [InlineData("""{"a":1,"b":[true,false,null,"x"]}""")]
  [InlineData("""{"a":"\ud83d\ude80","b":"😀"}""")]
  [InlineData("""{"a":{"k":1},"b":{"k":2}}""")]
  public void HandsBackTheSameTextWhenNothingNeedsChanging(string text)
  {
    Assert.Same(text, Normalize(text));
  }

  [Theory]
  [InlineData("""{"a":01,"a":2}""")]
  [InlineData("""{"a":1.,"a":2}""")]
  [InlineData("""{"a":.5,"a":2}""")]
  [InlineData("""{"a":+1,"a":2}""")]
  [InlineData("""{"a":1,"a":2} x""")]
  [InlineData("""{"a":1,"a":2,}""")]
  [InlineData("""{"a":"\x","a":2}""")]
  [InlineData("{\"a\":\"\t\",\"a\":2}")]
  [InlineData("{\"a\":1,\u00a0\"a\":2}")]
  [InlineData("""{"a":"\ud800",""")]
  public void LeavesTextThatIsNotStrictJsonForTheEngineToRefuse(string text)
  {
    Assert.Same(text, Normalize(text));
  }

  [Fact]
  public void KeepsTheFirstPositionAndTheLastValueOfARepeatedKey()
  {
    Assert.Equal(
        """{"a":7,"b":2}""",
        Normalize("""{"a":{"deep":[1]},"b":2,"a":7}"""));
  }

  [Fact]
  public void TreatsAnEscapedKeyAsTheKeyItSpells()
  {
    Assert.Equal(
        """{"text":"b"}""",
        Normalize("""{"text":"a","t\u0065xt":"b"}"""));
  }

  [Fact]
  public void FindsARepeatInAnObjectWithManyKeys()
  {
    var keys = string.Join(",", Enumerable.Range(0, 40).Select(i => $"\"k{i}\":{i}"));

    Assert.Equal(
        "{" + keys.Replace("\"k3\":3", "\"k3\":\"last\"", StringComparison.Ordinal) + "}",
        Normalize("{" + keys + ",\"k3\":\"last\"}"));
  }

  [Fact]
  public void CopiesNumbersAndEscapesAsWritten()
  {
    Assert.Equal(
        """{"n":[1.0,9007199254740993,-0,1E+2],"s":"\u00e9\n\/"}""",
        Normalize("""{"n":[1.0,9007199254740993,-0,1E+2],"s":"\u00e9\n\/","n":[1.0,9007199254740993,-0,1E+2]}"""));
  }

  [Fact]
  public void ReadsALoneSurrogateAsAReplacementCharacterAndKeepsPairs()
  {
    Assert.Equal(
        "{\"a\":\"x\ufffdy\ufffd\\ud83d\\ude80\ufffd\",\"\ufffd\":1}",
        Normalize("""{"a":"x\ud800y\udc00\ud83d\ude80\udbff","\udc00":1}"""));
  }

  [Fact]
  public void ReadsARawLoneSurrogateTheSameWay()
  {
    Assert.Equal("[\"a\ufffd\"]", Normalize("[\"a\ud800\"]"));
  }

  [Fact]
  public void RewritesAtTheDepthTheEngineStillReads()
  {
    const int depth = 64;
    var deep = new string('[', depth) + "\"\\ud800\"" + new string(']', depth);

    Assert.Equal(new string('[', depth) + "\"\ufffd\"" + new string(']', depth), Normalize(deep));
  }

  // Jint's JSON.parse refuses past 64 levels, so there is nothing to rewrite.
  [Fact]
  public void LeavesTextDeeperThanTheEngineReadsUnchanged()
  {
    const int depth = 200_000;
    var deep = new string('[', depth) + "\"\\ud800\"" + new string(']', depth);

    Assert.Same(deep, Normalize(deep));
  }

  [Fact]
  public void PassesALargeInputWithNoRepeatThroughOutsideTheBudget()
  {
    var large = LargeDocument(repeat: false);

    Assert.Same(large, JsonInputNormalizer.Normalize(large, allocationBudgetBytes: 1024, check: () => { }));
  }

  [Fact]
  public void RefusesARewriteLargerThanTheAllocationBudget()
  {
    var failure = Assert.Throws<BlokDocumentConversionException>(
        () => JsonInputNormalizer.Normalize(LargeDocument(repeat: true), allocationBudgetBytes: 1024, check: () => { }));

    Assert.Equal(BlokConversionFailure.DocumentTooLarge, failure.Reason);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public void StopsWhenTheCallIsCancelled(bool repeat)
  {
    using var cancelled = new CancellationTokenSource();
    var calls = 0;
    var large = LargeDocument(repeat);

    cancelled.Cancel();

    Assert.Throws<OperationCanceledException>(() => JsonInputNormalizer.Normalize(
        large,
        allocationBudgetBytes: long.MaxValue,
        check: () =>
        {
          calls++;
          cancelled.Token.ThrowIfCancellationRequested();
        }));
    Assert.Equal(1, calls);
  }

  private static string Normalize(string text) =>
      JsonInputNormalizer.Normalize(text, allocationBudgetBytes: long.MaxValue, check: () => { });

  private static string LargeDocument(bool repeat)
  {
    var blocks = string.Join(",", Enumerable.Range(0, 20_000).Select(i => $$$"""{"id":"b{{{i}}}","type":"paragraph","data":{"text":"x"}}"""));

    return repeat ? $$"""{"blocks":[],"blocks":[{{blocks}}]}""" : $$"""{"blocks":[{{blocks}}]}""";
  }
}
