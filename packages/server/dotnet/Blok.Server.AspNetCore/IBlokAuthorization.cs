using System.Security.Claims;

namespace Blok.Server.AspNetCore;

public interface IBlokAuthorization
{
  ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default);

  ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default);
}
