using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class CollabDocKeyTests
{
  [Fact]
  public void HashesTheIdToStableLowercaseHex()
  {
    Assert.Equal(
        "bb0e4f49443794d901e8969ff11bd112e34208a0dcdf0e1eedb480cc9b3c7293",
        CollabDocKey.For("doc-1"));
  }

  [Theory]
  [InlineData("../../evil")]
  [InlineData("a/b\\c")]
  [InlineData("id with spaces and \0 control")]
  [InlineData("документ-и-絵文字-🙂")]
  public void MapsPathHostileIdsToPlainHexNames(string docId)
  {
    Assert.Matches("^[0-9a-f]{64}$", CollabDocKey.For(docId));
  }

  [Fact]
  public void KeepsCaseVariantsDistinct()
  {
    Assert.NotEqual(
        CollabDocKey.For("doc-1"),
        CollabDocKey.For("Doc-1"));
  }

  [Fact]
  public void RefusesAnEmptyId()
  {
    Assert.Throws<ArgumentException>(() => CollabDocKey.For(""));
  }
}
