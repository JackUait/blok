using System.Reflection;
using System.Threading.Channels;
using Jint;
using Jint.Runtime;

namespace Blok.Server.Runtime;

internal sealed class JintBlokRuntime : IBlokRuntime
{
  private const string BundleResourceName = "Blok.Server.Runtime.blok-server-runtime.js";

  private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(10);

  private readonly string script;
  private readonly TimeSpan timeout;
  private readonly Channel<Engine> engines;

  internal JintBlokRuntime(string script, int poolSize, TimeSpan? timeout = null)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(script);
    ArgumentOutOfRangeException.ThrowIfLessThan(poolSize, 1);

    this.script = script;
    this.timeout = timeout ?? DefaultTimeout;
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

  internal static JintBlokRuntime FromEmbeddedResource(int? poolSize = null, TimeSpan? timeout = null)
  {
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BundleResourceName)
        ?? throw new InvalidOperationException($"Embedded resource '{BundleResourceName}' was not found.");
    using var reader = new StreamReader(stream);

    var resolvedPoolSize = poolSize
        ?? Math.Max(1, Math.Min(Environment.ProcessorCount, 4));

    return new JintBlokRuntime(reader.ReadToEnd(), resolvedPoolSize, timeout);
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
    /**
     * Only what leaves an engine mid-execution is poison. Runaway recursion is
     * deliberately absent: the stack guard turns it into an ordinary JavaScript
     * error, so the engine finished normally and goes straight back in the pool.
     */
    catch (Exception exception) when (exception is OperationCanceledException
        or TimeoutException
        or MemoryLimitExceededException)
    {
      reusable = false;
      throw;
    }
    finally
    {
      /**
       * The pool is fixed size, so a slot that is not refilled is gone for
       * good and the pool eventually blocks forever. Building the replacement
       * can itself fail — the bundle load is bounded by the same timeout — so
       * a failure here puts the spent engine back rather than losing the slot,
       * and never throws over whatever brought us into this block.
       */
      Engine returnedEngine;

      try
      {
        returnedEngine = reusable ? engine : CreateEngine();
      }
      catch (Exception)
      {
        returnedEngine = engine;
      }

      returned = engines.Writer.TryWrite(returnedEngine);
    }

    if (!returned)
    {
      throw new InvalidOperationException("Could not return an engine to the Blok runtime pool.");
    }

    return result;
  }

  /**
   * `StackOverflowGuard` rather than a recursion limit, for the same reason the
   * limit was there: an uncatchable .NET StackOverflowException kills the whole
   * process. The guard measures the remaining native stack instead of counting
   * one function definition's frames, so it keeps that protection while letting
   * an ordinary deeply indented outline through — the readers recurse once per
   * nesting level, and a frame count cannot tell those two apart.
   */
  private Engine CreateEngine()
  {
    return new Engine(options =>
      {
        options.TimeoutInterval(timeout);
        options.LimitMemory(64 * 1024 * 1024);
        options.Constraints.StackOverflowGuard = true;
      })
      .Execute(script);
  }
}
