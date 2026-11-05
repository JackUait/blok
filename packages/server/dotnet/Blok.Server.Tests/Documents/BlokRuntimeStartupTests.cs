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

  /// <summary>
  /// Unset means the default; an explicit zero is a value under the floor.
  /// Go and Rust copy this with pointer and Option fields.
  /// </summary>
  [Theory]
  [InlineData("timeout")]
  [InlineData("allocationBudgetBytes")]
  public void RefusesAnExplicitZero(string parameter)
  {
    var refusal = Assert.Throws<ArgumentOutOfRangeException>(
        () => BlokDocuments.Create(
            poolSize: 1,
            timeout: parameter == "timeout" ? TimeSpan.Zero : null,
            allocationBudgetBytes: parameter == "allocationBudgetBytes" ? 0 : null));

    Assert.Equal(parameter, refusal.ParamName);
  }

  /// <summary>
  /// The exact refusal text. Go and Rust copy it word for word, so the
  /// TimeSpan format and the "Actual value was" line are pinned here.
  /// </summary>
  [Theory]
  [InlineData("create", "poolSize", "0", "poolSize ('0') must be greater than or equal to '1'. (Parameter 'poolSize')\nActual value was 0.")]
  [InlineData("create", "poolSize", "-1", "poolSize ('-1') must be greater than or equal to '1'. (Parameter 'poolSize')\nActual value was -1.")]
  [InlineData("create", "timeout", "0", "timeout ('00:00:00') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was 00:00:00.")]
  [InlineData("create", "timeout", "50", "timeout ('00:00:00.0500000') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was 00:00:00.0500000.")]
  [InlineData("create", "timeout", "-1000", "timeout ('-00:00:01') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was -00:00:01.")]
  [InlineData("create", "timeout", "-90061001.5", "timeout ('-1.01:01:01.0015000') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was -1.01:01:01.0015000.")]
  [InlineData("create", "allocationBudgetBytes", "0", "allocationBudgetBytes ('0') must be greater than or equal to '8388608'. (Parameter 'allocationBudgetBytes')\nActual value was 0.")]
  [InlineData("create", "allocationBudgetBytes", "-1", "allocationBudgetBytes ('-1') must be greater than or equal to '8388608'. (Parameter 'allocationBudgetBytes')\nActual value was -1.")]
  [InlineData("agent", "poolSize", "0", "poolSize ('0') must be greater than or equal to '1'. (Parameter 'poolSize')\nActual value was 0.")]
  [InlineData("agent", "timeout", "0", "timeout ('00:00:00') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was 00:00:00.")]
  [InlineData("agent", "allocationBudgetBytes", "0", "allocationBudgetBytes ('0') must be greater than or equal to '8388608'. (Parameter 'allocationBudgetBytes')\nActual value was 0.")]
  [InlineData("invoke", "timeout", "0", "timeout ('00:00:00') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was 00:00:00.")]
  [InlineData("invoke", "timeout", "99.9999", "timeout ('00:00:00.0999999') must be greater than or equal to '00:00:00.1000000'. (Parameter 'timeout')\nActual value was 00:00:00.0999999.")]
  public async Task RefusesALimitUnderItsFloorWithThisText(string entry, string parameter, string value, string want)
  {
    int? poolSize = parameter == "poolSize" ? int.Parse(value, CultureInfo.InvariantCulture) : 1;
    TimeSpan? timeout = parameter == "timeout"
      ? TimeSpan.FromTicks((long)(double.Parse(value, CultureInfo.InvariantCulture) * TimeSpan.TicksPerMillisecond))
      : null;
    long? budget = parameter == "allocationBudgetBytes" ? long.Parse(value, CultureInfo.InvariantCulture) : null;
    ArgumentOutOfRangeException refusal;
    if (entry == "invoke")
    {
      var runtime = JintBlokRuntime.FromEmbeddedResource(poolSize: 1);
      refusal = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
          async () => await runtime.InvokeAsync("version", "{}", timeout));
    }
    else
    {
      refusal = Assert.Throws<ArgumentOutOfRangeException>(() =>
      {
        _ = entry == "agent"
          ? (object)BlokDocuments.CreateAgentExecutor(poolSize, timeout, budget)
          : BlokDocuments.Create(poolSize, timeout, budget);
      });
    }

    Assert.Equal(want, refusal.Message);
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
