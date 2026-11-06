using Blok.Server.Mcp.Core;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class JsUriTests
{
  [Theory]
  [InlineData("doc", "doc")]
  [InlineData("a b/c?é", "a%20b%2Fc%3F%C3%A9")]
  [InlineData("-_.!~*'()", "-_.!~*'()")]
  [InlineData("документ-😀", "%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82-%F0%9F%98%80")]
  public void EncodesAComponentAsEncodeUriComponentDoes(string value, string encoded)
  {
    Assert.Equal(encoded, JsUri.EncodeComponent(value));
  }

  [Fact]
  public void WritesQueryParametersAsUrlSearchParamsDoes()
  {
    var query = JsUri.FormEncode([new("query", "al ph"), new("cursor", "c 1"), new("limit", "3"), new("x", "!'()~*")]);

    Assert.Equal("query=al+ph&cursor=c+1&limit=3&x=%21%27%28%29%7E*", query);
  }
}
