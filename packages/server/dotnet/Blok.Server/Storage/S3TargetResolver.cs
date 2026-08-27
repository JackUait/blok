namespace Blok.Server.Storage;

internal readonly record struct S3Target(Uri Url, string Host);

internal static class S3TargetResolver
{
  internal static S3Target Resolve(
      S3BlobStoreOptions options,
      string key)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(key);

    if (options.Bucket == "")
    {
      throw new InvalidOperationException("blobstore: s3 needs a bucket");
    }

    if (!IsBucketName(options.Bucket))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 bucket \"{options.Bucket}\" may only contain letters, digits, dots, dashes and underscores");
    }

    if (options.AddressingStyle is not ("" or "path" or "virtual"))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 addressing style must be \"path\" or \"virtual\" (got \"{options.AddressingStyle}\")");
    }

    if (options.AddressingStyle == "virtual" &&
        !IsDnsCompatibleBucket(options.Bucket))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 bucket \"{options.Bucket}\" is not valid for virtual-hosted addressing");
    }

    if (!Uri.TryCreate(options.Endpoint, UriKind.Absolute, out var endpoint) ||
        endpoint.Host == "" ||
        (endpoint.Scheme != Uri.UriSchemeHttp &&
         endpoint.Scheme != Uri.UriSchemeHttps))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 endpoint \"{options.Endpoint}\" has no usable host");
    }

    if (!HasAsciiAuthorityHost(options.Endpoint))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 endpoint host \"{endpoint.Host}\" must be ASCII");
    }

    if (HasEndpointPath(options.Endpoint))
    {
      throw new InvalidOperationException(
          $"blobstore: s3 endpoint \"{options.Endpoint}\" must have no path");
    }

    var virtualHosted = UsesVirtualHostedAddressing(options, endpoint);
    var builder = new UriBuilder(endpoint)
    {
      Host = virtualHosted
        ? $"{options.Bucket}.{endpoint.Host}"
        : endpoint.Host,
      Path = virtualHosted
        ? $"/{key}"
        : $"/{options.Bucket}/{key}",
      Query = "",
      Fragment = "",
    };

    if (endpoint.IsDefaultPort)
    {
      builder.Port = -1;
    }

    var url = builder.Uri;
    var host = url.IsDefaultPort
      ? url.Host
      : url.Authority;

    return new S3Target(url, host);
  }

  private static bool UsesVirtualHostedAddressing(
      S3BlobStoreOptions options,
      Uri endpoint)
  {
    if (options.AddressingStyle == "path")
    {
      return false;
    }

    if (options.AddressingStyle == "virtual")
    {
      return true;
    }

    var host = endpoint.Host;

    return (string.Equals(
                host,
                "amazonaws.com",
                StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(
                ".amazonaws.com",
                StringComparison.OrdinalIgnoreCase)) &&
        !options.Bucket.Contains('.') &&
        IsDnsCompatibleBucket(options.Bucket);
  }

  private static bool IsDnsCompatibleBucket(string bucket)
  {
    if (bucket.Length is < 3 or > 63)
    {
      return false;
    }

    for (var index = 0; index < bucket.Length; index++)
    {
      var character = bucket[index];

      if (character is (>= 'a' and <= 'z') or
          (>= '0' and <= '9'))
      {
        continue;
      }

      if (character == '.' &&
          index > 0 &&
          index < bucket.Length - 1 &&
          bucket[index - 1] != '.')
      {
        continue;
      }

      if (character != '-' ||
          index == 0 ||
          index == bucket.Length - 1 ||
          bucket[index - 1] == '.' ||
          bucket[index + 1] == '.')
      {
        return false;
      }
    }

    return true;
  }

  private static bool IsBucketName(string bucket)
  {
    foreach (var character in bucket)
    {
      if (character is (>= 'a' and <= 'z') or
          (>= 'A' and <= 'Z') or
          (>= '0' and <= '9') or
          '-' or
          '.' or
          '_')
      {
        continue;
      }

      return false;
    }

    return true;
  }

  private static bool HasEndpointPath(string endpoint)
  {
    var schemeEnd = endpoint.IndexOf("://", StringComparison.Ordinal);
    var authorityStart = schemeEnd + 3;
    var suffixStart = endpoint.IndexOfAny(
        ['?', '#'],
        authorityStart);
    var pathStart = endpoint.IndexOf('/', authorityStart);

    if (pathStart < 0 ||
        (suffixStart >= 0 && pathStart > suffixStart))
    {
      return false;
    }

    var pathEnd = endpoint.IndexOfAny(
        ['?', '#'],
        pathStart);
    var rawPath = pathEnd < 0
      ? endpoint[pathStart..]
      : endpoint[pathStart..pathEnd];
    var decodedPath = Uri.UnescapeDataString(rawPath);

    return decodedPath.Trim('/') != "";
  }

  private static bool HasAsciiAuthorityHost(string endpoint)
  {
    var schemeEnd = endpoint.IndexOf("://", StringComparison.Ordinal);

    if (schemeEnd < 0)
    {
      return false;
    }

    var authorityStart = schemeEnd + 3;
    var authorityEnd = endpoint.IndexOfAny(
        ['/', '?', '#'],
        authorityStart);
    var authority = authorityEnd < 0
      ? endpoint[authorityStart..]
      : endpoint[authorityStart..authorityEnd];
    var userInfoEnd = authority.LastIndexOf('@');

    if (userInfoEnd >= 0)
    {
      authority = authority[(userInfoEnd + 1)..];
    }

    foreach (var character in authority)
    {
      if (character is < (char)0x20 or > (char)0x7e)
      {
        return false;
      }
    }

    return true;
  }
}
