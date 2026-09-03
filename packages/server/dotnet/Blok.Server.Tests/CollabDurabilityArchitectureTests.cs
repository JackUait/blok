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
  /// Every boundary where a completion means "durable", as
  /// (method, handle, the call the flush must follow).
  /// </summary>
  private static readonly (string Method, string Handle, string After)[] Boundaries =
  [
    ("AppendAsync", "journal", "Write"),
    ("Publish", "manifestFile", "Write"),
    ("WriteSealed", "file", "Write"),
    ("ResetAsync", "swapped", "SetLength"),
  ];

  /// <summary>
  /// Publication orders: each method must call these in this order. The flush
  /// law checks a method's BODY, which cannot see whether anyone calls it —
  /// deleting a <c>SyncDirectory</c> call site was green across every law and
  /// every test, and a missing directory fsync is invisible without real power
  /// loss, which is the exact failure those laws exist to catch.
  /// </summary>
  /// <remarks>
  /// THIS IS A SOURCE-ORDER PRESENCE LAW, NOT AN EXECUTION-ORDER ONE. It cannot
  /// require the steps to sit on one control-flow path, to be unconditional, to
  /// take the arguments they should, or that no early return sits between them:
  /// <c>WriteSealed(…); if (fastPath) return; SyncDirectory(d); Republish(n);</c>
  /// is green while the acknowledged path never syncs. It closes what it was
  /// asked to close — a deleted call site — and nothing beyond that.
  /// </remarks>
  private static readonly (string Method, string[] InOrder)[] PublicationOrders =
  [
    ("WriteCheckpointAsync", ["WriteSealed", "SyncDirectory", "Republish"]),
    ("ResetAsync", ["WriteSealed", "SyncDirectory", "Republish"]),
  ];

  /// <summary>
  /// Every method allowed to SHORTEN a file, and whether its truncation must be
  /// fence-guarded.
  /// </summary>
  /// <remarks>
  /// <para>
  /// EVERY EXEMPTION MUST STATE A REASON, AND WHAT IS MECHANICALLY CHECKABLE IN
  /// IT MUST BE CHECKED. This list is where this law has already failed twice:
  /// <c>ResetAsync</c> sat here as <c>NeedsFence: false</c> under "nothing
  /// references it yet", which was false — it truncated a journal a new holder
  /// had published and acknowledged operations into; and <c>TryDelete</c>'s
  /// reason rested on it having exactly one caller, which nothing verified.
  /// </para>
  /// <para>
  /// So: <see cref="EveryExemptionCarriesAReason"/> fails an exempt entry with
  /// no reason at all, and <see cref="TheOnlyDeleterHasOneScopedCallSite"/>
  /// pins the half of <c>TryDelete</c>'s reason a second call site would break.
  /// What stays prose — that the sweep's own filter is correct — is read, not
  /// checked, and the store's tests cover it instead.
  /// </para>
  /// </remarks>
  private static readonly (string Method, bool NeedsFence, string Reason)[] Shortenings =
  [
    (
      "OpenManifest",
      false,
      "Only ever GROWS, and only a manifest that is short of its two slots: " +
      "the call sits behind a length comparison, and a manifest has no " +
      "committed history in it to lose."),
    (
      "TryDelete",
      false,
      "The only File.Delete in the store. It has exactly one call site — pinned " +
      "by TheOnlyDeleterHasOneScopedCallSite, because a second, unscoped one " +
      "would leave every law here green — and that caller sweeps only names " +
      "ending in its own fence, so a session collects nothing but its own " +
      "superseded checkpoints."),
    (
      "WriteSealed",
      false,
      "FileMode.Create can only truncate a name THIS session already " +
      "abandoned, because every baseline and checkpoint name carries the " +
      "fence of the session that wrote it and two holders never share a fence."),
    ("ResetAsync", true, ""),
    ("ScanForward", true, ""),
    ("RollBack", true, ""),
  ];

  [Fact]
  public void EveryDurabilityBoundaryFlushesToDisk()
  {
    var source = ReadStore();
    var violations = Boundaries
        .SelectMany(boundary =>
            FindFlushViolations(source, boundary.Method, boundary.Handle, boundary.After))
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
  public void TheDirectorySyncChecksItsResult()
  {
    var violations = FindDirectorySyncViolations(ReadStore());

    Assert.True(
        violations.Count == 0,
        $"{StorePath} stopped checking its directory sync.\n" +
        string.Join("\n", violations));
  }

  [Fact]
  public void EveryPublicationCallsItsDurableStepsInOrder()
  {
    var source = ReadStore();
    var violations = PublicationOrders
        .SelectMany(order => FindOrderViolations(source, order.Method, order.InOrder))
        .ToList();

    Assert.True(
        violations.Count == 0,
        $"{StorePath} no longer performs a publication's durable steps, or " +
        "performs them out of order. A publication that names a file whose " +
        "directory entry was never synced is an acknowledgement of something a " +
        "power cut discards.\n" + string.Join("\n", violations));
  }

  [Fact]
  public void DetectsAMissingDurableStep()
  {
    var violation = Assert.Single(FindOrderViolations(
        """
        class Session
        {
          void ResetAsync()
          {
            WriteSealed(path, magic, 0, bytes);
            Republish(next);
          }
        }
        """,
        "ResetAsync",
        ["WriteSealed", "SyncDirectory", "Republish"]));

    Assert.Contains("SyncDirectory", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsDurableStepsOutOfOrder()
  {
    Assert.Single(FindOrderViolations(
        """
        class Session
        {
          void ResetAsync()
          {
            WriteSealed(path, magic, 0, bytes);
            Republish(next);
            SyncDirectory(docDirectory);
          }
        }
        """,
        "ResetAsync",
        ["WriteSealed", "SyncDirectory", "Republish"]));
  }

  [Fact]
  public void DetectsADeleteInAMethodThatMayNotDestroyData()
  {
    var violation = Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void WriteCheckpointAsync()
          {
            File.Delete(stale);
          }
        }
        """));

    Assert.Contains("WriteCheckpointAsync", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void TheOnlyDeleterHasOneScopedCallSite()
  {
    var source = ReadStore();
    var callers = Parse(source)
        .DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation => NameOf(invocation) == "TryDelete")
        .Select(invocation =>
            invocation.FirstAncestorOrSelf<MethodDeclarationSyntax>()?.Identifier.ValueText
            ?? "<no method>")
        .ToList();

    // TryDelete is exempt from the fence guard BECAUSE of who calls it. A
    // second call site would make that reason false while every law here — and
    // every test — stayed green, which is exactly how the last two holes in
    // this list survived.
    Assert.Equal(["WriteCheckpointAsync"], callers);
  }

  [Fact]
  public void DetectsAnUnguardedDeleteInAFenceRequiringMethod()
  {
    var violation = Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void ResetAsync()
          {
            File.Delete(BaselinePath(dir, generation, fence));
            RequireFence();
          }
        }
        """));

    Assert.Contains("Delete", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void AcceptsAGuardedDelete()
  {
    Assert.Empty(FindTruncationViolations(
        """
        class Session
        {
          void ResetAsync()
          {
            RequireFence();
            File.Delete(BaselinePath(dir, generation, fence));
          }
        }
        """));
  }

  [Fact]
  public void EveryExemptionCarriesAReason()
  {
    var undocumented = Shortenings
        .Where(entry => !entry.NeedsFence && string.IsNullOrWhiteSpace(entry.Reason))
        .Select(entry => entry.Method)
        .ToList();

    Assert.True(
        undocumented.Count == 0,
        "Every method exempted from the fence guard must say WHY in one " +
        "sentence. ResetAsync was once exempt under a reason that was simply " +
        "untrue, and an unexplained exemption is where the next one hides: " +
        string.Join(", ", undocumented));
  }

  [Fact]
  public void DetectsADiscardedDirectorySyncResult()
  {
    Assert.Single(FindDirectorySyncViolations(
        """
        class Store
        {
          static void SyncDirectory(string path)
          {
            var descriptor = Open(path, 0);
            _ = Fsync(descriptor);
            Close(descriptor);
          }
        }
        """));
  }

  [Fact]
  public void DetectsADirectorySyncThatTestsButDoesNotThrow()
  {
    Assert.Single(FindDirectorySyncViolations(
        """
        class Store
        {
          static void SyncDirectory(string path)
          {
            if (Fsync(descriptor) != 0)
            {
              log("could not flush");
            }
          }
        }
        """));
  }

  [Fact]
  public void DetectsATruncatingFileModeInAMethodThatMayNotShorten()
  {
    var violation = Assert.Single(FindTruncationViolations(
        """
        class Store
        {
          static void PublishSomething(string path)
          {
            using var file = new FileStream(path, FileMode.Create);
          }
        }
        """));

    Assert.Contains("PublishSomething", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void IgnoresATruncatingFileModeThatIsOnlyTested()
  {
    Assert.Empty(FindTruncationViolations(
        """
        class Store
        {
          static bool CanCreate(FileMode mode)
          {
            return mode is FileMode.CreateNew or FileMode.Create;
          }
        }
        """));
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
  public void DetectsAFenceCheckThatIsNotTheStatementBefore()
  {
    Assert.Single(FindTruncationViolations(
        """
        class Session
        {
          void RollBack(long length)
          {
            RequireFence();
            log("about to roll back");
            journal.SetLength(length);
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
      string handle,
      string after = "Write")
  {
    var violations = new List<string>();
    var methods = Methods(source, method);

    if (methods.Count != 1)
    {
      violations.Add(
          $"there is no single {method} to check ({methods.Count} found).");

      return violations;
    }

    var scope = methods[0];
    var write = CallOn(scope, handle, after).FirstOrDefault();

    if (write is null)
    {
      violations.Add($"{method} no longer calls {handle}.{after}.");

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
          $"{handle}.{after}, in the same block.");
    }

    return violations;
  }

  private static List<string> FindTruncationViolations(string source)
  {
    var allowed = Shortenings.ToDictionary(
        entry => entry.Method,
        entry => entry.NeedsFence,
        StringComparer.Ordinal);
    var violations = new List<string>();
    var root = Parse(source);

    // SetLength is not the only way to destroy data: FileMode.Create and
    // FileMode.Truncate discard whatever the name already held, which is how
    // WriteSealed replaces a baseline, and File.Delete takes the whole file.
    var shortenings = root.DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation => NameOf(invocation) is "SetLength" or "Delete")
        .Select(invocation => (
            Node: (SyntaxNode)invocation,
            Operation: NameOf(invocation)!,

            // A call site is somewhere a fence check can stand.
            Guardable: true))
        .Concat(root.DescendantNodes()
            .OfType<MemberAccessExpressionSyntax>()
            .Where(access =>
                access.Expression is IdentifierNameSyntax { Identifier.ValueText: "FileMode" } &&
                access.Name.Identifier.ValueText is "Create" or "Truncate" &&

                // A pattern TESTS a mode, it does not open anything with it.
                access.FirstAncestorOrSelf<PatternSyntax>() is null)
            .Select(access => (
                Node: (SyntaxNode)access,
                Operation: $"FileMode.{access.Name.Identifier.ValueText}",
                Guardable: false)));

    foreach (var (node, operation, guardable) in shortenings)
    {
      var owner = node.FirstAncestorOrSelf<MethodDeclarationSyntax>();
      var name = owner?.Identifier.ValueText ?? "<no method>";

      if (!allowed.TryGetValue(name, out var needsFence))
      {
        violations.Add(
            $"{name} destroys data ({operation}), which only " +
            $"{string.Join(", ", allowed.Keys)} may do.");

        continue;
      }

      // A FileMode is an ARGUMENT, not a call site: what makes those safe is
      // the name it opens, and there is nowhere in front of it for a check to
      // stand. Every actual operation — SetLength and Delete alike — must be
      // guarded in a method that needs the fence. Delete was once excluded here
      // along with the FileModes, which left an unguarded delete of the live
      // published baseline legal inside ResetAsync.
      if (!needsFence || !guardable)
      {
        continue;
      }

      // IMMEDIATELY before, not merely somewhere earlier in the block. A
      // method's entry check sits in that block too, and "the fence held when
      // this method started" is exactly the check-then-act that a stall
      // invalidates — the reason ResetAsync's collision had to be removed by
      // naming rather than narrowed by a guard. All three real call sites put
      // the confirmation on the preceding line, so nothing is lost by saying so.
      var statement = node.FirstAncestorOrSelf<StatementSyntax>();
      var block = statement?.Parent as BlockSyntax;
      var index = statement is null || block is null
        ? -1
        : block.Statements.IndexOf(statement);
      // And the confirmation must BE that statement, not merely sit somewhere
      // inside it: a fence check tucked into a conditional is one the operation
      // can be reached without.
      var guarded = index > 0 &&
          block!.Statements[index - 1] is ExpressionStatementSyntax
          {
            Expression: InvocationExpressionSyntax confirmation,
          } &&
          NameOf(confirmation)?.Contains("Fence", StringComparison.Ordinal) == true;

      if (!guarded)
      {
        violations.Add(
            $"{name} must confirm the fence in the statement immediately " +
            $"before its {operation}.");
      }
    }

    return violations;
  }

  private static List<string> FindOrderViolations(
      string source,
      string method,
      string[] inOrder)
  {
    var violations = new List<string>();
    var methods = Methods(source, method);

    if (methods.Count != 1)
    {
      violations.Add(
          $"there is no single {method} to check ({methods.Count} found).");

      return violations;
    }

    var calls = methods[0].DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .ToList();
    var previous = -1;

    foreach (var step in inOrder)
    {
      var call = calls.FirstOrDefault(candidate =>
          NameOf(candidate) == step && candidate.SpanStart > previous);

      if (call is null)
      {
        violations.Add(
            $"{method} must call {string.Join(" then ", inOrder)}; " +
            $"{step} is missing or out of order.");

        return violations;
      }

      previous = call.SpanStart;
    }

    return violations;
  }

  /// <summary>
  /// SyncDirectory is the third durability boundary and the only one that is
  /// not a FileStream flush, so the shape above cannot see it. What matters is
  /// that the fsync result is TESTED: the working-set store next door discards
  /// it deliberately, which is right for a best-effort projection write and
  /// exactly wrong here, where a checkpoint or a reset acknowledges on it.
  /// </summary>
  private static List<string> FindDirectorySyncViolations(string source)
  {
    var violations = new List<string>();
    var methods = Methods(source, "SyncDirectory");

    if (methods.Count != 1)
    {
      violations.Add(
          $"there is no single SyncDirectory to check ({methods.Count} found).");

      return violations;
    }

    var fsync = methods[0].DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .FirstOrDefault(invocation => NameOf(invocation) == "Fsync");

    if (fsync is null)
    {
      violations.Add("SyncDirectory no longer calls Fsync.");

      return violations;
    }

    var tested = fsync.FirstAncestorOrSelf<IfStatementSyntax>() is { } guard &&
        guard.Condition.Contains(fsync) &&
        guard.Statement.DescendantNodesAndSelf().OfType<ThrowStatementSyntax>().Any();

    if (!tested)
    {
      violations.Add(
          "SyncDirectory must test the Fsync result and throw on failure; a " +
          "discarded result is an acknowledgement of something not durable.");
    }

    return violations;
  }

  private static List<MethodDeclarationSyntax> Methods(string source, string name)
  {
    return Parse(source)
        .DescendantNodes()
        .OfType<MethodDeclarationSyntax>()
        .Where(method => method.Identifier.ValueText == name)
        .ToList();
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
