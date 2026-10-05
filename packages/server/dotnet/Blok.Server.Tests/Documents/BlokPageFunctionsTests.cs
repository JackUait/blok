using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

public sealed class BlokPageFunctionsTests
{
  // Owners at the top level, in a toggle and in a table cell; references inline,
  // in a quote caption, a page-link and three kinds of table cell; an idless block.
  private const string PageDocument = """
      {"time":1759670000000,"version":"1.15.2","blocks":[
        {"id":"h1","type":"header","data":{"text":"Roadmap <a href=\"#p2\">jump</a>","level":2},"tunes":{"anchor":{"id":"roadmap"}}},
        {"id":"p1","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"pg-ref\" href=\"/p/pg-ref\">Specs</a> &amp; <b>more</b>"}},
        {"id":"own1","type":"page","data":{"pageId":"pg-child-a","title":"Child A"}},
        {"id":"lnk","type":"page-link","data":{"pageId":"pg-elsewhere"}},
        {"id":"tg","type":"toggle","content":["tgc","own2"],"data":{"text":"Details"}},
        {"id":"tgc","type":"paragraph","parent":"tg","data":{"text":"Nested <a data-blok-page-id=\"pg-ref\">again</a>"}},
        {"id":"own2","type":"page","parent":"tg","data":{"pageId":"pg-child-b"}},
        {"id":"q","type":"quote","data":{"text":"Quoted","caption":"by <a data-blok-page-id=\"pg-cap\">Author</a>"}},
        {"id":"tbl","type":"table","content":["c1","c2"],"data":{"withHeadings":false,"content":[[{"blocks":["c1"]},"legacy <a data-blok-page-id=\"pg-cell-str\">cell</a>"],[{"blocks":["c2"],"text":"x"},{"blocks":[],"text":"Text <a data-blok-page-id=\"pg-cell-txt\">t</a>"}]]}},
        {"id":"c1","type":"paragraph","parent":"tbl","data":{"text":"Cell one <a data-blok-page-id=\"pg-in-cell\">c</a>"}},
        {"id":"c2","type":"page","parent":"tbl","data":{"pageId":"pg-child-c"}},
        {"id":"p2","type":"paragraph","data":{"text":"Tail ünïcödé 日本"}},
        {"type":"paragraph","data":{"text":"idless legacy"}}
      ]}
      """;

  [Fact]
  public async Task IndexesOwnersReferencesAndTextThroughTheRuntime()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var index = await converter.GetPageIndexAsync(PageDocument);

    Assert.Equal(
        [
          new BlokPageOwnerEdge("pg-child-a", "own1", 2),
          new BlokPageOwnerEdge("pg-child-b", "own2", 6),
          new BlokPageOwnerEdge("pg-child-c", "c2", 8),
        ],
        index.Owners);
    Assert.Equal(
        [
          new BlokPageReference("pg-ref", "p1", 1),
          new BlokPageReference("pg-elsewhere", "lnk", 3),
          new BlokPageReference("pg-ref", "tgc", 5),
          new BlokPageReference("pg-cap", "q", 7),
          new BlokPageReference("pg-in-cell", "c1", 8),
          new BlokPageReference("pg-cell-str", "tbl", 8),
          new BlokPageReference("pg-cell-txt", "tbl", 8),
        ],
        index.References);
    Assert.Equal(
        [
          new BlokPageTextEntry("h1", 0, "Roadmap jump"),
          new BlokPageTextEntry("p1", 1, "See Page & more"),
          new BlokPageTextEntry("own1", 2, string.Empty),
          new BlokPageTextEntry("lnk", 3, "Page"),
          new BlokPageTextEntry("tg", 4, "Details"),
          new BlokPageTextEntry("tgc", 5, "Nested Page"),
          new BlokPageTextEntry("own2", 6, string.Empty),
          new BlokPageTextEntry("q", 7, "Quoted\nby Page"),
          new BlokPageTextEntry("tbl", 8, "Cell one Page\tlegacy Page\n\tText Page"),
          new BlokPageTextEntry("p2", 9, "Tail ünïcödé 日本"),
          new BlokPageTextEntry(null, 10, "idless legacy"),
        ],
        index.Text);
  }

  [Fact]
  public async Task ReportsUnreadableJsonAsAnInvalidDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await converter.GetPageIndexAsync("{not json"));

    Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
  }

  [Fact]
  public async Task ReportsADocumentWithNoBlocksAsAnInvalidDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await converter.GetPageIndexAsync("""{"notBlocks":[]}"""));

    Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
  }

  [Fact]
  public async Task RefusesANullDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    await Assert.ThrowsAsync<ArgumentNullException>(async () => await converter.GetPageIndexAsync(null!));
  }
}
