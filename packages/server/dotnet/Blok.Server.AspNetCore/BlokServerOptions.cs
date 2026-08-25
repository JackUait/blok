using System.Globalization;
using System.Net;

namespace Blok.Server.AspNetCore;

public sealed class BlokServerOptions
{
  private const long DefaultMaxUploadBytes = 32L << 20;

  public string Version { get; set; } = "dev";

  public string ListenAddress { get; set; } = "127.0.0.1:4000";

  public string Auth { get; set; } = "none";

  public string Secret { get; set; } = "";

  public IList<string> AllowedOrigins { get; set; } = [];

  public string StorageDirectory { get; set; } = "";

  public string PublicUrl { get; set; } = "";

  public long MaxUploadBytes { get; set; } = DefaultMaxUploadBytes;

  public long RateLimitPerMinute { get; set; }

  public bool UnfurlDisabled { get; set; } = true;

  public string S3Endpoint { get; set; } = "";

  public string S3Region { get; set; } = "";

  public string S3Bucket { get; set; } = "";

  public string S3BucketUrl { get; set; } = "";

  public string S3Addressing { get; set; } = "";

  public string S3AccessKey { get; set; } = "";

  public string S3SecretKey { get; set; } = "";

  internal bool HasStorage => StorageDirectory != "" || S3Bucket != "";

  internal string LocalPublicPath { get; private set; } = "";

  public void Validate()
  {
    LocalPublicPath = "";
    switch (Auth)
    {
      case "none" when !IsLoopback(ListenAddress):
        throw new InvalidOperationException(
            $"--auth none serves anyone who can reach \"{ListenAddress}\"{BindScope(ListenAddress)}; " +
            "it may only bind loopback — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service");
      case "proxy" when !IsLoopback(ListenAddress):
        throw new InvalidOperationException(
            $"--auth proxy trusts every caller, so it may only bind loopback, not \"{ListenAddress}\"" +
            $"{BindScope(ListenAddress)} — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service");
      case "ticket" when Secret.Length < 32:
        throw new InvalidOperationException(
            $"--secret must be at least 32 characters (got {Secret.Length})");
      case "ticket" when AllowedOrigins.Count == 0:
        throw new InvalidOperationException(
            "a public service needs --allow-origin: without it anyone who finds this address can drive " +
            "requests at third-party sites from your IP");
      case "none":
      case "proxy":
      case "ticket":
        break;
      default:
        throw new InvalidOperationException(
            $"--auth must be none, proxy, or ticket (got \"{Auth}\")");
    }

    ValidateListenAddress();

    if (MaxUploadBytes <= 0)
    {
      throw new InvalidOperationException(
          $"--max-upload must be a positive number of bytes (got {MaxUploadBytes}): " +
          "a zero cap refuses every upload");
    }

    if (StorageDirectory != "" && S3Bucket == "")
    {
      LocalPublicPath = ParseLocalPublicPath();
    }

    if (S3Bucket == "")
    {
      return;
    }

    if (S3Endpoint == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-endpoint, e.g. https://s3.eu-central-1.amazonaws.com");
    }

    if (!Uri.TryCreate(S3Endpoint, UriKind.Absolute, out var endpoint) ||
        endpoint.Host == "" ||
        (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
    {
      throw new InvalidOperationException(
          $"--s3-endpoint must be a full URL with a scheme and a host (got \"{S3Endpoint}\")");
    }

    if (S3Region == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-region: an empty region is signed into every request and fails only at the first upload");
    }

    if (S3BucketUrl == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-bucket-url: it is the prefix stored URLs are built from, and the only prefix a delete is recognised under");
    }

    if (S3AccessKey == "" || S3SecretKey == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs credentials in the BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY environment variables " +
          "(they are deliberately not flags: a flag lands in this machine's process list)");
    }

    if (S3Addressing is not ("" or "path" or "virtual"))
    {
      throw new InvalidOperationException(
          $"--s3-addressing must be \"path\" or \"virtual\", or empty to choose automatically (got \"{S3Addressing}\")");
    }
  }

  private string ParseLocalPublicPath()
  {
    if (PublicUrl == "" || HasMalformedPercentEscape(PublicUrl) ||
        !Uri.TryCreate(PublicUrl, UriKind.RelativeOrAbsolute, out var parsed))
    {
      throw new InvalidOperationException(
          $"PublicUrl must be a valid relative or absolute URL (got \"{PublicUrl}\")");
    }

    if (parsed.IsAbsoluteUri)
    {
      return parsed.AbsolutePath.TrimEnd('/');
    }

    var suffixStart = PublicUrl.IndexOfAny(['?', '#']);
    var relativePath = suffixStart < 0
      ? PublicUrl
      : PublicUrl[..suffixStart];

    return relativePath.TrimEnd('/');
  }

  private static bool HasMalformedPercentEscape(string value)
  {
    for (var index = 0; index < value.Length; index++)
    {
      if (value[index] != '%')
      {
        continue;
      }

      if (index + 2 >= value.Length ||
          !Uri.IsHexDigit(value[index + 1]) ||
          !Uri.IsHexDigit(value[index + 2]))
      {
        return true;
      }

      index += 2;
    }

    return false;
  }

  private void ValidateListenAddress()
  {
    string port;

    if (ListenAddress.StartsWith("[", StringComparison.Ordinal))
    {
      var bracket = ListenAddress.IndexOf(']');

      if (bracket < 0 ||
          bracket + 1 >= ListenAddress.Length ||
          ListenAddress[bracket + 1] != ':')
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: missing port in address");
      }

      port = ListenAddress[(bracket + 2)..];
    }
    else
    {
      var firstColon = ListenAddress.IndexOf(':');
      var lastColon = ListenAddress.LastIndexOf(':');

      if (lastColon < 0)
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: missing port in address");
      }

      if (firstColon != lastColon)
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: too many colons in address");
      }

      port = ListenAddress[(lastColon + 1)..];
    }

    if (port == "")
    {
      throw new InvalidOperationException(
          $"listen tcp: address {ListenAddress}: missing port in address");
    }

    if (!uint.TryParse(
          port,
          NumberStyles.None,
          CultureInfo.InvariantCulture,
          out var portNumber) ||
        portNumber > 65535)
    {
      throw new InvalidOperationException(
          $"listen tcp: address {port}: invalid port");
    }
  }

  private static bool IsLoopback(string listenAddress)
  {
    var host = ListenHost(listenAddress);

    if (host == "")
    {
      return false;
    }

    if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
    {
      return true;
    }

    if (!IPAddress.TryParse(host, out var address))
    {
      return false;
    }

    return IPAddress.IsLoopback(address) ||
        (address.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(address.MapToIPv4()));
  }

  private static string BindScope(string listenAddress)
  {
    var host = ListenHost(listenAddress);

    if (host == "")
    {
      return " (an address with no host binds every network interface)";
    }

    return IPAddress.TryParse(host, out var address) &&
        (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
      ? " (which binds every network interface)"
      : "";
  }

  private static string ListenHost(string listenAddress)
  {
    if (listenAddress.StartsWith("[", StringComparison.Ordinal))
    {
      var bracket = listenAddress.IndexOf(']');

      if (bracket >= 0)
      {
        return listenAddress[1..bracket];
      }
    }

    var firstColon = listenAddress.IndexOf(':');
    var lastColon = listenAddress.LastIndexOf(':');

    if (firstColon >= 0 && firstColon == lastColon)
    {
      return listenAddress[..firstColon];
    }

    return listenAddress.Trim('[', ']').ToLowerInvariant();
  }
}
