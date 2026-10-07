using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class RichTextFieldsTests
{
  [Fact]
  public void BuiltInsEqualTheClientTableTheTsSuitePins()
  {
    var fixture = RichTextFixtures.ReadJson("rich-text-fields.json").AsObject();

    Assert.Equal(
        fixture.Select(entry => $"{entry.Key}:{string.Join(',', entry.Value!.AsArray().Select(field => field!.GetValue<string>()))}")
            .Order(StringComparer.Ordinal),
        RichTextFields.BuiltIn.Table
            .Select(entry => $"{entry.Key}:{string.Join(',', entry.Value)}")
            .Order(StringComparer.Ordinal));
  }

  [Theory]
  [InlineData("paragraph", "text", true)]
  [InlineData("header", "text", true)]
  [InlineData("quote", "text", true)]
  [InlineData("toggle", "text", true)]
  [InlineData("list", "text", true)]
  [InlineData("quote", "caption", false)]
  [InlineData("code", "code", false)]
  [InlineData("image", "caption", false)]
  [InlineData("custom", "text", false)]
  [InlineData(null, "text", false)]
  public void BuiltInsNameOnlyTheCurrentFields(string? type, string key, bool rich)
  {
    Assert.Equal(rich, RichTextFields.BuiltIn.IsRich(type, key));
  }

  [Fact]
  public void CustomFieldsAddToTheBuiltIns()
  {
    var fields = RichTextFields.With(new Dictionary<string, IList<string>>
    {
      ["callout"] = ["title", "body"],
      ["paragraph"] = ["note"],
    });

    Assert.True(fields.IsRich("callout", "title"));
    Assert.True(fields.IsRich("callout", "body"));
    Assert.True(fields.IsRich("paragraph", "text"));
    Assert.True(fields.IsRich("paragraph", "note"));
    Assert.False(fields.IsRich("callout", "text"));
    Assert.False(RichTextFields.BuiltIn.IsRich("callout", "title"));
  }

  [Theory]
  [InlineData("", "text")]
  [InlineData("callout", "")]
  [InlineData("call\0out", "text")]
  [InlineData("callout", "ti\0tle")]
  public void RefusesAnEmptyOrNulName(string type, string field)
  {
    Assert.Throws<ArgumentException>(() => RichTextFields.With(
        new Dictionary<string, IList<string>> { [type] = [field] }));
  }

  [Fact]
  public void RefusesANullFieldList()
  {
    Assert.Throws<ArgumentException>(() => RichTextFields.With(
        new Dictionary<string, IList<string>> { ["callout"] = null! }));
  }
}
