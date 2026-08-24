using Blok.Server.AspNetCore;
using Blok.Server.Host;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

var parsed = HostArguments.Parse(args, Environment.GetEnvironmentVariable);

if (parsed.HelpRequested)
{
  Console.Error.Write(HostArguments.Usage);
  return 0;
}

if (parsed.Error is not null)
{
  Console.Error.WriteLine(parsed.Error);
  Console.Error.Write(HostArguments.Usage);
  return 2;
}

var options = parsed.Options ??
    throw new InvalidOperationException("Parsed host options are missing");

try
{
  options.Validate();
}
catch (InvalidOperationException error)
{
  Console.Error.WriteLine($"blok-server refused to start: {error.Message}");
  return 1;
}

if (parsed.SecretFromFlag)
{
  Console.Error.WriteLine(
      "warning: --secret puts the shared secret in this machine's process list; " +
      "set BLOK_SECRET in the environment instead");
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
builder.Logging.ClearProviders();
builder.WebHost.UseUrls($"http://{options.ListenAddress}");
builder.Services.AddBlokServer(options);

var app = builder.Build();
app.MapBlokServer();

Console.Error.WriteLine(
    $"blok-server {options.Version} listening on {options.ListenAddress} (--auth {options.Auth})");

try
{
  await app.RunAsync();
  return 0;
}
catch (Exception error)
{
  Console.Error.WriteLine($"blok-server refused to start: {error.Message}");
  return 1;
}
