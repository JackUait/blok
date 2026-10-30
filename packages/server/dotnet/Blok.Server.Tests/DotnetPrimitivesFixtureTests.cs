using System.Net;
using System.Text.Json.Nodes;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/dotnet/primitives.json, which
/// the Go server reads to match IPAddress.TryParse, System.Uri and
/// Uri.UnescapeDataString. Every answer is recomputed here, so a stale capture
/// fails this test. Regenerate with
/// dotnet fsi scripts/capture-dotnet-primitives.fsx.
/// </summary>
public sealed class DotnetPrimitivesFixtureTests
{
  private static JsonObject Fixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/dotnet/primitives.json");

    return JsonNode.Parse(File.ReadAllText(path))!.AsObject();
  }

  [Fact]
  public void IpAddressAnswersMatchTheCapture()
  {
    foreach (var entry in Fixture()["ip"]!.AsArray())
    {
      var input = entry!["input"]!.GetValue<string>();
      var ok = IPAddress.TryParse(input, out var address);

      Assert.True(entry["ok"]!.GetValue<bool>() == ok, input);

      if (ok)
      {
        Assert.Equal(entry["address"]!.GetValue<string>(), address!.ToString());
        Assert.Equal(entry["loopback"]!.GetValue<bool>(), IPAddress.IsLoopback(address));
        Assert.Equal(
            entry["any"]!.GetValue<bool>(),
            address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any));
      }
    }
  }

  [Fact]
  public void UriAnswersMatchTheCapture()
  {
    var fixture = Fixture();

    foreach (var entry in fixture["uri"]!.AsArray().Concat(fixture["relative"]!.AsArray()))
    {
      var input = entry!["input"]!.GetValue<string>();
      var baseText = entry["base"]?.GetValue<string>();
      var ok = baseText is null
        ? Uri.TryCreate(input, UriKind.Absolute, out var uri)
        : Uri.TryCreate(new Uri(baseText), input, out uri);

      Assert.True(entry["ok"]!.GetValue<bool>() == ok, $"{baseText} {input}");

      if (ok)
      {
        Assert.Equal(entry["scheme"]!.GetValue<string>(), uri!.Scheme);
        Assert.Equal(entry["host"]!.GetValue<string>(), uri.Host);
        Assert.Equal(entry["idnHost"]!.GetValue<string>(), uri.IdnHost);
        Assert.Equal(entry["userInfo"]!.GetValue<string>(), uri.UserInfo);
        Assert.Equal(entry["port"]!.GetValue<int>(), uri.Port);
        Assert.Equal(entry["absolutePath"]!.GetValue<string>(), uri.AbsolutePath);
        Assert.Equal(entry["query"]!.GetValue<string>(), uri.Query);
        Assert.Equal(entry["fragment"]!.GetValue<string>(), uri.Fragment);
        Assert.Equal(entry["absoluteUri"]!.GetValue<string>(), uri.AbsoluteUri);
        Assert.Equal(entry["loopback"]!.GetValue<bool>(), uri.IsLoopback);
      }
    }
  }

  [Fact]
  public void UnescapeAnswersMatchTheCapture()
  {
    foreach (var entry in Fixture()["unescape"]!.AsArray())
    {
      Assert.Equal(
          entry![1]!.GetValue<string>(),
          Uri.UnescapeDataString(entry[0]!.GetValue<string>()));
    }
  }
}
