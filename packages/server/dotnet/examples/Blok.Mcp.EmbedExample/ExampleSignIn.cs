using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Blok.Mcp.EmbedExample;

/// <summary>
/// The host's sign-in, faked from headers. A real host uses its own scheme (cookies, JWT bearer);
/// Blok reads only the signed-in user's <c>sub</c> or <c>NameIdentifier</c>.
/// </summary>
internal sealed class ExampleSignIn(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  internal const string SchemeName = "example";

  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    var user = Request.Headers["X-Example-User"].ToString();
    var claims = new List<Claim>();

    if (user.Length > 0)
    {
      claims.Add(new Claim("sub", user));
      // Scope claims, which Blok ignores by default: the host owns auth.
      claims.AddRange(Request.Headers["X-Example-Scopes"].ToString()
          .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
          .Select(scope => new Claim("scope", scope)));
    }
    else if (Request.Headers["X-Example-Signed-In"] != "true")
    {
      return Task.FromResult(AuthenticateResult.NoResult());
    }

    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName)), SchemeName)));
  }
}
