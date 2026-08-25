using System.Reflection;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

const string RuntimeResource = "Blok.Server.Runtime.blok-server-runtime.js";
const string RuntimeHashEnvironmentVariable = "BLOK_EXPECTED_RUNTIME_SHA256";

var expectedRuntimeHash =
    Environment.GetEnvironmentVariable(RuntimeHashEnvironmentVariable) ??
    throw new InvalidOperationException(
        $"{RuntimeHashEnvironmentVariable} is required.");

var coreAssembly = Assembly.Load(new AssemblyName("Blok.Server"));
using var runtime = coreAssembly.GetManifestResourceStream(RuntimeResource) ??
    throw new InvalidOperationException(
        $"Missing manifest resource {RuntimeResource}.");
var actualRuntimeHash = Convert.ToHexString(SHA256.HashData(runtime));

if (!string.Equals(
      actualRuntimeHash,
      expectedRuntimeHash,
      StringComparison.OrdinalIgnoreCase))
{
  throw new InvalidOperationException(
      $"Embedded runtime hash {actualRuntimeHash} did not match {expectedRuntimeHash}.");
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
