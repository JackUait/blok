using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Storage;

internal static class S3RequestSigner
{
  private const string Algorithm = "AWS4-HMAC-SHA256";

  internal static void Sign(
      HttpRequestMessage request,
      S3Target target,
      S3BlobStoreOptions options,
      string payloadHash,
      DateTimeOffset timestamp)
  {
    ArgumentNullException.ThrowIfNull(request);
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(payloadHash);

    var utc = timestamp.ToUniversalTime();
    var amzDate = utc.ToString(
        "yyyyMMdd'T'HHmmss'Z'",
        CultureInfo.InvariantCulture);
    var dateStamp = utc.ToString(
        "yyyyMMdd",
        CultureInfo.InvariantCulture);
    var headers = new List<KeyValuePair<string, string>>(4);

    if (request.Content is not null &&
        request.Content.Headers.TryGetValues(
            "Content-Type",
            out var contentTypes))
    {
      var contentType = contentTypes.Single();
      headers.Add(new KeyValuePair<string, string>(
          "content-type",
          contentType));
    }

    headers.Add(new KeyValuePair<string, string>("host", target.Host));
    headers.Add(new KeyValuePair<string, string>(
        "x-amz-content-sha256",
        payloadHash));
    headers.Add(new KeyValuePair<string, string>(
        "x-amz-date",
        amzDate));

    request.Headers.Host = target.Host;
    request.Headers.TryAddWithoutValidation(
        "x-amz-content-sha256",
        payloadHash);
    request.Headers.TryAddWithoutValidation(
        "x-amz-date",
        amzDate);

    var canonicalHeaders = new StringBuilder();
    var signedHeaders = new StringBuilder();

    for (var index = 0; index < headers.Count; index++)
    {
      var header = headers[index];

      canonicalHeaders
          .Append(header.Key)
          .Append(':')
          .Append(CanonicalHeaderValue(header.Value))
          .Append('\n');

      if (index > 0)
      {
        signedHeaders.Append(';');
      }

      signedHeaders.Append(header.Key);
    }

    var canonicalRequest = string.Join(
        "\n",
        request.Method.Method,
        target.Url.AbsolutePath,
        "",
        canonicalHeaders.ToString(),
        signedHeaders.ToString(),
        payloadHash);
    var scope = $"{dateStamp}/{options.Region}/s3/aws4_request";
    var stringToSign = string.Join(
        "\n",
        Algorithm,
        amzDate,
        scope,
        Sha256Hex(Encoding.UTF8.GetBytes(canonicalRequest)));
    var signingKey = HmacSha256(
        HmacSha256(
            HmacSha256(
                HmacSha256(
                    Encoding.UTF8.GetBytes($"AWS4{options.SecretKey}"),
                    Encoding.UTF8.GetBytes(dateStamp)),
                Encoding.UTF8.GetBytes(options.Region)),
            "s3"u8.ToArray()),
        "aws4_request"u8.ToArray());
    var signature = Convert.ToHexStringLower(
        HmacSha256(
            signingKey,
            Encoding.UTF8.GetBytes(stringToSign)));

    request.Headers.Authorization = new AuthenticationHeaderValue(
        Algorithm,
        $"Credential={options.AccessKey}/{scope}, " +
        $"SignedHeaders={signedHeaders}, Signature={signature}");
  }

  internal static string Sha256Hex(ReadOnlySpan<byte> bytes)
  {
    return Convert.ToHexStringLower(SHA256.HashData(bytes));
  }

  private static byte[] HmacSha256(
      byte[] key,
      byte[] data)
  {
    return HMACSHA256.HashData(key, data);
  }

  private static string CanonicalHeaderValue(string value)
  {
    return string.Join(
        " ",
        value.Split(
            (char[]?)null,
            StringSplitOptions.RemoveEmptyEntries));
  }

}
