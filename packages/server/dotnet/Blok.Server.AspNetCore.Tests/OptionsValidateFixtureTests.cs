using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/options-validate.json, which the
/// Go server reads too: each case sets some options and records what
/// <see cref="BlokServerOptions.Validate"/> refuses with, or the local public
/// path it resolves. C# is the reference, so this test recomputes every case;
/// run it with BLOK_WRITE_FIXTURES=1 to rewrite the answers after a deliberate
/// change.
/// </summary>
public sealed class OptionsValidateFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/options-validate.json";

  internal static string RepositoryRoot()
  {
    for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
    {
      if (File.Exists(Path.Combine(directory.FullName, "packages/server/dotnet/Blok.Server.slnx")))
      {
        return directory.FullName;
      }
    }

    throw new InvalidOperationException("repository root not found");
  }

  private static BlokServerOptions Build(JsonObject spec)
  {
    var options = new BlokServerOptions();

    foreach (var (name, value) in spec)
    {
      switch (name)
      {
        case "AllowedOrigins":
          options.AllowedOrigins = value!.AsArray().Select(item => item!.GetValue<string>()).ToList();
          break;
        case "RichTextFields":
          options.RichTextFields = value!.AsObject().ToDictionary(
              entry => entry.Key,
              entry => (IList<string>)entry.Value!.AsArray().Select(item => item!.GetValue<string>()).ToList());
          break;
        case "CollabKeepAliveIntervalMs":
          options.CollabKeepAliveInterval = TimeSpan.FromMilliseconds(value!.GetValue<long>());
          break;
        default:
          var property = typeof(BlokServerOptions).GetProperty(name) ??
              throw new InvalidOperationException($"no option {name}");
          property.SetValue(options, value.Deserialize(property.PropertyType));
          break;
      }
    }

    return options;
  }

  [Fact]
  public void ValidateAnswersMatchTheFixture()
  {
    var path = Path.Combine(RepositoryRoot(), RelativePath);
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var write = Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1";

    // Relative directories resolve against the working directory, as the Go
    // test's do: both run from the module or project directory, never "/".
    foreach (var entry in fixture["cases"]!.AsArray())
    {
      var options = Build(entry!["options"]!.AsObject());
      var error = "";

      try
      {
        options.Validate();
      }
      catch (InvalidOperationException exception)
      {
        error = exception.Message;
      }

      var publicPath = error == "" ? options.LocalPublicPath : "";

      if (write)
      {
        entry["error"] = error;
        entry["localPublicPath"] = publicPath;
        continue;
      }

      var name = entry["name"]!.GetValue<string>();
      Assert.True(entry["error"]?.GetValue<string>() == error, $"{name}: {error}");
      Assert.True(entry["localPublicPath"]?.GetValue<string>() == publicPath, $"{name}: {publicPath}");
    }

    if (write)
    {
      File.WriteAllText(
          path,
          fixture.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
    }
  }

  /// <summary>
  /// test/unit/server-conformance/fixtures/options-defaults.json holds every
  /// settable option of a new BlokServerOptions, named as the property. The
  /// Go DefaultOptions must match it.
  /// </summary>
  [Fact]
  public void DefaultsMatchTheFixture()
  {
    var defaults = new BlokServerOptions();
    var answer = new JsonObject();

    foreach (var property in typeof(BlokServerOptions).GetProperties()
                 .Where(property => property.CanWrite && property.SetMethod!.IsPublic)
                 .OrderBy(property => property.Name, StringComparer.Ordinal))
    {
      var value = property.GetValue(defaults);
      if (value is TimeSpan span)
      {
        answer[property.Name + "Ms"] = (long)span.TotalMilliseconds;
        continue;
      }

      answer[property.Name] = JsonSerializer.SerializeToNode(value, property.PropertyType);
    }

    var path = Path.Combine(RepositoryRoot(), "test/unit/server-conformance/fixtures/options-defaults.json");
    var text = answer.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1")
    {
      File.WriteAllText(path, text);
      return;
    }

    Assert.Equal(File.ReadAllText(path), text);
  }
}
