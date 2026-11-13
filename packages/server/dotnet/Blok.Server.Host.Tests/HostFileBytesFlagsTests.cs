using Blok.Server.Host;
using Xunit;

namespace Blok.Server.Host.Tests;

public sealed class HostFileBytesFlagsTests
{
  [Fact]
  public void LeavesFileBytesAndFilesCorsOffByDefault()
  {
    var parsed = HostArguments.Parse([], _ => null);

    Assert.NotNull(parsed.Options);
    Assert.False(parsed.Options.FileBytesEnabled);
    Assert.False(parsed.Options.FilesCors);
    Assert.Equal(100L << 20, parsed.Options.FileBytesMaxBytes);
  }

  [Fact]
  public void TurnsOnFileBytesAndFilesCors()
  {
    var parsed = HostArguments.Parse(
        ["--file-bytes", "--file-bytes-max-bytes", "2048", "--files-cors"],
        _ => null);

    Assert.NotNull(parsed.Options);
    Assert.True(parsed.Options.FileBytesEnabled);
    Assert.True(parsed.Options.FilesCors);
    Assert.Equal(2048, parsed.Options.FileBytesMaxBytes);
  }

  [Fact]
  public void TakesExplicitBooleansAndAnInlineCap()
  {
    var parsed = HostArguments.Parse(
        ["--file-bytes=false", "--files-cors=false", "--file-bytes-max-bytes=0x800"],
        _ => null);

    Assert.NotNull(parsed.Options);
    Assert.False(parsed.Options.FileBytesEnabled);
    Assert.False(parsed.Options.FilesCors);
    Assert.Equal(2048, parsed.Options.FileBytesMaxBytes);
  }

  [Theory]
  [InlineData("--file-bytes=maybe", "invalid value \"maybe\" for flag -file-bytes: parse error")]
  [InlineData("--files-cors=maybe", "invalid value \"maybe\" for flag -files-cors: parse error")]
  [InlineData("--file-bytes-max-bytes=lots", "invalid value \"lots\" for flag -file-bytes-max-bytes: parse error")]
  [InlineData("--file-bytes-max-bytes", "flag needs an argument: -file-bytes-max-bytes")]
  public void RefusesMalformedValues(string argument, string error)
  {
    var parsed = HostArguments.Parse([argument], _ => null);

    Assert.Null(parsed.Options);
    Assert.Equal(error, parsed.Error);
  }

  [Fact]
  public void DescribesTheFlags()
  {
    Assert.Contains("--file-bytes\n", HostArguments.Usage, StringComparison.Ordinal);
    Assert.Contains("--file-bytes-max-bytes value", HostArguments.Usage, StringComparison.Ordinal);
    Assert.Contains("--files-cors\n", HostArguments.Usage, StringComparison.Ordinal);
  }
}
