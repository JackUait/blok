using System.Reflection;
using System.Threading.Channels;
using Blok.Server.Documents;
using Jint;
using Jint.Native;
using Jint.Native.Object;
using Jint.Runtime;

namespace Blok.Server.Runtime;

internal sealed class JintBlokRuntime : IBlokRuntime
{
  private const string BundleResourceName = "Blok.Server.Runtime.blok-server-runtime.js";

  private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(10);

  /*
   * Jint counts every allocation a call makes, not what it still holds, so this
   * is churn per conversion rather than resident memory — a reader that builds
   * and discards a string a hundred times has spent it a hundred times over.
   * 512 MiB because it is the only value MEASURED to convert everything that
   * failed at 64 MiB: a 700 KB article with a third of its fields carrying
   * inline markup (all three readers), and a document holding one 32 MiB inline
   * base64 image, whose single materialized copy costs 64 MiB in UTF-16 on its
   * own. Nothing between the two was tried, so this is a value known to work
   * rather than a bisected minimum. Nothing is reserved, so a host that never
   * converts a large document pays nothing for the headroom.
   */
  private const long DefaultAllocationBudgetBytes = 512L * 1024 * 1024;

  /*
   * Floors for the two constraints a host may lower, enforced where a host
   * names them (`FromEmbeddedResource`, and `BlokDocuments.Create` through it)
   * rather than in this constructor, which the package's own tests drive with
   * deliberately starved engines.
   *
   * Both are set BELOW the smallest value measured to work, so the check can
   * never refuse a configuration that would have run:
   *
   * - 8 MiB: loading the 1.14.0 bundle allocates 8,406,648 bytes, so 8 MiB is
   *   measured to fail outright and 9 MiB is the smallest measured to load and
   *   convert. The count is the engine's own tally of a deterministic parse, so
   *   it does not vary by machine — only by bundle, and only upwards.
   * - 100 ms: loading was measured to fail at 300 ms and succeed at 350 ms on
   *   the development machine. This one IS machine-dependent, which is why the
   *   floor sits three and a half times under the measurement instead of at it:
   *   it is here to catch a host that passed milliseconds meaning seconds, not
   *   to publish a supported minimum.
   */
  internal const long MinimumAllocationBudgetBytes = 8L * 1024 * 1024;

  internal static readonly TimeSpan MinimumTimeout = TimeSpan.FromMilliseconds(100);

  private readonly string script;
  private readonly TimeSpan timeout;
  private readonly long allocationBudgetBytes;
  private readonly Channel<Engine> engines;

  internal JintBlokRuntime(
      string script,
      int poolSize,
      TimeSpan? timeout = null,
      long? allocationBudgetBytes = null)
  {
    ArgumentException.ThrowIfNullOrWhiteSpace(script);
    ArgumentOutOfRangeException.ThrowIfLessThan(poolSize, 1);

    if (allocationBudgetBytes is long budget)
    {
      ArgumentOutOfRangeException.ThrowIfLessThan(budget, 1);
    }

    this.script = script;
    this.timeout = timeout ?? DefaultTimeout;
    this.allocationBudgetBytes = allocationBudgetBytes ?? DefaultAllocationBudgetBytes;
    engines = Channel.CreateBounded<Engine>(new BoundedChannelOptions(poolSize)
    {
      FullMode = BoundedChannelFullMode.Wait,
      SingleReader = false,
      SingleWriter = false,
    });

    for (var index = 0; index < poolSize; index++)
    {
      Engine engine;

      /*
       * Loading the bundle runs under the same timeout and allocation budget a
       * conversion does, so a caller who lowers either too far fails here. The
       * engine's own exception types are withheld from consumers at compile
       * time, so naming one would name something they cannot catch.
       */
      try
      {
        engine = CreateEngine();
      }
      catch (MemoryLimitExceededException exception)
      {
        throw new BlokRuntimeStartupException(
            "Loading Blok's runtime bundle into an engine allocated more than the "
            + $"{this.allocationBudgetBytes}-byte allocation budget this runtime was created with. "
            + "Loading runs under the same allocation budget as a conversion, so raise "
            + $"`allocationBudgetBytes`: the default is {DefaultAllocationBudgetBytes} bytes (512 MiB), "
            + $"and {MinimumAllocationBudgetBytes} bytes is the floor this package accepts at all.",
            exception);
      }
      catch (TimeoutException exception)
      {
        throw new BlokRuntimeStartupException(
            $"Loading Blok's runtime bundle into an engine ran past the {this.timeout} timeout this "
            + "runtime was created with. Loading runs under the same timeout as a conversion, so "
            + $"raise `timeout`: the default is {DefaultTimeout}, and {MinimumTimeout} is the floor "
            + "this package accepts at all.",
            exception);
      }
      catch (Exception exception)
      {
        throw new BlokRuntimeStartupException(
            "Could not load Blok's runtime bundle into an engine.",
            exception);
      }

      if (!engines.Writer.TryWrite(engine))
      {
        throw new InvalidOperationException("Could not initialize the Blok runtime pool.");
      }
    }
  }

  /*
   * Checked here, before the bundle is even read, so a host that starved one of
   * the constraints learns it from the argument it passed rather than from an
   * engine failure a second later.
   */
  internal static void ValidateConstraints(TimeSpan? timeout, long? allocationBudgetBytes)
  {
    if (allocationBudgetBytes is long budget)
    {
      ArgumentOutOfRangeException.ThrowIfLessThan(
          budget, MinimumAllocationBudgetBytes, nameof(allocationBudgetBytes));
    }

    if (timeout is TimeSpan limit)
    {
      ArgumentOutOfRangeException.ThrowIfLessThan(limit, MinimumTimeout, nameof(timeout));
    }
  }

  internal static JintBlokRuntime FromEmbeddedResource(
      int? poolSize = null,
      TimeSpan? timeout = null,
      long? allocationBudgetBytes = null)
  {
    ValidateConstraints(timeout, allocationBudgetBytes);

    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BundleResourceName)
        ?? throw new InvalidOperationException($"Embedded resource '{BundleResourceName}' was not found.");
    using var reader = new StreamReader(stream);

    var resolvedPoolSize = poolSize
        ?? Math.Max(1, Math.Min(Environment.ProcessorCount, 4));

    return new JintBlokRuntime(reader.ReadToEnd(), resolvedPoolSize, timeout, allocationBudgetBytes);
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
    /*
     * NEVER wrapped: a caller's own cancellation has to stay cancellation, or
     * every `catch (OperationCanceledException)` upstream stops working.
     */
    catch (OperationCanceledException)
    {
      reusable = false;
      throw;
    }
    /*
     * Only what leaves an engine mid-execution is poison, which is why the two
     * constraint failures replace the engine and the JavaScript ones do not.
     * Runaway recursion is deliberately among the latter: the stack guard turns
     * it into an ordinary JavaScript error, so the engine finished normally and
     * goes straight back in the pool.
     */
    catch (TimeoutException exception)
    {
      reusable = false;
      throw new BlokDocumentConversionException(BlokConversionFailure.TimedOut, exception);
    }
    catch (MemoryLimitExceededException exception)
    {
      reusable = false;
      throw new BlokDocumentConversionException(BlokConversionFailure.DocumentTooLarge, exception);
    }
    /*
     * Two shapes for one thing. The bundle's entry point is `async`, so an error
     * thrown while reading the input rejects its promise and arrives as a
     * rejection; anything the engine raises outside that promise arrives as a
     * JavaScript exception. Both carry the same error value, and both are
     * classified from it.
     */
    catch (PromiseRejectedException exception)
    {
      throw new BlokDocumentConversionException(Classify(exception.RejectedValue), exception);
    }
    catch (JavaScriptException exception)
    {
      throw new BlokDocumentConversionException(Classify(exception.Error), exception);
    }
    /*
     * Whatever this is, it left an engine mid-execution, so the engine goes.
     */
    catch (Exception exception)
    {
      reusable = false;
      throw new BlokDocumentConversionException(BlokConversionFailure.Unknown, exception);
    }
    finally
    {
      /*
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

  /*
   * The runtime rejects input it cannot read by throwing a `TypeError`, and
   * `JSON.parse` rejects malformed JSON with a `SyntaxError`. Nothing else the
   * bundle raises is a statement about the input — the stack guard's own
   * `RangeError` included — so nothing else is reported as one.
   */
  private static BlokConversionFailure Classify(JsValue error)
  {
    var name = error is ObjectInstance instance ? instance.Get("name").ToString() : null;

    return name is "SyntaxError" or "TypeError"
        ? BlokConversionFailure.InvalidDocument
        : BlokConversionFailure.Unknown;
  }

  /*
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
        options.LimitMemory(allocationBudgetBytes);
        options.Constraints.StackOverflowGuard = true;
      })
      .Execute(script);
  }
}
