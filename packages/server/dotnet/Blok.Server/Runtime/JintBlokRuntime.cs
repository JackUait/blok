using System.Reflection;
using System.Threading.Channels;
using Jint;

namespace Blok.Server.Runtime;

internal sealed class JintBlokRuntime : IBlokRuntime
{
  private const string BundleResourceName = "Blok.Server.Runtime.blok-server-runtime.js";

  private readonly string script;
  private readonly Channel<Engine> engines;

  internal JintBlokRuntime(string script, int poolSize)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(script);
    ArgumentOutOfRangeException.ThrowIfLessThan(poolSize, 1);

    this.script = script;
    engines = Channel.CreateBounded<Engine>(new BoundedChannelOptions(poolSize)
    {
      FullMode = BoundedChannelFullMode.Wait,
      SingleReader = false,
      SingleWriter = false,
    });

    for (var index = 0; index < poolSize; index++)
    {
      if (!engines.Writer.TryWrite(CreateEngine()))
      {
        throw new InvalidOperationException("Could not initialize the Blok runtime pool.");
      }
    }
  }

  internal static JintBlokRuntime FromEmbeddedResource(int? poolSize = null)
  {
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BundleResourceName)
        ?? throw new InvalidOperationException($"Embedded resource '{BundleResourceName}' was not found.");
    using var reader = new StreamReader(stream);

    var resolvedPoolSize = poolSize
        ?? Math.Max(1, Math.Min(Environment.ProcessorCount, 4));

    return new JintBlokRuntime(reader.ReadToEnd(), resolvedPoolSize);
  }

  public async ValueTask<string> InvokeAsync(
      string operation,
      string inputJson,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(operation);
    ArgumentNullException.ThrowIfNull(inputJson);

    var engine = await engines.Reader.ReadAsync(cancellationToken);
    var reusable = true;
    var returned = false;
    string result;

    try
    {
      result = (await engine.InvokeAsync(
          "blokServerInvoke",
          cancellationToken,
          operation,
          inputJson)).AsString();
    }
    catch (OperationCanceledException)
    {
      reusable = false;
      throw;
    }
    finally
    {
      var returnedEngine = reusable ? engine : CreateEngine();

      returned = engines.Writer.TryWrite(returnedEngine);
    }

    if (!returned)
    {
      throw new InvalidOperationException("Could not return an engine to the Blok runtime pool.");
    }

    return result;
  }

  private Engine CreateEngine()
  {
    return new Engine().Execute(script);
  }
}
