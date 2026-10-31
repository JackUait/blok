using System.Text;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// AngleSharp, which the unfurl parser uses, registers the code-pages
/// provider for the whole process. Before that, a filename* in a code-page
/// charset was not a file name; after it, it was. The answer must not depend
/// on whether an unfurl ran first, and Go keeps the answer without a provider.
/// </summary>
public sealed class FileNameStarCodePageTests
{
  [Theory]
  [InlineData("windows-1252")]
  [InlineData("shift_jis")]
  [InlineData("koi8-r")]
  [InlineData("ibm437")]
  [InlineData("gb2312")]
  public void IgnoresACodePageCharsetOnceTheProviderIsRegistered(string charset)
  {
    Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    Assert.True(UploadEndpoint.TryReadFileName(
        $"form-data; name=\"file\"; filename*={charset}''a.txt; filename=\"b.txt\"",
        out var fileName));
    Assert.Equal("b.txt", fileName);
    Assert.False(UploadEndpoint.TryReadFileName(
        $"form-data; name=\"file\"; filename*={charset}''a.txt",
        out _));
  }

  [Theory]
  [InlineData("utf-8''caf%C3%A9.txt", "café.txt")]
  [InlineData("iso-8859-1''caf%E9.txt", "café.txt")]
  [InlineData("utf-16be''a%41%E9.txt", "a\u41E9.txt")]
  public void KeepsABuiltInCharsetOnceTheProviderIsRegistered(string value, string expected)
  {
    Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    Assert.True(UploadEndpoint.TryReadFileName(
        $"form-data; name=\"file\"; filename*={value}; filename=\"b.txt\"",
        out var fileName));
    Assert.Equal(expected, fileName);
  }
}
