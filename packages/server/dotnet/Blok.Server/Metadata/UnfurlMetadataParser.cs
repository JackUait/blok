using System.Text;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace Blok.Server.Metadata;

internal static class UnfurlMetadataParser
{
  private const int MaximumOpenElementDepth = 512;
  private const string HtmlNamespace = "http://www.w3.org/1999/xhtml";

  internal static UnfurlMetadata Parse(
      byte[] body,
      string finalUrl)
  {
    ArgumentNullException.ThrowIfNull(body);
    ArgumentNullException.ThrowIfNull(finalUrl);

    var baseUrl = TryParseBaseUrl(finalUrl);
    var titleTag = "";
    var openGraphTitle = "";
    var twitterTitle = "";
    var openGraphDescription = "";
    var twitterDescription = "";
    var plainDescription = "";
    var openGraphImage = "";
    var twitterImage = "";
    var iconHref = "";
    var appleIconHref = "";

    try
    {
      var document = new HtmlParser().ParseDocument(
          Encoding.UTF8.GetString(body));
      var nodes = new Stack<(INode Node, int Depth)>();
      nodes.Push((document, 0));

      while (nodes.Count > 0)
      {
        var (node, depth) = nodes.Pop();
        if (node is IElement element)
        {
          if (depth > MaximumOpenElementDepth)
          {
            return Build(baseUrl);
          }

          switch (element.LocalName)
          {
            case "title" when element.NamespaceUri == HtmlNamespace:
              KeepFirst(
                  ref titleTag,
                  element.FirstChild?.TextContent);
              break;
            case "meta":
              var property = Attribute(element, "property");
              var name = Attribute(element, "name");
              var content = Attribute(element, "content");

              switch (property, name)
              {
                case ("og:title", _):
                  KeepFirst(ref openGraphTitle, content);
                  break;
                case (_, "twitter:title"):
                  KeepFirst(ref twitterTitle, content);
                  break;
                case ("og:description", _):
                  KeepFirst(ref openGraphDescription, content);
                  break;
                case (_, "twitter:description"):
                  KeepFirst(ref twitterDescription, content);
                  break;
                case (_, "description"):
                  KeepFirst(ref plainDescription, content);
                  break;
                case ("og:image", _):
                  KeepFirst(ref openGraphImage, content);
                  break;
                case (_, "twitter:image"):
                  KeepFirst(ref twitterImage, content);
                  break;
              }

              break;
            case "link":
              var href = Attribute(element, "href");
              if (href == "")
              {
                break;
              }

              foreach (var relation in Attribute(element, "rel")
                           .Split(
                               (char[]?)null,
                               StringSplitOptions.RemoveEmptyEntries))
              {
                var normalized = relation.ToLowerInvariant();
                if (normalized == "icon")
                {
                  KeepFirst(ref iconHref, href);
                }
                else if (normalized.StartsWith(
                    "apple-touch-icon",
                    StringComparison.Ordinal))
                {
                  KeepFirst(ref appleIconHref, href);
                }
              }

              break;
          }
        }

        for (var index = node.ChildNodes.Length - 1; index >= 0; index--)
        {
          nodes.Push((node.ChildNodes[index], depth + 1));
        }
      }
    }
    catch
    {
      return Build(baseUrl);
    }

    return Build(
        baseUrl,
        FirstNonEmpty(
            openGraphTitle,
            twitterTitle,
            titleTag),
        FirstNonEmpty(
            openGraphDescription,
            twitterDescription,
            plainDescription),
        FirstNonEmpty(
            openGraphImage,
            twitterImage),
        FirstNonEmpty(
            iconHref,
            appleIconHref));
  }

  private static UnfurlMetadata Build(
      Uri? baseUrl,
      string title = "",
      string description = "",
      string image = "",
      string favicon = "")
  {
    var domain = "";
    if (baseUrl is not null)
    {
      domain = baseUrl.IdnHost.ToLowerInvariant();
      if (domain.StartsWith("www.", StringComparison.Ordinal))
      {
        domain = domain[4..];
      }

      if (favicon == "")
      {
        favicon = "/favicon.ico";
      }
    }

    return new UnfurlMetadata(
        title,
        description,
        ResolveUrl(baseUrl, image),
        ResolveUrl(baseUrl, favicon),
        domain);
  }

  private static Uri? TryParseBaseUrl(string value)
  {
    return Uri.TryCreate(value, UriKind.Absolute, out var parsed) &&
        parsed.Host != ""
      ? parsed
      : null;
  }

  private static string Attribute(
      IElement element,
      string name)
  {
    return element.GetAttribute(name)?.Trim() ?? "";
  }

  private static void KeepFirst(
      ref string destination,
      string? value)
  {
    if (destination != "")
    {
      return;
    }

    destination = value?.Trim() ?? "";
  }

  private static string FirstNonEmpty(params string[] values)
  {
    return values.FirstOrDefault(value => value != "") ?? "";
  }

  private static string ResolveUrl(
      Uri? baseUrl,
      string reference)
  {
    if (reference == "")
    {
      return "";
    }

    Uri? resolved;
    var parsed = baseUrl is null
      ? Uri.TryCreate(reference, UriKind.Absolute, out resolved)
      : Uri.TryCreate(baseUrl, reference, out resolved);

    return parsed &&
        resolved is not null &&
        resolved.Host != "" &&
        (resolved.Scheme == Uri.UriSchemeHttp ||
         resolved.Scheme == Uri.UriSchemeHttps)
      ? resolved.AbsoluteUri
      : "";
  }
}
