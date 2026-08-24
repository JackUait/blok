using System.Reflection;
using System.Security.Cryptography;
using Blok.Server.AspNetCore;

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
builder.Services.AddBlokServer(options =>
{
  options.StorageDirectory = "";
  options.Version = "package-fixture";
});

var app = builder.Build();
app.MapBlokServer("/api/blok");
await app.RunAsync();
