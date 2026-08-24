using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.StaticFiles;

namespace Blok.Server.AspNetCore;

internal static class LocalFileEndpoint
{
  private static readonly FileExtensionContentTypeProvider ContentTypes = new();

  internal static void Map(
      IEndpointRouteBuilder endpoints,
      BlokServerOptions options)
  {
    if (options.StorageDirectory == "" || options.S3Bucket != "")
    {
      return;
    }

    var prefix = PublicPath(options.PublicUrl);

    if (prefix == "")
    {
      return;
    }

    endpoints.MapMethods(
        $"{prefix}/{{fileName}}",
        ["GET", "HEAD"],
        context => ServeAsync(
            context,
            options.StorageDirectory,
            context.Request.RouteValues["fileName"] as string ?? ""));
  }

  private static async Task ServeAsync(
      HttpContext context,
      string directory,
      string fileName)
  {
    if (!IsDirectFileName(fileName))
    {
      await NotFoundAsync(context);
      return;
    }

    var path = Path.Combine(directory, fileName);
    FileStream file;

    try
    {
      file = new FileStream(
          path,
          FileMode.Open,
          FileAccess.Read,
          FileShare.Read,
          bufferSize: 81920,
          FileOptions.Asynchronous | FileOptions.SequentialScan);
    }
    catch (Exception error) when (
        error is FileNotFoundException or
        DirectoryNotFoundException or
        UnauthorizedAccessException)
    {
      await NotFoundAsync(context);
      return;
    }

    await using (file)
    {
      context.Response.ContentType = ContentTypes.TryGetContentType(fileName, out var contentType)
        ? contentType
        : "application/octet-stream";
      context.Response.ContentLength = file.Length;
      context.Response.Headers.ContentDisposition = "attachment";
      context.Response.Headers.XContentTypeOptions = "nosniff";

      if (!HttpMethods.IsHead(context.Request.Method))
      {
        await file.CopyToAsync(context.Response.Body, context.RequestAborted);
      }
    }
  }

  private static string PublicPath(string publicUrl)
  {
    if (Uri.TryCreate(publicUrl, UriKind.Absolute, out var absolute))
    {
      return absolute.AbsolutePath.TrimEnd('/');
    }

    var suffixStart = publicUrl.IndexOfAny(['?', '#']);
    var relativePath = suffixStart < 0
      ? publicUrl
      : publicUrl[..suffixStart];

    return relativePath.TrimEnd('/');
  }

  private static bool IsDirectFileName(string fileName)
  {
    return fileName is not ("" or "." or "..") &&
        fileName.IndexOfAny(['/', '\\']) < 0;
  }

  private static async Task NotFoundAsync(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("404 page not found\n");
  }
}
