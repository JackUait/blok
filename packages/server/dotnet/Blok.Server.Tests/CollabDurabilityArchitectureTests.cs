using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Pins the operation store's durability calls, which no behavioural test can
/// see.
/// </summary>
/// <remarks>
/// <para>
/// A flushed write and an unflushed one are indistinguishable to every reader
/// on a machine with a page cache, including a freshly started process. Only
/// real power loss separates them. So deleting a flush leaves the whole suite
/// green while every acknowledgement built on it becomes a promise about bytes
/// that may never reach a disk. That was demonstrated, not assumed.
/// </para>
/// <para>
/// SCOPE, so nobody reads more into a green run than it says. These laws pin
/// that the calls are WRITTEN, in the right place and the right order. They do
/// not pin that the kernel honoured a flush, and they do not pin that a FAILED
/// flush aborts the acknowledgement — swallowing the rethrow in
/// <c>AppendAsync</c> passes every law here and every test in the suite.
/// </para>
/// </remarks>
public sealed class CollabDurabilityArchitectureTests
{
  private const string StorePath = "Blok.Server/Collab/LocalCollabOperationStore.cs";

  /// <summary>
  /// Every boundary where a completion means "durable". <c>AppendAsync</c> is
  /// the acknowledgement boundary; <c>Publish</c> is what makes a reset's
  /// lineage switch and a checkpoint's publication durable; <c>WriteSealed</c>
  /// covers the baseline and checkpoint bytes those publications name.
  /// </summary>
  private static readonly (string Method, string Handle)[] Boundaries =
  [
    ("AppendAsync", "journal"),
    ("Publish", "manifestFile"),
    ("WriteSealed", "file"),
  ];

  /// <summary>
  /// The only methods allowed to shorten a file, and whether the truncation
  /// must be fence-guarded. <c>OpenManifest</c> and <c>ResetAsync</c> size a
  /// file that nothing references yet, so there is no committed history to
  /// take; the other two can shorten a LIVE journal.
  /// </summary>
  private static readonly (string Method, bool NeedsFence)[] Truncations =
  [
    ("OpenManifest", false),
    ("ResetAsync", false),
    ("ScanForward", true),
    ("RollBack", true),
  ];

  [Fact]
  public void EveryDurabilityBoundaryFlushesToDisk()
  {
    var source = ReadStore();
    var violations = Boundaries
        .SelectMany(boundary => FindFlushViolations(source, boundary.Method, boundary.Handle))
        .ToList();

    Assert.True(
        violations.Count == 0,
        $"{StorePath} no longer flushes to stable storage at a boundary whose " +
        "completion means durable. Nothing else in the suite can catch this: " +
        "an unflushed write reads back exactly like a flushed one, so every " +
        "test stays green while an acknowledgement becomes a promise about " +
        "bytes no disk holds.\n" + string.Join("\n", violations));
  }

  [Fact]
  public void EveryTruncationOfALiveJournalConfirmsTheFenceFirst()
  {
    var source = ReadStore();
    var violations = FindTruncationViolations(source);

    Assert.True(
        violations.Count == 0,
        $"{StorePath} shortens a journal without re-checking the fence first. " +
        "SetLength is a BULK delete, and its offset is always decided before " +
        "the truncate: a session that lost the fence in between would cut away " +
        "every record the new holder acknowledged in that window, not just its " +
        "own. This cannot be driven deterministically in-process, so the guard " +
        "is pinned here instead.\n" + string.Join("\n", violations));
  }

  [Fact]
  public void DetectsAMissingFlush()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Seek(0, SeekOrigin.End);
            journal.Write(bytes);
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsTheNonDurableFlushOverload()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush();
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsAFlushThatDoesNotReachTheDisk()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush(flushToDisk: false);
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsAFlushOfSomeOtherHandle()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            manifestFile.Flush(flushToDisk: true);
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsAFlushThatRunsBeforeTheWrite()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Flush(flushToDisk: true);
            journal.Write(bytes);
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsAFlushStrandedInAnotherBlock()
  {
    Assert.Single(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);

            if (verbose)
            {
              journal.Flush(flushToDisk: true);
            }
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void AcceptsThePositionalFlushArgument()
  {
    Assert.Empty(FindFlushViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush(true);
          }
        }
        """,
        "AppendAsync",
        "journal"));
  }

  [Fact]
  public void DetectsATruncationWithNoFenceCheck()
  {
    Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void RollBack(long length)
          {
            journal.SetLength(length);
            journal.Flush(flushToDisk: true);
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFenceCheckThatRunsAfterTheTruncation()
  {
    Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void RollBack(long length)
          {
            journal.SetLength(length);
            RequireFence();
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFenceCheckStrandedInAnotherBlock()
  {
    Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void ScanForward()
          {
            if (guard)
            {
              RequireFence();
            }

            journal.SetLength(offset);
          }
        }
        """));
  }

  [Fact]
  public void DetectsATruncationInAMethodThatMayNotTruncate()
  {
    var violation = Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void WriteCheckpointAsync()
          {
            RequireFence();
            journal.SetLength(0);
          }
        }
        """));

    Assert.Contains("WriteCheckpointAsync", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void AcceptsAGuardedTruncation()
  {
    Assert.Empty(FindTruncationViolations(
        """
        class Session
        {
          void RollBack(long length)
          {
            RequireFence();
            journal.SetLength(length);
            journal.Flush(flushToDisk: true);
          }
        }
        """));
  }

  private static List<string> FindFlushViolations(
      string source,
      string method,
      string handle)
  {
    var violations = new List<string>();
    var scope = Method(source, method);

    if (scope is null)
    {
      violations.Add($"there is no single {method} to check.");

      return violations;
    }

    var write = CallOn(scope, handle, "Write").FirstOrDefault();

    if (write is null)
    {
      violations.Add($"{method} no longer writes to {handle}.");

      return violations;
    }

    var flushed = CallOn(scope, handle, "Flush").Any(flush =>
        FlushesToDisk(flush) &&
        Block(flush) is { } block &&
        block == Block(write) &&
        flush.SpanStart > write.SpanStart);

    if (!flushed)
    {
      violations.Add(
          $"{method} must call {handle}.Flush(flushToDisk: true) after its " +
          "write, in the same block.");
    }

    return violations;
  }

  private static List<string> FindTruncationViolations(string source)
  {
    var allowed = Truncations.ToDictionary(
        entry => entry.Method,
        entry => entry.NeedsFence,
        StringComparer.Ordinal);
    var violations = new List<string>();
    var root = Parse(source);

    foreach (var truncation in root.DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation => NameOf(invocation) == "SetLength"))
    {
      var owner = truncation.FirstAncestorOrSelf<MethodDeclarationSyntax>();
      var name = owner?.Identifier.ValueText ?? "<no method>";

      if (!allowed.TryGetValue(name, out var needsFence))
      {
        violations.Add(
            $"{name} shortens a file, which only " +
            $"{string.Join(", ", allowed.Keys)} may do.");

        continue;
      }

      if (!needsFence)
      {
        continue;
      }

      var guarded = Block(truncation) is { } block &&
          block.DescendantNodes()
              .OfType<InvocationExpressionSyntax>()
              .Any(call =>
                  NameOf(call)?.Contains("Fence", StringComparison.Ordinal) == true &&
                  Block(call) == block &&
                  call.SpanStart < truncation.SpanStart);

      if (!guarded)
      {
        violations.Add(
            $"{name} must confirm the fence in the same block, before its " +
            "SetLength.");
      }
    }

    return violations;
  }

  private static MethodDeclarationSyntax? Method(string source, string name)
  {
    return Parse(source)
        .DescendantNodes()
        .OfType<MethodDeclarationSyntax>()
        .SingleOrDefault(method => method.Identifier.ValueText == name);
  }

  private static SyntaxNode Parse(string source)
  {
    return CSharpSyntaxTree
        .ParseText(source, CSharpParseOptions.Default.WithLanguageVersion(LanguageVersion.Latest))
        .GetRoot();
  }

  private static IEnumerable<InvocationExpressionSyntax> CallOn(
      SyntaxNode scope,
      string receiver,
      string method)
  {
    return scope.DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation =>
            invocation.Expression is MemberAccessExpressionSyntax access &&
            access.Name.Identifier.ValueText == method &&
            Receiver(access.Expression) == receiver);
  }

  /// <summary>Sees through a null-forgiving <c>!</c> on the receiver.</summary>
  private static string? Receiver(ExpressionSyntax expression)
  {
    return expression switch
    {
      IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
      PostfixUnaryExpressionSyntax postfix => Receiver(postfix.Operand),
      _ => null,
    };
  }

  private static string? NameOf(InvocationExpressionSyntax invocation)
  {
    return invocation.Expression switch
    {
      SimpleNameSyntax simple => simple.Identifier.ValueText,
      MemberAccessExpressionSyntax access => access.Name.Identifier.ValueText,
      _ => null,
    };
  }

  private static bool FlushesToDisk(InvocationExpressionSyntax flush)
  {
    return flush.ArgumentList.Arguments is [{ } argument] &&
        argument.Expression.IsKind(SyntaxKind.TrueLiteralExpression) &&
        argument.NameColon?.Name.Identifier.ValueText is null or "flushToDisk";
  }

  private static BlockSyntax? Block(SyntaxNode node)
  {
    return node.FirstAncestorOrSelf<BlockSyntax>();
  }

  private static string ReadStore()
  {
    return File.ReadAllText(Path.Combine(
        FindDotnetRoot(),
        StorePath.Replace('/', Path.DirectorySeparatorChar)));
  }

  private static string FindDotnetRoot()
  {
    for (var current = new DirectoryInfo(AppContext.BaseDirectory);
         current is not null;
         current = current.Parent)
    {
      if (File.Exists(Path.Combine(current.FullName, "Blok.Server.slnx")))
      {
        return current.FullName;
      }
    }

    throw new DirectoryNotFoundException(
        "Could not locate the Blok.Server solution root.");
  }
}
