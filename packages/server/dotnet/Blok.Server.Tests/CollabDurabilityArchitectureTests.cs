using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Pins the one line the operation store's whole durability story rests on.
/// </summary>
/// <remarks>
/// <para>
/// A flushed write and an unflushed one are indistinguishable to every reader
/// on a machine with a page cache, including a freshly started process. Only
/// real power loss separates them. So no behavioural test can notice if
/// <c>Flush(flushToDisk: true)</c> is deleted from the append path: the suite
/// stays green, and every acknowledgement the server gives from then on is a
/// promise about bytes that may never reach a disk. That was demonstrated, not
/// assumed — removing the call passes every operation-store test.
/// </para>
/// <para>
/// This law is therefore static, and it is deliberately strict about ORDER:
/// the flush must sit in the same block as the journal write and after it. A
/// flush that runs before the write, or on some other handle, would satisfy a
/// looser check while leaving the record in the page cache.
/// </para>
/// </remarks>
public sealed class CollabDurabilityArchitectureTests
{
  private const string StorePath = "Blok.Server/Collab/LocalCollabOperationStore.cs";
  private const string AppendMethod = "AppendAsync";
  private const string JournalHandle = "journal";

  [Fact]
  public void TheAppendPathFlushesTheJournalToDiskBeforeItAcknowledges()
  {
    var source = File.ReadAllText(
        Path.Combine(FindDotnetRoot(), StorePath.Replace('/', Path.DirectorySeparatorChar)));
    var violations = FindViolations(source);

    Assert.True(
        violations.Count == 0,
        $"{StorePath} no longer flushes the journal to stable storage on the " +
        "append path. Nothing else in the suite can catch this: an unflushed " +
        "write reads back exactly like a flushed one, so every test stays " +
        "green while every acknowledgement becomes a promise about bytes no " +
        "disk holds.\n" + string.Join("\n", violations));
  }

  [Fact]
  public void DetectsAMissingFlush()
  {
    Assert.Single(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Seek(0, SeekOrigin.End);
            journal.Write(bytes);
          }
        }
        """));
  }

  [Fact]
  public void DetectsTheNonDurableFlushOverload()
  {
    Assert.Single(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush();
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFlushThatDoesNotReachTheDisk()
  {
    Assert.Single(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush(flushToDisk: false);
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFlushOfSomeOtherHandle()
  {
    Assert.Single(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            manifestFile.Flush(flushToDisk: true);
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFlushThatRunsBeforeTheWrite()
  {
    Assert.Single(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Flush(flushToDisk: true);
            journal.Write(bytes);
          }
        }
        """));
  }

  [Fact]
  public void DetectsAFlushStrandedInAnotherBlock()
  {
    Assert.Single(FindViolations(
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
        """));
  }

  [Fact]
  public void AcceptsThePositionalArgument()
  {
    Assert.Empty(FindViolations(
        """
        class Session
        {
          void AppendAsync()
          {
            journal.Write(bytes);
            journal.Flush(true);
          }
        }
        """));
  }

  private static List<string> FindViolations(string source)
  {
    var violations = new List<string>();
    var append = CSharpSyntaxTree
        .ParseText(source, CSharpParseOptions.Default.WithLanguageVersion(LanguageVersion.Latest))
        .GetRoot()
        .DescendantNodes()
        .OfType<MethodDeclarationSyntax>()
        .SingleOrDefault(method => method.Identifier.ValueText == AppendMethod);

    if (append is null)
    {
      violations.Add($"there is no single {AppendMethod} to check.");

      return violations;
    }

    var write = CallOn(append, JournalHandle, "Write").FirstOrDefault();

    if (write is null)
    {
      violations.Add($"{AppendMethod} no longer writes to {JournalHandle}.");

      return violations;
    }

    var flushed = CallOn(append, JournalHandle, "Flush").Any(flush =>
        FlushesToDisk(flush) &&
        Block(flush) is { } block &&
        block == Block(write) &&
        flush.SpanStart > write.SpanStart);

    if (!flushed)
    {
      violations.Add(
          $"{AppendMethod} must call {JournalHandle}.Flush(flushToDisk: true) " +
          "after its write, in the same block.");
    }

    return violations;
  }

  private static IEnumerable<InvocationExpressionSyntax> CallOn(
      SyntaxNode scope,
      string receiver,
      string method)
  {
    return scope.DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation =>
            invocation.Expression is MemberAccessExpressionSyntax
            {
              Expression: IdentifierNameSyntax identifier,
              Name: var name,
            } &&
            identifier.Identifier.ValueText == receiver &&
            name.Identifier.ValueText == method);
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
