using System.Net;
using Blok.Server.Outbound;
using Xunit;

namespace Blok.Server.Tests;

public sealed class GuardedOutboundPolicyTests
{
  private static readonly GuardedOutboundPolicy Policy = new();

  [Theory]
  [InlineData("http://example.com/path", "http://example.com/path", 80)]
  [InlineData("https://example.com/", "https://example.com/", 443)]
  [InlineData("http://example.com:443/", "http://example.com:443/", 443)]
  [InlineData("https://example.com:80/", "https://example.com:80/", 80)]
  public void AcceptsOnlyHttpDestinationsOnTheRestrictedPorts(
      string rawUrl,
      string expectedUrl,
      int expectedPort)
  {
    var target = Policy.Validate(rawUrl);

    Assert.Equal(expectedUrl, target.Url.AbsoluteUri);
    Assert.Equal("example.com", target.Host);
    Assert.Equal(expectedPort, target.Port);
  }

  [Theory]
  [InlineData("")]
  [InlineData("example.com/no-scheme")]
  [InlineData("file:///etc/passwd")]
  [InlineData("gopher://example.com/")]
  [InlineData("ftp://example.com/")]
  [InlineData("javascript:alert(1)")]
  [InlineData("data:text/plain,hello")]
  [InlineData("http:///missing-host")]
  [InlineData("http://example.com:0/")]
  [InlineData("http://example.com:22/")]
  [InlineData("https://example.com:444/")]
  [InlineData("http://example.com:65536/")]
  public void RejectsInvalidSchemesHostsAndPorts(string rawUrl)
  {
    var error = Assert.Throws<GuardedFetchException>(
        () => Policy.Validate(rawUrl));

    Assert.Equal(GuardedFetchFailure.BlockedDestination, error.Failure);
    Assert.True(error.Message.Length <= 128);
  }

  [Theory]
  [InlineData("http://admin:secret@example.com/")]
  [InlineData("http://admin@example.com/")]
  [InlineData("http://:secret@example.com/")]
  [InlineData("http://@example.com/")]
  [InlineData("http:/\\@example.com/")]
  [InlineData("http:\\\\@example.com/")]
  [InlineData("https://user%40domain@example.com/")]
  public void RejectsEveryFormOfAuthorityCredentials(string rawUrl)
  {
    var error = Assert.Throws<GuardedFetchException>(
        () => Policy.Validate(rawUrl));

    Assert.Equal(GuardedFetchFailure.BlockedDestination, error.Failure);
  }

  public static TheoryData<string> ForbiddenAddresses =>
      new()
      {
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "100.64.0.1",
        "100.100.100.200",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:192.168.0.1",
        "64:ff9b::1",
        "64:ff9b:1::1",
        "100::1",
        "100:0:0:1::1",
        "2001::1",
        "2001:2::1",
        "2001:10::1",
        "2001:20::1",
        "2001:db8::1",
        "2002::1",
        "3fff::1",
        "5f00::1",
        "fc00::1",
        "fe80::1",
        "ff00::1",
      };

  [Fact]
  public void ResolvesAndValidatesARelativeRedirect()
  {
    var target = Policy.Validate(
        "../next?from=redirect",
        new Uri("https://example.com/path/start"));

    Assert.Equal(
        "https://example.com/next?from=redirect",
        target.Url.AbsoluteUri);
  }

  [Fact]
  public void AcceptsARelativeRedirectWithAUrlInItsQuery()
  {
    var target = Policy.Validate(
        "next?return=http://user@elsewhere",
        new Uri("https://example.com/path/start"));

    Assert.Equal(
        "https://example.com/path/next?return=http://user@elsewhere",
        target.Url.AbsoluteUri);
  }

  [Theory]
  [InlineData("//@example.com/private")]
  [InlineData("//user@example.com/private")]
  [InlineData("//:secret@example.com/private")]
  [InlineData("//user:secret@example.com/private")]
  public void RejectsCredentialsInANetworkPathRedirect(string location)
  {
    var error = Assert.Throws<GuardedFetchException>(
        () => Policy.Validate(
            location,
            new Uri("https://example.com/start")));

    Assert.Equal(
        GuardedFetchFailure.BlockedDestination,
        error.Failure);
  }

  [Theory]
  [MemberData(nameof(ForbiddenAddresses))]
  public void RejectsEveryForbiddenIpv4AndIpv6Class(string rawAddress)
  {
    var address = IPAddress.Parse(rawAddress);

    Assert.False(Policy.IsAddressAllowed(address));
  }

  [Theory]
  [InlineData("1.1.1.1")]
  [InlineData("8.8.8.8")]
  [InlineData("2001:4860:4860::8888")]
  [InlineData("2606:4700:4700::1111")]
  public void AllowsOrdinaryGlobalAddresses(string rawAddress)
  {
    Assert.True(Policy.IsAddressAllowed(IPAddress.Parse(rawAddress)));
  }

  [Theory]
  [InlineData("http://127.1/")]
  [InlineData("http://0177.0.0.1/")]
  [InlineData("http://0x7f000001/")]
  [InlineData("http://2130706433/")]
  [InlineData("http://2852039166/latest/meta-data/")]
  [InlineData("http://[::ffff:127.0.0.1]/")]
  [InlineData("http://[::ffff:169.254.169.254]/latest/meta-data/")]
  public void CanonicalizesAlternateAddressNotationBeforeClassification(
      string rawUrl)
  {
    var target = Policy.Validate(rawUrl);

    var address = Assert.IsType<IPAddress>(target.LiteralAddress);
    Assert.False(Policy.IsAddressAllowed(address));
  }
}
