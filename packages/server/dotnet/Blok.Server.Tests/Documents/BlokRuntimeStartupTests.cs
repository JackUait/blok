using System.Globalization;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Building a converter is a public entry point, so its failures are Blok's own
/// — a host must never have to name the engine package's exception types to
/// understand why its process would not start.
/// </summary>
public sealed class BlokRuntimeStartupTests
{
  /// <summary>
  /// A budget under the floor cannot load the bundle under ANY document, so it
  /// is refused while the argument is still in hand rather than a second later
  /// inside the engine.
  /// </summary>
  [Fact]
  public void RefusesAnAllocationBudgetTooSmallToLoadTheBundle()
  {
    var refusal = Assert.Throws<ArgumentOutOfRangeException>(
        () => BlokDocuments.Create(poolSize: 1, allocationBudgetBytes: 1 * 1024 * 1024));

    Assert.Equal("allocationBudgetBytes", refusal.ParamName);
    Assert.Contains(BlokDocuments.MinimumAllocationBudgetBytes.ToString(CultureInfo.InvariantCulture), refusal.Message, StringComparison.Ordinal);
  }

  /// <summary>A timeout under the floor is refused the same way.</summary>
  [Fact]
  public void RefusesATimeoutTooShortToLoadTheBundle()
  {
    var refusal = Assert.Throws<ArgumentOutOfRangeException>(
        () => BlokDocuments.Create(poolSize: 1, timeout: TimeSpan.FromMilliseconds(5)));

    Assert.Equal("timeout", refusal.ParamName);
  }

  /// <summary>The floors are published so a host can name them instead of guessing.</summary>
  [Fact]
  public void PublishesTheFloorsItEnforces()
  {
    Assert.True(BlokDocuments.MinimumAllocationBudgetBytes > 0);
    Assert.True(BlokDocuments.MinimumTimeout > TimeSpan.Zero);
  }

  /// <summary>
  /// The budget can still be exhausted above the floor — a later bundle is
  /// larger. That failure is Blok's own exception, and it says which knob to
  /// turn.
  /// </summary>
  [Fact]
  public void ReportsAnExhaustedLoadBudgetAsBloksOwnException()
  {
    var greedy = "var s = ''; for (var i = 0; i < 2000000; i++) { s += 'xxxxxxxxxx'; }";

    var failure = Assert.Throws<BlokRuntimeStartupException>(
        () => new JintBlokRuntime(greedy, poolSize: 1, allocationBudgetBytes: 2L * 1024 * 1024));

    Assert.Contains("allocation budget", failure.Message, StringComparison.OrdinalIgnoreCase);
    Assert.NotNull(failure.InnerException);
  }

  /// <summary>A load that runs long says so, and names the timeout instead.</summary>
  [Fact]
  public void ReportsALoadThatRunsPastTheTimeoutAsBloksOwnException()
  {
    var endless = "var n = 0; while (true) { n += 1; }";

    var failure = Assert.Throws<BlokRuntimeStartupException>(
        () => new JintBlokRuntime(endless, poolSize: 1, timeout: TimeSpan.FromMilliseconds(50)));

    Assert.Contains("timeout", failure.Message, StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// It stays an <see cref="InvalidOperationException"/>: that is what this
  /// threw before it had a type of its own, and a host already catching it must
  /// keep working.
  /// </summary>
  [Fact]
  public void KeepsTheExceptionTypeCallersAlreadyCatch()
  {
    var broken = "throw new Error('no bundle here');";

    Assert.Throws<BlokRuntimeStartupException>(() => new JintBlokRuntime(broken, poolSize: 1));
    Assert.True(typeof(InvalidOperationException).IsAssignableFrom(typeof(BlokRuntimeStartupException)));
  }
}
