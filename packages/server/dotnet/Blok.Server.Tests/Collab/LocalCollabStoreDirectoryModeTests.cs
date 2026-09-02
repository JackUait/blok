using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class LocalCollabStoreDirectoryModeTests : IDisposable
{
  private const UnixFileMode Private =
      UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;

  private readonly string directory = Path.Combine(
      Path.GetTempPath(),
      $"blok-collab-store-mode-{Guid.NewGuid():N}");

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  [Fact]
  public async Task TightensAWorkingSetDirectoryThatAlreadyExisted()
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    // An operator's pre-made --collab-dir, world-readable: the private mode
    // is only applied at creation, so the working set would be readable by
    // everyone on the machine.
    Directory.CreateDirectory(
        directory,
        Private | UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
        UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
    var store = new LocalCollabStore(directory, _ => { });

    await store.WriteAsync("doc-1", [], Tags.At(0), CancellationToken.None);

    Assert.Equal(Private, File.GetUnixFileMode(directory));
  }
}
