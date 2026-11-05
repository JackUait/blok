using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class CollabOperationSourceTests
{
  // Go operation.Source.String and Rust Source's Display print these too.
  [Theory]
  [InlineData(0, "ClientV2")]
  [InlineData(1, "ClientV1")]
  [InlineData(2, "HttpEdit")]
  [InlineData(7, "7")]
  [InlineData(255, "255")]
  public void NamesASourceOrPrintsTheNumberOfAnUndefinedOne(byte value, string name)
  {
    Assert.Equal(name, ((CollabOperationSource)value).ToString());
  }
}
