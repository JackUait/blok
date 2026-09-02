using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

const string RemovedRuntimeResource = "Blok.Server.Runtime.blok-server-runtime.js";

var coreAssembly = Assembly.Load(new AssemblyName("Blok.Server"));

if (Array.Exists(
      coreAssembly.GetManifestResourceNames(),
      name => string.Equals(name, RemovedRuntimeResource, StringComparison.Ordinal)))
{
  throw new InvalidOperationException(
      $"Unused runtime resource {RemovedRuntimeResource} is still packaged.");
}

// The engine is managed, so a consumer restores no native package at all.
if (Array.Exists(
      coreAssembly.GetReferencedAssemblies(),
      reference => reference.Name?.StartsWith("YDotNet", StringComparison.Ordinal) == true))
{
  throw new InvalidOperationException("Blok.Server still references a YDotNet assembly.");
}

var builder = WebApplication.CreateBuilder(args);
builder.Services
    .AddAuthentication("package-fixture")
    .AddScheme<AuthenticationSchemeOptions, HeaderAuthenticationHandler>(
        "package-fixture",
        _ => { });
builder.Services.AddAuthorization();
builder.Services.AddBlokServer(options =>
{
  options.AllowedOrigins = ["https://app.example.test"];
  options.UnfurlDisabled = false;
  options.Version = "package-fixture";
});

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapBlokServer("/api/blok").RequireAuthorization();
await app.RunAsync();

sealed class HeaderAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(
        options,
        logger,
        encoder)
{
  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    if (!Request.Headers.ContainsKey("X-Test-User"))
    {
      return Task.FromResult(AuthenticateResult.NoResult());
    }

    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, "signed-in")],
        Scheme.Name);
    var ticket = new AuthenticationTicket(
        new ClaimsPrincipal(identity),
        Scheme.Name);

    return Task.FromResult(AuthenticateResult.Success(ticket));
  }
}
