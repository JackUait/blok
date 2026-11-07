using System.Net.Http.Headers;
using System.Text;

namespace Blok.Server.Mcp.Outbound;

internal sealed record McpHttpRequest(
    string Method,
    string Url,
    IReadOnlyList<KeyValuePair<string, string>> Headers,
    byte[]? Body = null,
    string? ContentType = null);

internal sealed record McpHttpResponse(int Status, string Body);

/// <summary>The call never got an answer: no connection, a timeout or a refused URL.</summary>
internal sealed class McpUnreachableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>The answer started but its body could not be read.</summary>
internal sealed class McpBodyException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// The one outbound HTTP owner of the MCP server: the endpoint source, the ticket
/// route, the authorize webhook and the JWKS. These go to hosts the operator names,
/// loopback included, so the guarded fetcher (which refuses loopback) cannot serve them.
/// Redirects are never followed: a followed redirect would carry a body and its
/// Authorization header to another route.
/// </summary>
internal sealed class McpHttpCaller : IDisposable
{
  private readonly HttpClient client;

  internal McpHttpCaller()
  {
    client = new HttpClient(CreateHandler(), disposeHandler: true)
    {
      // Each call has its own budget.
      Timeout = Timeout.InfiniteTimeSpan,
    };
  }

  internal async Task<McpHttpResponse> SendAsync(McpHttpRequest request, TimeSpan timeout, CancellationToken cancellationToken = default)
  {
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    deadline.CancelAfter(timeout);
    using var message = new HttpRequestMessage(new HttpMethod(request.Method), request.Url);

    foreach (var (name, value) in request.Headers)
    {
      // TryAddWithoutValidation puts CR and LF on the wire, so a value is checked here.
      message.Headers.TryAddWithoutValidation(name, HeaderValue(request, value));
    }
    if (request.Body is not null)
    {
      message.Content = new ByteArrayContent(request.Body);
      message.Content.Headers.ContentType = request.ContentType is null ? null : MediaTypeHeaderValue.Parse(request.ContentType);
    }

    HttpResponseMessage response;

    try
    {
      response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
    }
    catch (Exception error) when (error is HttpRequestException or OperationCanceledException or InvalidOperationException or UriFormatException or NotSupportedException)
    {
      throw new McpUnreachableException($"{request.Method} {request.Url} could not be reached.", error);
    }

    using (response)
    {
      try
      {
        var bytes = await response.Content.ReadAsByteArrayAsync(deadline.Token);

        return new McpHttpResponse((int)response.StatusCode, Encoding.UTF8.GetString(bytes));
      }
      catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
      {
        throw new McpBodyException($"{request.Method} {request.Url} dropped the connection while answering.", error);
      }
    }
  }

  /// <summary>
  /// A header value as undici (Node's fetch) takes it: leading and trailing tabs, spaces, CR and
  /// LF go; a CR, LF or NUL left inside, or a char past U+00FF, refuses the call before it is sent.
  /// </summary>
  private static string HeaderValue(McpHttpRequest request, string value)
  {
    var trimmed = value.Trim([' ', '\t', '\r', '\n']);

    if (trimmed.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0 || trimmed.Any(c => c > '\u00FF'))
    {
      throw new McpUnreachableException($"{request.Method} {request.Url} could not be reached.");
    }

    return trimmed;
  }

  public void Dispose()
  {
    client.Dispose();
  }

  private static SocketsHttpHandler CreateHandler()
  {
    return new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      UseCookies = false,
      UseProxy = false,
      PooledConnectionLifetime = TimeSpan.FromMinutes(5),
      // undici writes U+0080..U+00FF as one byte each; .NET refuses non-ASCII without this.
      RequestHeaderEncodingSelector = (_, _) => Encoding.Latin1,
    };
  }
}
