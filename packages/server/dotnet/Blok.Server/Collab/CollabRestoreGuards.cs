using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>
/// One reason a restore needs a person's yes: <c>share</c> (who can see or fill out a view changes),
/// <c>unlock</c> (a locked database comes back unlocked) or <c>lockedReshape</c> (a locked database is
/// removed, retyped or changed in a field its lock protects).
/// </summary>
internal sealed record CollabRestoreGuard(string Kind, string BlockId, string? ViewId = null)
{
  internal const string Share = "share";
  internal const string Unlock = "unlock";
  internal const string LockedReshape = "lockedReshape";

  /// <summary>The kinds a request may confirm.</summary>
  internal static readonly IReadOnlyList<string> Confirmable = [Share, Unlock, LockedReshape];

  internal JsonObject ToJson()
  {
    var json = new JsonObject { ["kind"] = Kind, ["blockId"] = BlockId };

    if (ViewId is not null)
    {
      json["viewId"] = ViewId;
    }

    return json;
  }
}

/// <summary>
/// The guards a restore of <c>target</c> over <c>current</c> raises, both as exported blocks.
/// Mirrors restoreTouchesLocked, unlockedBetween and restoreShares in src/shared/agent/approval.ts;
/// fixtures/collab-history/restore-guards.json is the oracle all three servers and the TS agent read.
/// Lock guards come first in the current export's order, then share guards in the target's.
/// </summary>
internal static class CollabRestoreGuards
{
  /// <summary>Everything a database lock freezes (LOCK_PROTECTED_FIELDS in src/shared/tool-actions/database.ts).</summary>
  private static readonly string[] LockProtectedFields = ["schema", "views", "automations", "source", "hideDataSourceTitles", "starter"];

  private static readonly string[] SubmissionAccess = ["none", "view", "comment", "edit", "full"];

  // The agent's question names the calendar in full: a longer id is not one it can show.
  private const int MaxCalendarId = 64;

  /// <summary>
  /// The guards of a <c>databases=keep</c> restore: those of the kept target, less any on a kept block,
  /// which stays as it is now, then one <c>orphanedDatabase</c> guard per kept root the restore would orphan.
  /// </summary>
  internal static IReadOnlyList<CollabRestoreGuard> Kept(JsonArray currentBlocks, CollabKeptDatabases kept)
  {
    ArgumentNullException.ThrowIfNull(kept);

    return [.. Of(currentBlocks, kept.Target).Where(guard => !kept.Pinned.Contains(guard.BlockId)), .. kept.Orphaned];
  }

  internal static IReadOnlyList<CollabRestoreGuard> Of(JsonArray currentBlocks, JsonArray targetBlocks)
  {
    // The blocks the planner writes: its normalized target, and the first copy of a repeated id.
    var now = Index(currentBlocks);
    var target = Index(CollabRestorePlanner.NormalizeTarget(targetBlocks));
    var guards = new List<CollabRestoreGuard>();
    var lockedNow = LockedIn(now);
    var lockedTarget = LockedIn(target);

    foreach (var (id, block) in now)
    {
      if (Text(block["type"]) != "database" || !LockedOrHeld(now, id, lockedNow, []))
      {
        continue;
      }

      target.TryGetValue(id, out var after);

      if (after is not null && Text(after["type"]) == "database" &&
          LockProtectedFields.All(field => SameField(block["data"] as JsonObject, after["data"] as JsonObject, field)))
      {
        continue;
      }

      var unlocks = lockedNow.Contains(id) && after is not null && !lockedTarget.Contains(id);

      guards.Add(new CollabRestoreGuard(unlocks ? CollabRestoreGuard.Unlock : CollabRestoreGuard.LockedReshape, id));
    }

    foreach (var (id, after) in target)
    {
      if (Text(after["type"]) != "database")
      {
        continue;
      }

      var was = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

      if (now.TryGetValue(id, out var before) && Text(before["type"]) == "database")
      {
        // Last wins, as a Map built from entries does.
        foreach (var view in ViewsIn(before))
        {
          if (Text(view["id"]) is { } viewId)
          {
            was[viewId] = view;
          }
        }
      }

      foreach (var view in ViewsIn(after))
      {
        var viewId = Text(view["id"]) ?? "";
        var previous = viewId == "" ? null : was.GetValueOrDefault(viewId);

        if (ShareChanges(previous, view))
        {
          guards.Add(new CollabRestoreGuard(CollabRestoreGuard.Share, id, viewId));
        }
      }
    }

    return guards;
  }

  /// <summary>The blocks by id, in order; the first copy of an id wins and "" is an id, as in the planner.</summary>
  private static Dictionary<string, JsonObject> Index(JsonArray blocks)
  {
    var index = new Dictionary<string, JsonObject>(StringComparer.Ordinal);

    foreach (var node in blocks)
    {
      if (node is JsonObject block && Text(block["id"]) is { } id)
      {
        index.TryAdd(id, block);
      }
    }

    return index;
  }

  private static string? Text(JsonNode? node) =>
      node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

  private static bool IsTrue(JsonNode? node) =>
      node is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;

  /// <summary>Databases (any block) whose schema has a title property with databaseLocked true.</summary>
  private static HashSet<string> LockedIn(Dictionary<string, JsonObject> blocks)
  {
    var locked = new HashSet<string>(StringComparer.Ordinal);

    foreach (var (id, block) in blocks)
    {
      if ((block["data"] as JsonObject)?["schema"] is JsonArray schema &&
          schema.Any(property => property is JsonObject title && Text(title["type"]) == "title" && IsTrue(title["databaseLocked"])))
      {
        locked.Add(id);
      }
    }

    return locked;
  }

  /// <summary>Locked by its own lock, or held by a locked database up its chain of database parents.</summary>
  private static bool LockedOrHeld(Dictionary<string, JsonObject> blocks, string id, HashSet<string> locked, HashSet<string> seen)
  {
    if (locked.Contains(id))
    {
      return true;
    }

    var parent = ParentOf(blocks, id);

    return parent is not null && !seen.Contains(parent) &&
        blocks.TryGetValue(parent, out var holder) && Text(holder["type"]) == "database" &&
        LockedOrHeld(blocks, parent, locked, [.. seen, id]);
  }

  /// <summary>A snapshot's parent: a string that is not the block itself and names a block that exists.</summary>
  private static string? ParentOf(Dictionary<string, JsonObject> blocks, string id) =>
      Text(blocks[id]["parent"]) is { } parent && parent != id && blocks.ContainsKey(parent) ? parent : null;

  /// <summary>Missing and null differ, as undefined and null do.</summary>
  private static bool SameField(JsonObject? before, JsonObject? after, string field)
  {
    var had = before is not null && before.TryGetPropertyValue(field, out _);
    var has = after is not null && after.TryGetPropertyValue(field, out _);

    return had == has && (!had || JsonNode.DeepEquals(before![field], after![field]));
  }

  private static IEnumerable<JsonObject> ViewsIn(JsonObject block) =>
      (block["data"] as JsonObject)?["views"] is JsonArray views ? views.OfType<JsonObject>() : [];

  /// <summary>
  /// Whether the view's sharing differs from <paramref name="previous"/> (null counts as the defaults),
  /// or a raw sharing value changed that Blok cannot read as the Share panel does (fails closed).
  /// </summary>
  private static bool ShareChanges(JsonObject? previous, JsonObject view)
  {
    var rawBefore = RawShare(previous);
    var rawAfter = RawShare(view);

    if (rawBefore.Zip(rawAfter).All(pair => SameValue(pair.First, pair.Second)))
    {
      return false;
    }

    return !Readable(view) || ShareOf(previous) != ShareOf(view);
  }

  /// <summary>A value that may be missing: (present, value).</summary>
  private static (bool Present, JsonNode? Value) Member(JsonObject? owner, string key) =>
      owner is not null && owner.TryGetPropertyValue(key, out var value) ? (true, value) : (false, null);

  private static bool SameValue((bool Present, JsonNode? Value) left, (bool Present, JsonNode? Value) right) =>
      left.Present == right.Present && (!left.Present || JsonNode.DeepEquals(left.Value, right.Value));

  /// <summary>rawShare: whether form is missing or an object, the four form values and calendarSync as stored.</summary>
  private static (bool Present, JsonNode? Value)[] RawShare(JsonObject? view)
  {
    var (hasForm, formValue) = Member(view, "form");
    var form = formValue as JsonObject;

    return
    [
      (true, JsonValue.Create(!hasForm || form is not null)),
      Member(form, "closed"),
      Member(form, "public"),
      Member(form, "anonymous"),
      Member(form, "submissionAccess"),
      Member(view, "calendarSync"),
    ];
  }

  /// <summary>shareOf: the settings with defaults filled in, as one comparable string.</summary>
  private static string ShareOf(JsonObject? view)
  {
    var form = view?["form"] as JsonObject;
    var sync = view?["calendarSync"] as JsonObject;
    var access = Text(form?["submissionAccess"]) is { } named && SubmissionAccess.Contains(named) ? named : "none";
    var reach = IsTrue(form?["closed"]) ? "closed" : IsTrue(form?["public"]) ? "public" : "workspace";
    var calendar = Text(sync?["calendarId"]) is { Length: > 0 } id ? id : null;

    return new JsonArray(reach, IsTrue(form?["anonymous"]), access, IsTrue(sync?["enabled"]), calendar).ToJsonString();
  }

  /// <summary>readableShare: every sharing value is one Blok reads the one way the Share panel does.</summary>
  private static bool Readable(JsonObject view)
  {
    var (hasForm, formValue) = Member(view, "form");
    var (hasSync, syncValue) = Member(view, "calendarSync");
    var form = formValue as JsonObject;
    var sync = syncValue as JsonObject;

    return (!hasForm || form is not null) && (!hasSync || sync is not null) &&
        OptionalBoolean(form, "closed") && OptionalBoolean(form, "public") && OptionalBoolean(form, "anonymous") &&
        Optional(form, "submissionAccess", value => Text(value) is { } named && SubmissionAccess.Contains(named)) &&
        OptionalBoolean(sync, "enabled") &&
        Optional(sync, "calendarId", value => Text(value) is { } id && IsPlainLine(id));
  }

  private static bool Optional(JsonObject? owner, string key, Func<JsonNode?, bool> valid)
  {
    var (present, value) = Member(owner, key);

    return !present || valid(value);
  }

  private static bool OptionalBoolean(JsonObject? owner, string key) =>
      Optional(owner, key, value => value is JsonValue flag && flag.TryGetValue<bool>(out _));

  /// <summary>
  /// plainLine(id, 64) === id: 1 to 64 code points, no control, format, line or paragraph separator,
  /// no space but U+0020, and no leading, trailing or doubled space.
  /// </summary>
  internal static bool IsPlainLine(string id)
  {
    var count = 0;
    var previousSpace = true;

    foreach (var rune in id.EnumerateRunes())
    {
      count++;

      if (rune.Value == ' ')
      {
        if (previousSpace)
        {
          return false;
        }

        previousSpace = true;

        continue;
      }

      previousSpace = false;

      if (Rune.GetUnicodeCategory(rune) is UnicodeCategory.Control or UnicodeCategory.Format or
          UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator or UnicodeCategory.SpaceSeparator)
      {
        return false;
      }
    }

    return count is > 0 and <= MaxCalendarId && !previousSpace;
  }
}
