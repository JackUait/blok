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

  /// <summary>An entry's kind and permission bits and its owner, as lstat(2) reads them (a link is not followed).</summary>
  internal readonly record struct NativeStat(int Mode, uint Uid);

  internal const int KindMask = 0xF000;
  internal const int DirectoryKind = 0x4000;
  internal const int LinkKind = 0xA000;

  /// <summary>lstat through .NET's own native shim, whose struct is the same on every Unix; null when it fails.</summary>
  internal static NativeStat? LStat(string path)
  {
    return SystemLStat(path, out var status) == 0 ? new NativeStat(status.Mode, status.Uid) : null;
  }

  /// <summary>geteuid(2).</summary>
  internal static uint EffectiveUserId()
  {
    return GetEUid();
  }

  // System.Native's FileStatus begins Flags, Mode, Uid, Gid; Size leaves room for the fields after them.
  [StructLayout(LayoutKind.Sequential, Size = 512)]
  private struct FileStatus
  {
    internal int Flags;
    internal int Mode;
    internal uint Uid;
    internal uint Gid;
  }

  [LibraryImport("libSystem.Native", EntryPoint = "SystemNative_LStat", StringMarshalling = StringMarshalling.Utf8)]
  private static partial int SystemLStat(string path, out FileStatus status);

  [LibraryImport("libc", EntryPoint = "geteuid")]
  private static partial uint GetEUid();
}
