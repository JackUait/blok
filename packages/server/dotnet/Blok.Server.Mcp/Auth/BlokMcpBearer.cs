using System.Security.Claims;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.IdentityModel.Tokens;

namespace Blok.Server.Mcp.Auth;

/// <summary>
/// OAuth on ASP.NET Core's JwtBearer: the token handler is Blok's own verifier, and the
/// challenge and forbid answers are the ones Node's SDK (requireBearerAuth) sends.
/// </summary>
internal static class BlokMcpBearer
{
  internal const string Scheme = "BlokMcpBearer";
  internal const string ReadPolicy = "blok.read";
  internal const string PrincipalClaim = "blok:principal";
  internal const string ScopeClaim = "blok:scope";

  internal static void Configure(JwtBearerOptions options, AccessTokenVerifier verifier, McpOAuth oauth)
  {
    var metadata = new Uri(new Uri(oauth.Audience), "/.well-known/oauth-protected-resource").AbsoluteUri;

    options.TokenHandlers.Clear();
    options.TokenHandlers.Add(new Handler(verifier));
    options.MapInboundClaims = false;
    options.Events = new JwtBearerEvents
    {
      OnChallenge = async context =>
      {
        context.HandleResponse();
        var description = Description(context.Request.Headers.Authorization.ToString(), context.Request.Headers.Authorization.Count > 0, context.AuthenticateFailure);

        await WriteAsync(context.Response, StatusCodes.Status401Unauthorized, "invalid_token", description, metadata);
      },
      OnForbidden = context => WriteAsync(context.Response, StatusCodes.Status403Forbidden, "insufficient_scope", "Insufficient scope", metadata),
    };
  }

  /// <summary>The principal and scopes a Blok bearer token named, if one did.</summary>
  internal static (string Principal, IReadOnlyList<string> Scopes)? Identity(ClaimsPrincipal? user)
  {
    var principal = user?.FindFirst(PrincipalClaim)?.Value;

    return principal is null ? null : (principal, user!.FindAll(ScopeClaim).Select(claim => claim.Value).ToArray());
  }

  private static string Description(string header, bool present, Exception? failure)
  {
    if (!present)
    {
      return "Missing Authorization header";
    }
    var parts = header.Split(' ');

    if (!string.Equals(parts[0], "bearer", StringComparison.OrdinalIgnoreCase) || parts.Length < 2 || parts[1].Length == 0)
    {
      return "Invalid Authorization header format, expected 'Bearer TOKEN'";
    }

    return failure?.Message ?? "Invalid token";
  }

  private static async Task WriteAsync(HttpResponse response, int status, string error, string description, string metadata)
  {
    response.StatusCode = status;
    response.Headers.WWWAuthenticate = $"Bearer error=\"{error}\", error_description=\"{description}\", scope=\"{ReadPolicy}\", resource_metadata=\"{metadata}\"";
    response.ContentType = "application/json";
    await response.WriteAsync(McpJson.Write(new JsonObject { ["error"] = error, ["error_description"] = description }));
  }

  private sealed class Handler(AccessTokenVerifier verifier) : TokenHandler
  {
    public override async Task<TokenValidationResult> ValidateTokenAsync(string token, TokenValidationParameters validationParameters)
    {
      try
      {
        var verified = await verifier.VerifyAsync(token, CancellationToken.None);
        var claims = new List<Claim> { new(PrincipalClaim, verified.Principal) };

        claims.AddRange(verified.Scopes.Select(scope => new Claim(ScopeClaim, scope)));

        // JwtBearer accepts a result only when it carries the token too.
        return new TokenValidationResult
        {
          IsValid = true,
          ClaimsIdentity = new ClaimsIdentity(claims, Scheme),
          SecurityToken = new Microsoft.IdentityModel.JsonWebTokens.JsonWebToken(token),
        };
      }
      catch (AccessTokenException refused)
      {
        return new TokenValidationResult { IsValid = false, Exception = new SecurityTokenValidationException(refused.Message) };
      }
    }
  }
}
