using System.Runtime.InteropServices;

namespace Blok.Server.Mcp.Sources;

/// <summary>
/// realpath(3), which Node's realpath.native calls: it resolves links AND reports a
/// name's on-disk letter case, which .NET's path APIs do not.
/// </summary>
internal static partial class NativePath
{
  internal static string? RealPath(string path)
  {
    if (OperatingSystem.IsWindows())
    {
      return WindowsRealPath(path);
    }
    var resolved = Realpath(path, IntPtr.Zero);

    if (resolved == IntPtr.Zero)
    {
      return null;
    }
    try
    {
      return Marshal.PtrToStringUTF8(resolved);
    }
    finally
    {
      Free(resolved);
    }
  }

  /// <summary>fsync on a directory, so a rename in it survives a crash. Best effort.</summary>
  internal static void SyncDirectory(string path)
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }
    var fd = Open(path, 0);

    if (fd < 0)
    {
      return;
    }
    _ = Fsync(fd);
    _ = Close(fd);
  }

  private static string? WindowsRealPath(string path)
  {
    try
    {
      var info = new FileInfo(path);
      var target = info.ResolveLinkTarget(returnFinalTarget: true);
      var final = target?.FullName ?? info.FullName;

      return File.Exists(final) || Directory.Exists(final) ? final : null;
    }
    catch (IOException)
    {
      return null;
    }
    catch (UnauthorizedAccessException)
    {
      return null;
    }
  }

  [LibraryImport("libc", EntryPoint = "realpath", StringMarshalling = StringMarshalling.Utf8)]
  private static partial IntPtr Realpath(string path, IntPtr resolved);

  [LibraryImport("libc", EntryPoint = "free")]
  private static partial void Free(IntPtr pointer);

  [LibraryImport("libc", EntryPoint = "open", StringMarshalling = StringMarshalling.Utf8)]
  private static partial int Open(string path, int flags);

  [LibraryImport("libc", EntryPoint = "fsync")]
  private static partial int Fsync(int fd);

  [LibraryImport("libc", EntryPoint = "close")]
  private static partial int Close(int fd);
}
