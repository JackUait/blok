using System.Security.Claims;

namespace Blok.Server.AspNetCore;

internal sealed class DenyBlokAuthorization : IBlokAuthorization
{
  public ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default)
  {
    return ValueTask.FromResult(false);
  }

  public ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default)
  {
    return ValueTask.FromResult(false);
  }
}
