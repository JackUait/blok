using System.Net;
using Blok.Server.AspNetCore;

namespace Blok.Server.Host;

internal sealed record HostParseResult(
    BlokServerOptions? Options,
    bool HelpRequested,
    string? Error,
    bool SecretFromFlag);

internal static class HostArguments
{
  private const long DefaultTicketRateLimit = 60;

  internal const string Usage =
      """
      Usage of blok-server:
        --listen value
          address to listen on (default "127.0.0.1:4000")
        --auth value
          access mode: none, proxy, or ticket (default "none")
        --secret value
          shared secret for --auth ticket; prefer BLOK_SECRET
        --allow-origin value
          comma-separated origins allowed to call this service
        --storage-dir value
          directory for uploaded files (default "./blok-uploads")
        --public-url value
          URL prefix uploaded files are handed out under
        --max-upload value
          largest upload accepted, in bytes (default 33554432)
        --rate-limit value
          requests a minute per caller (ticket mode defaults to 60; other modes default to 0)
        --no-unfurl
          close GET /unfurl and POST /upload-by-url
        --s3-endpoint value
          S3-compatible endpoint
        --s3-region value
          S3 region
        --s3-bucket value
          S3 bucket
        --s3-bucket-url value
          public S3 bucket URL prefix
        --s3-addressing value
          "path" or "virtual"

      """;

  public static HostParseResult Parse(
      string[] args,
      Func<string, string?> getEnvironmentVariable)
  {
    ArgumentNullException.ThrowIfNull(args);
    ArgumentNullException.ThrowIfNull(getEnvironmentVariable);

    var options = new BlokServerOptions
    {
      StorageDirectory = "./blok-uploads",
      UnfurlDisabled = false,
    };
    var origins = "";
    var publicUrl = "";
    long? rateLimit = null;
    var secretFromFlag = false;

    for (var index = 0; index < args.Length; index++)
    {
      var argument = args[index];

      if (argument == "--")
      {
        break;
      }

      if (argument.Length < 2 || argument[0] != '-')
      {
        break;
      }

      var nameAndValue = argument[1] == '-' ? argument[2..] : argument[1..];
      var equals = nameAndValue.IndexOf('=');
      var name = equals >= 0 ? nameAndValue[..equals] : nameAndValue;
      var inlineValue = equals >= 0 ? nameAndValue[(equals + 1)..] : null;

      if (name is "h" or "help")
      {
        return new HostParseResult(null, true, null, false);
      }

      if (name == "no-unfurl")
      {
        if (inlineValue is null)
        {
          options.UnfurlDisabled = true;
          continue;
        }

        if (!TryParseBoolean(inlineValue, out var disabled))
        {
          return ParseError(
              $"invalid value \"{inlineValue}\" for flag -no-unfurl: parse error");
        }

        options.UnfurlDisabled = disabled;
        continue;
      }

      if (!IsValueFlag(name))
      {
        return ParseError($"flag provided but not defined: -{name}");
      }

      string value;

      if (inlineValue is not null)
      {
        value = inlineValue;
      }
      else if (index + 1 < args.Length)
      {
        value = args[++index];
      }
      else
      {
        return ParseError($"flag needs an argument: -{name}");
      }

      switch (name)
      {
        case "listen":
          options.ListenAddress = value;
          break;
        case "auth":
          options.Auth = value;
          break;
        case "secret":
          options.Secret = value;
          secretFromFlag = true;
          break;
        case "allow-origin":
          origins = value;
          break;
        case "storage-dir":
          options.StorageDirectory = value;
          break;
        case "public-url":
          publicUrl = value;
          break;
        case "max-upload":
          if (!TryParseBaseZeroInt64(value, out var maxUpload))
          {
            return ParseError(
                $"invalid value \"{value}\" for flag -max-upload: parse error");
          }

          options.MaxUploadBytes = maxUpload;
          break;
        case "rate-limit":
          if (!TryParseBaseZeroInt64(value, out var parsedRateLimit))
          {
            return ParseError(
                $"invalid value \"{value}\" for flag -rate-limit: parse error");
          }

          rateLimit = parsedRateLimit;
          break;
        case "s3-endpoint":
          options.S3Endpoint = value;
          break;
        case "s3-region":
          options.S3Region = value;
          break;
        case "s3-bucket":
          options.S3Bucket = value;
          break;
        case "s3-bucket-url":
          options.S3BucketUrl = value;
          break;
        case "s3-addressing":
          options.S3Addressing = value;
          break;
      }
    }

    options.AllowedOrigins = SplitOrigins(origins);
    options.PublicUrl = publicUrl == ""
      ? DefaultPublicUrl(options.ListenAddress)
      : publicUrl;
    options.RateLimitPerMinute = rateLimit ??
        (options.Auth == "ticket" ? DefaultTicketRateLimit : 0);

    if (!secretFromFlag)
    {
      options.Secret = getEnvironmentVariable("BLOK_SECRET") ?? "";
    }

    options.S3AccessKey = getEnvironmentVariable("BLOK_S3_ACCESS_KEY") ?? "";
    options.S3SecretKey = getEnvironmentVariable("BLOK_S3_SECRET_KEY") ?? "";

    return new HostParseResult(options, false, null, secretFromFlag);
  }

  private static HostParseResult ParseError(string error)
  {
    return new HostParseResult(null, false, error, false);
  }

  private static bool IsValueFlag(string name)
  {
    return name is
        "listen" or
        "auth" or
        "secret" or
        "allow-origin" or
        "storage-dir" or
        "public-url" or
        "max-upload" or
        "rate-limit" or
        "s3-endpoint" or
        "s3-region" or
        "s3-bucket" or
        "s3-bucket-url" or
        "s3-addressing";
  }

  private static bool TryParseBoolean(string value, out bool result)
  {
    switch (value)
    {
      case "1":
      case "t":
      case "T":
      case "TRUE":
      case "true":
      case "True":
        result = true;
        return true;
      case "0":
      case "f":
      case "F":
      case "FALSE":
      case "false":
      case "False":
        result = false;
        return true;
      default:
        result = false;
        return false;
    }
  }

  private static bool TryParseBaseZeroInt64(
      string value,
      out long result)
  {
    result = 0;

    if (value == "")
    {
      return false;
    }

    var index = 0;
    var negative = false;

    if (value[index] is '+' or '-')
    {
      negative = value[index] == '-';
      index++;

      if (index == value.Length)
      {
        return false;
      }
    }

    var numberBase = 10;
    var explicitPrefix = false;

    if (value[index] == '0')
    {
      numberBase = 8;

      if (index + 1 < value.Length)
      {
        numberBase = value[index + 1] switch
        {
          'b' or 'B' => 2,
          'o' or 'O' => 8,
          'x' or 'X' => 16,
          _ => numberBase,
        };
        explicitPrefix = value[index + 1] is
            'b' or 'B' or 'o' or 'O' or 'x' or 'X';

        if (explicitPrefix)
        {
          index += 2;
        }
      }
    }

    var digitsStart = index;
    var digitSeen = false;
    var previousUnderscore = false;
    var limit = negative ? 1UL << 63 : (ulong)long.MaxValue;
    ulong magnitude = 0;

    for (; index < value.Length; index++)
    {
      var character = value[index];

      if (character == '_')
      {
        var followsPrefix = explicitPrefix &&
            !digitSeen &&
            index == digitsStart;
        var nextDigit = index + 1 < value.Length
          ? DigitValue(value[index + 1])
          : -1;

        if ((!digitSeen && !followsPrefix) ||
            previousUnderscore ||
            nextDigit < 0 ||
            nextDigit >= numberBase)
        {
          return false;
        }

        previousUnderscore = true;
        continue;
      }

      var digit = DigitValue(character);

      if (digit < 0 || digit >= numberBase ||
          magnitude > (limit - (ulong)digit) / (ulong)numberBase)
      {
        return false;
      }

      magnitude = magnitude * (ulong)numberBase + (ulong)digit;
      digitSeen = true;
      previousUnderscore = false;
    }

    if (!digitSeen)
    {
      return false;
    }

    if (!negative)
    {
      result = (long)magnitude;
      return true;
    }

    result = magnitude == 1UL << 63
      ? long.MinValue
      : -(long)magnitude;
    return true;

    static int DigitValue(char character)
    {
      return character switch
      {
        >= '0' and <= '9' => character - '0',
        >= 'a' and <= 'z' => character - 'a' + 10,
        >= 'A' and <= 'Z' => character - 'A' + 10,
        _ => -1,
      };
    }
  }

  private static string[] SplitOrigins(string value)
  {
    return value.Split(',')
        .Select(origin => origin.Trim())
        .Where(origin => origin != "")
        .ToArray();
  }

  private static string DefaultPublicUrl(string listenAddress)
  {
    var (host, port) = SplitListenAddress(listenAddress);

    if (host is "" or "*" or "+" ||
        (IPAddress.TryParse(host, out var address) &&
         (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))))
    {
      host = "127.0.0.1";
    }

    var authority = host.Contains(':', StringComparison.Ordinal)
      ? $"[{host}]"
      : host;

    if (port != "")
    {
      authority += $":{port}";
    }

    return $"http://{authority}/files";
  }

  private static (string Host, string Port) SplitListenAddress(string listenAddress)
  {
    if (listenAddress.StartsWith('['))
    {
      var bracket = listenAddress.IndexOf(']');

      if (bracket >= 0)
      {
        var port = bracket + 1 < listenAddress.Length &&
            listenAddress[bracket + 1] == ':'
          ? listenAddress[(bracket + 2)..]
          : "";

        return (listenAddress[1..bracket], port);
      }
    }

    var firstColon = listenAddress.IndexOf(':');
    var lastColon = listenAddress.LastIndexOf(':');

    return firstColon >= 0 && firstColon == lastColon
      ? (listenAddress[..firstColon], listenAddress[(firstColon + 1)..])
      : (listenAddress.Trim('[', ']'), "");
  }
}
