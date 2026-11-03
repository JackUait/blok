# Writes the room-*.json and version-*.json files under
# test/fixtures/agent-server-scenarios, which C# AgentServerScenarioTests and
# Go TestMatchesTheAgentServerScenarios both read. The expectations are C#'s
# answers. Run: python3 scripts/generate-agent-room-scenarios.py test/fixtures/agent-server-scenarios
# A rerun must leave git clean; nothing checks that automatically yet.
import json, os, sys
root = sys.argv[1]
AGENT = {"id": "agent-cs", "name": "Agent"}
ROOM_SEED = {"blocks": [
    {"id": "p", "type": "paragraph", "data": {"text": "Hello world"}},
    {"id": "t", "type": "toggle", "data": {"text": "T"}, "content": ["k"]},
    {"id": "k", "type": "paragraph", "data": {"text": "kid"}, "parent": "t"}]}
HIST_SEED = {"blocks": [
    {"id": "p", "type": "paragraph", "data": {"text": "Hello"}},
    {"id": "q", "type": "paragraph", "data": {"text": "Other"}}]}
VER_SEED = {"blocks": [
    {"id": "p", "type": "paragraph", "data": {"text": "Hello world"}},
    {"id": "q", "type": "paragraph", "data": {"text": "Second"}}]}
def c(name, args): return {"name": name, "args": args}
def b(*commands, **extra):
    out = dict(extra); out["commands"] = list(commands); return out
def room(batch, expect, **kw):
    step = {"run": "room", "actor": AGENT, "batch": batch, "expect": expect}; step.update(kw); return step
UNDO = b(c("history.undo", {})); REDO = b(c("history.redo", {}))
def insert(i, text): return b(c("block.insert", {"id": i, "type": "paragraph", "data": {"text": text}, "position": "end"}))
def replace(i, text): return b(c("text.replace", {"id": i, "with": text}))
def setTitle(t): return b(c("doc.setTitle", {"title": t}))
def peer(i, text): return {"run": "peer", "ops": {"ops": [{"op": "update", "id": i, "data": {"text": text}}]}}
S = {}
def scen(name, seed, steps, roomspec=None, **kw):
    out = {"name": name, "room": roomspec or {}, "seed": seed}
    out.update(kw); out["steps"] = steps; S[name] = out

# BlokAgentRoomTests
scen("room-edit-returns-head", ROOM_SEED, [room(b(c("text.format", {"id": "p", "range": {"find": "world"}, "set": {"bold": True}})),
    {"ok": True, "saved": False, "revision": "@head", "committed": 1, "result": {"/revision": "@head"},
     "state": {"/blocks/0/lastEditedBy": "agent-cs", "/blocks/0/data/text": [{"text": "Hello "}, {"text": "world", "marks": {"bold": True}}]}})])
scen("room-expect-revision-is-the-head", ROOM_SEED, [
    room(setTitle("One"), {"ok": True, "revision": "@head"}),
    room(setTitle("Two") | {"expectRevision": "{rev:0}"}, {"ok": True, "committed": 1, "state": {"/title": "Two"}})])
scen("room-stale-head-writes-nothing", ROOM_SEED, [
    room(b(c("block.delete", {"id": "p"}), expectRevision="ffffffffffffffffffffffffffffffff:99"),
         {"ok": False, "code": "STALE", "committed": 0, "blocksUnchanged": True, "revision": "@head",
          "result": {"/error/retryable": True, "/error/details/revision": "@head", "/revision": "@head"}})])
scen("room-stale-carries-current", ROOM_SEED, [
    room(b(c("text.insert", {"id": "p", "at": 0, "text": "x"}), expectRevision="ffffffffffffffffffffffffffffffff:99"),
         {"ok": False, "code": "STALE", "committed": 0, "result": {"/error/details/revision": "@head", "/error/details/current": {"present": True}}})])
for label, value in [("h123", "h123"), ("colon-first", ":1"), ("signed", "{lineage}:-1"), ("space", "{lineage}: 1"), ("number", 5), ("null", None), ("empty", "")]:
    scen("room-expect-malformed-" + label, ROOM_SEED, [room(b(c("doc.read", {}), expectRevision=value),
        {"ok": False, "code": "INVALID_ARGS", "committed": 0, "revision": "", "result": {"/revision": {"absent": True}}})])
# T4: the agent's expectRevision is lax.
for label, value in [("leading-zero", "{lineage}:00"), ("trailing-nul", "{lineage}:0\u0000"), ("last-colon", "a:{lineage}:0")]:
    scen("room-expect-lax-" + label, ROOM_SEED, [room(setTitle("Lax") | {"expectRevision": value},
        {"ok": label != "last-colon", "code": "STALE" if label == "last-colon" else None} | ({"state": {"/title": "Lax"}} if label != "last-colon" else {"committed": 0}))])
scen("room-failed-batch-writes-nothing", ROOM_SEED, [room(b(c("block.delete", {"id": "p"}), c("block.delete", {"id": "missing"})),
    {"ok": False, "code": "BLOCK_NOT_FOUND", "committed": 0, "blocksUnchanged": True, "revision": ""})])
scen("room-delete-toggle-keeps-child", ROOM_SEED, [room(b(c("block.delete", {"id": "t"})),
    {"ok": True, "state": {"/blocks": {"length": 2}, "/blocks/1/id": "k", "/blocks/1/parent": {"absent": True}, "/blocks/1/lastEditedBy": "agent-cs"}})])
scen("room-without-journal", ROOM_SEED, [
    room(setTitle("Plain"), {"ok": True, "revision": "", "state": {"/title": "Plain"}}),
    room(setTitle("No") | {"expectRevision": "abc:1"}, {"ok": False, "code": "INVALID_ARGS", "revision": "", "state": {"/title": "Plain"},
        "result": {"/error/message": "This room keeps no journal, so expectRevision cannot be checked. Send the batch without it."}})], {"journal": False})
scen("room-page-rename-writes-a-target-room", ROOM_SEED, [
    {"run": "plain", "document": {"from": "@seed", "set": {"/blocks": [{"id": "pg", "type": "page", "data": {"pageId": "page-2"}}]}},
     "batch": b(c("page.rename", {"id": "pg", "title": "Roadmap"})), "expect": {"ok": True, "saved": False, "state": {"/title": "Roadmap"}}}],
    options={"pageTitles": True, "target": "plain"}, pages={"page-2": {"room": "agent-room"}})
scen("room-read-returns-the-head", ROOM_SEED, [
    room(setTitle("One"), {"ok": True}),
    room(b(c("doc.read", {})), {"ok": True, "revision": "@head", "committed": 0, "result": {"/results/0/revision": "@head"}})])
scen("room-expect-text-mismatch-is-stale", ROOM_SEED, [room(b(c("text.format", {"id": "p", "range": {"start": 0, "end": 5, "expectText": "Nope!"}, "set": {"bold": True}})),
    {"ok": False, "code": "STALE", "committed": 0, "revision": ""})])
scen("room-page-rename-from-a-live-source", ROOM_SEED, [
    room(b(c("page.rename", {"id": "pg", "title": "Roadmap"})), {"ok": True, "result": {"/results/0": {"pageId": "page-2", "applied": True}},
        "stateDoc": "agent-room", "state": {"/title": "Roadmap"}}, doc="source-room", actor=None)],
    {"held": {"source-room": {"blocks": [{"id": "pg", "type": "page", "data": {"pageId": "page-2"}}]}}},
    options={"pageTitles": True, "target": "plain"}, pages={"page-2": {"room": "agent-room"}})
RETYPE = {"blocks": [{"id": "p", "type": "paragraph", "data": {"text": [{"text": "Hello world"}]}},
                     {"id": "h", "type": "header", "data": {"text": [{"text": "Head"}], "level": 2}}]}
rows = [
  [c("text.insert", {"id": "p", "at": 5, "text": ","}), c("block.convert", {"id": "p", "type": "header", "data": {"level": 3}})],
  [c("block.convert", {"id": "p", "type": "header", "data": {"level": 3}}), c("text.insert", {"id": "p", "at": 5, "text": ","})],
  [c("text.format", {"id": "h", "range": {"find": "Head"}, "set": {"bold": True}}), c("block.convert", {"id": "h", "type": "paragraph"})],
  [c("text.insert", {"id": "p", "at": 0, "text": "> "}), c("block.convert", {"id": "p", "type": "quote"}), c("text.delete", {"id": "p", "range": {"start": 0, "end": 2}})]]
for n, commands in enumerate(rows, 1):
    scen(f"room-edit-and-retype-{n}", RETYPE, [
        {"run": "plain", "document": "@seed", "batch": b(*commands), "expect": {"ok": True, "saved": True}},
        room(b(*commands), {"ok": True, "stateMatchesSaved": 0}, actor=None)])

# BlokAgentRoomHistoryTests
scen("room-undo-redo-the-last-batch", HIST_SEED, [
    room(insert("a", "first"), {"ok": True}), room(insert("b", "second"), {"ok": True}),
    room(UNDO, {"ok": True, "revision": "@head", "committed": 1, "state": {"/blocks": {"length": 3}, "/blocks/2/id": "a"},
        "result": {"/results": [{}], "/refs": {}, "/changed": {"created": [], "updated": [], "moved": [], "removed": []}, "/warnings": []}}),
    room(REDO, {"ok": True, "state": {"/blocks": {"length": 4}, "/blocks/3/id": "b"}})])
scen("room-undo-nothing-to-replay", HIST_SEED, [
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO", "revision": "", "result": {"/error/message": "This session has no step to undo.", "/error/retryable": False}}),
    room(REDO, {"ok": False, "code": "NOTHING_TO_REDO", "result": {"/error/message": "This session has no undone step to redo."}}),
    room(insert("a", "first"), {"ok": True}),
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO"}, actor={"id": "agent-2", "name": "Other"})])
scen("room-undo-keeps-a-peer-edit", HIST_SEED, [
    room(replace("p", "Agent"), {"ok": True}), peer("q", "Peer"),
    room(UNDO, {"ok": True, "state": {"/blocks/0/data/text": [{"text": "Hello"}], "/blocks/1/data/text": [{"text": "Peer"}]}})])
scen("room-undo-peer-conflict", HIST_SEED, [
    room(insert("a", "Agent"), {"ok": True}), peer("a", "Peer typed here"),
    room(UNDO, {"ok": False, "code": "CONFLICT", "blocksUnchanged": True, "committed": 0, "result": {"/error/retryable": True,
        "/error/message": "Someone else changed what this step wrote, so it can no longer be undone. Re-read the document before retrying."}})])
scen("room-undo-move-and-title", HIST_SEED, [
    room(b(c("block.move", {"id": "q", "position": {"before": "p"}})), {"ok": True, "state": {"/blocks/0/id": "q", "/blocks/1/id": "p"}}),
    room(UNDO, {"ok": True, "state": {"/blocks/0/id": "p", "/blocks/1/id": "q"}}),
    room(setTitle("Agent title"), {"ok": True, "state": {"/title": "Agent title"}}),
    room(UNDO, {"ok": True, "state": {"/title": {"absent": True}}}),
    room(REDO, {"ok": True, "state": {"/title": "Agent title"}})])
scen("room-undo-forget-purge", HIST_SEED, [room(insert("a", "Agent"), {"ok": True}), {"run": "purge"},
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO"})])
scen("room-undo-forget-restore", HIST_SEED, [room(replace("p", "Agent"), {"ok": True}), {"run": "restore", "version": "{lineage}:0"},
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO", "blocksUnchanged": True, "committed": 0})])
scen("room-undo-forget-reset", HIST_SEED, [room(replace("p", "Agent"), {"ok": True}), {"run": "reset"},
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO", "blocksUnchanged": True, "committed": 0})])
forA = {"id": "agent-cs", "name": "Agent", "onBehalfOf": "person-a"}; forB = {"id": "agent-cs", "name": "Agent", "onBehalfOf": "person-b"}
scen("room-undo-per-person", HIST_SEED, [room(insert("a", "For A"), {"ok": True}, actor=forA),
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO", "state": {"/blocks": {"length": 3}}}, actor=forB),
    room(UNDO, {"ok": True, "state": {"/blocks": {"length": 2}}}, actor=forA)])
scen("room-undo-cap", HIST_SEED, [
    dict(room(replace("p", "T{i}"), {"ok": True}), times=105),
    dict(room(UNDO, {"ok": True}), times=100),
    room(b(c("doc.read", {})), {"ok": True, "state": {"/blocks/0/data/text": [{"text": "T4"}]}}),
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO"})])
# T13: an undo with more than args skips the gate and goes to the edit path.
scen("room-undo-with-args-takes-the-edit-path", HIST_SEED, [room(insert("a", "Agent"), {"ok": True}),
    room(b(c("history.undo", {"steps": 1})), {"ok": False, "code": "INVALID_ARGS", "committed": 0, "result": {"/error/path": "/commands/0/args/steps"}}),
    # The edit path's bundle session holds no step, so it answers nothing to undo although the room has one.
    room(b({"name": "history.undo", "args": {}, "ref": "u"}), {"ok": False, "code": "NOTHING_TO_UNDO", "committed": 0, "revision": "", "state": {"/blocks": {"length": 3}}})])
# T14: only the first command is checked for a version command.
scen("room-version-command-not-first", VER_SEED, [room(b(c("doc.read", {}), c("history.versions", {})), {"ok": False, "code": "INVALID_ARGS", "committed": 0, "result": {"/error/path": "/commands/1/name"}})])
# F14: a purged room refuses the edit.
scen("room-refused-purged", HIST_SEED, [room(setTitle("One"), {"ok": True}), {"run": "purge"},
    room(setTitle("Two"), {"ok": False, "code": "APPLY_FAILED", "revision": "", "result": {"/error/retryable": False, "/error/details": {"status": "Purged"},
        "/error/message": "The room refused the edit (Purged). Nothing was written."}})])
# F10: a room that cannot be read.
scen("room-unreadable-version-read", VER_SEED, [room(b(c("history.versions", {})), {"ok": False, "code": "APPLY_FAILED", "revision": "",
    "result": {"/error/retryable": True, "/error/message": "The room could not be read. Nothing was written."}}, doc="broken")],
    {"held": {"broken": {"blocks": "not a list"}}})
scen("room-unreadable-page-action", ROOM_SEED, [room(b(c("page.rename", {"id": "pg", "title": "X"})), {"ok": False, "code": "APPLY_FAILED",
    "result": {"/error/message": "The room could not be read. Nothing was written."}}, doc="broken")],
    {"held": {"broken": {"blocks": "not a list"}}}, options={"pageTitles": True, "target": "plain"})
scen("room-page-action-stale", ROOM_SEED, [room(b(c("page.rename", {"id": "pg", "title": "X"}), expectRevision="{lineage}:9"),
    {"ok": False, "code": "STALE", "revision": "@head", "result": {"/error/details/revision": "@head"}}, doc="source-room")],
    {"held": {"source-room": {"blocks": [{"id": "pg", "type": "page", "data": {"pageId": "page-2"}}]}}},
    options={"pageTitles": True, "target": "plain"}, pages={"page-2": {"room": "agent-room"}})
scen("room-undo-other-document", ROOM_SEED, [
    room(b(c("page.rename", {"id": "pg", "title": "Roadmap"})), {"ok": True}, doc="source-room", actor=None),
    room(UNDO, {"ok": False, "code": "UNDO_OTHER_DOCUMENT", "result": {"/error/retryable": False}}, doc="source-room", actor=None)],
    {"held": {"source-room": {"blocks": [{"id": "pg", "type": "page", "data": {"pageId": "page-2"}}]}}},
    options={"pageTitles": True, "target": "plain"}, pages={"page-2": {"room": "agent-room"}})

# BlokAgentVersionHistoryTests
CMDS = {"history.versions": {"available": True}, "history.read": {"available": True}, "history.changes": {"available": True}, "history.restore": {"available": True}}
UNAV = {k: {"unavailableReason": "service"} for k in CMDS}
scen("version-contract-room", VER_SEED, [{"run": "contract:room", "expect": {"commands": CMDS}}, {"run": "contract:plain", "expect": {"commands": UNAV}}])
scen("version-contract-room-without-journal", VER_SEED, [{"run": "contract:room", "expect": {"commands": UNAV}}], {"journal": False})
scen("version-list-read-changes", VER_SEED, [
    room(replace("p", "Changed"), {"ok": True}),
    room(b(c("history.versions", {"group": 1})), {"ok": True, "committed": 0, "result": {"/results/0/versions/0/version": "{rev:0}", "/results/0/versions/0/actors": ["agent-cs"]}}),
    room(b(c("history.read", {"version": "{lineage}:0"})), {"ok": True, "result": {"/results/0/version": "{lineage}:0", "/results/0/blocks/0/text": "Hello world", "/results/0/revision": {"absent": True}}}),
    room(b(c("history.changes", {"from": "{lineage}:0"})), {"ok": True, "committed": 0, "state": {"/blocks/0/data/text/0/text": "Changed"},
        "result": {"/results/0/changed": {"length": 1}, "/results/0/changed/0/id": "p", "/results/0/changed/0/before/text": "Hello world",
                   "/results/0/changed/0/after/text": "Changed", "/results/0/added": {"length": 0}}})])
# T3: group 15.0 is not an int, so the default grouping stays.
scen("version-list-group-not-an-int", VER_SEED, [room(replace("p", "Changed"), {"ok": True}),
    room(b(c("history.versions", {"group": 15.0})), {"ok": True}), room(b(c("history.versions", {"group": "15"})), {"ok": False, "code": "INVALID_ARGS"})])
scen("version-read-unknown", VER_SEED, [room(setTitle("One"), {"ok": True}),
    room(b(c("history.read", {"version": "{lineage}:99"})), {"ok": False, "code": "INVALID_ARGS", "result": {"/error/path": "/commands/0/args/version"}}),
    room(b(c("history.read", {"version": "nocolon"})), {"ok": False, "code": "INVALID_ARGS"})])
scen("version-without-history-journal", VER_SEED, [room(b(c("history.versions", {})), {"ok": False, "code": "COMMAND_UNAVAILABLE", "result": {"/error/details/reason": "service"}})], {"journal": False})
scen("version-purged", VER_SEED, [room(setTitle("One"), {"ok": True}), {"run": "purge"},
    room(b(c("history.versions", {})), {"ok": False, "code": "TOOL_ACTION_FAILED", "result": {"/error/retryable": False, "/error/message": "The version history failed: this document was deleted."}}),
    room(b(c("history.read", {"version": "{rev:0}"})), {"ok": False, "result": {"/error/retryable": False}})])
scen("version-stored-has-none", VER_SEED, [{"run": "plain", "document": {"from": "@seed", "set": {"/blocks": []}}, "batch": b(c("history.versions", {})), "expect": {"ok": False, "code": "COMMAND_UNAVAILABLE"}}])
scen("version-restore", VER_SEED, [
    room(replace("p", "Changed"), {"ok": True}),
    room(b(c("history.restore", {"version": "{lineage}:0"})), {"ok": True, "committed": 1, "revision": "@head", "result": {"/results/0/previous": "{rev:0}", "/revision": "@head"},
        "state": {"/blocks/0/data/text/0/text": "Hello world", "/blocks/0/lastEditedWith": {"absent": True}}}),
    room(b(c("history.versions", {"group": 1})), {"ok": True, "result": {"/results/0/versions/0/actors": ["agent-cs"]}})])
scen("version-restore-unknown", VER_SEED, [room(setTitle("One"), {"ok": True}),
    room(b(c("history.restore", {"version": "{lineage}:99"})), {"ok": False, "code": "VERSION_NOT_FOUND", "committed": 0, "revision": "@head"})])
scen("version-restore-stale", VER_SEED, [room(setTitle("One"), {"ok": True}), room(setTitle("Two"), {"ok": True}),
    room(b(c("history.restore", {"version": "{lineage}:0"}), expectRevision="{rev:0}"), {"ok": False, "code": "STALE", "committed": 0, "revision": "@head", "result": {"/error/details/revision": "@head"}})])
scen("version-undo-after-restore", VER_SEED, [room(replace("p", "Changed"), {"ok": True}),
    room(b(c("history.restore", {"version": "{lineage}:0"})), {"ok": True}),
    room(UNDO, {"ok": False, "code": "NOTHING_TO_UNDO", "committed": 0, "state": {"/blocks/0/data/text/0/text": "Hello world"}})])

# Page pre-create in a room (BlokAgentPageCreateTests).
EMPTY = {"blocks": []}
INSERT_PAGE = b(c("block.insert", {"type": "page", "id": "np", "position": "end"}))
CREATOR = {"pageTitles": True, "target": "creator"}
scen("room-page-create-insert-undo-redo", EMPTY, [
    room(INSERT_PAGE, {"ok": True, "revision": "@head", "state": {"/blocks/0/data/pageId": "host-1"}}, actor=None),
    room(UNDO, {"ok": True, "state": {"/blocks": {"length": 0}}}, actor=None),
    room(REDO, {"ok": True, "state": {"/blocks/0/data/pageId": "host-1"}}, actor=None),
    room(b(c("block.delete", {"id": "np"})), {"ok": True, "state": {"/blocks": {"length": 0}}}, actor=None)],
    options=CREATOR, host={"created": ["host-1"], "resolved": []})
scen("room-page-create-stale", EMPTY, [
    room(b(c("block.insert", {"type": "paragraph", "id": "p1", "position": "end"})), {"ok": True}, actor=None),
    room(b(c("block.insert", {"type": "paragraph", "id": "p2", "position": "end"})), {"ok": True}, actor=None),
    room(INSERT_PAGE | {"expectRevision": "{rev:0}"}, {"ok": False, "code": "STALE", "committed": 0, "revision": "@head",
        "result": {"/error/details/revision": "@head", "/error/details/current": {"present": True}}}, actor=None)],
    options=CREATOR, host={"created": []})
scen("room-page-create-forbidden", EMPTY, [
    room(INSERT_PAGE, {"ok": False, "code": "FORBIDDEN", "committed": 0, "revision": "",
        "result": {"/error/message": "The host does not let this agent create a page here. Nothing was written."}}, actor=None)],
    options=CREATOR, create=[""], host={"created": []})
scen("room-page-create-refused-batch", EMPTY, [
    room(b(c("block.insert", {"type": "page", "id": "np", "position": "end"}), c("block.delete", {"id": "missing"})),
        {"ok": False, "code": "BLOCK_NOT_FOUND", "committed": 0, "revision": ""}, actor=None)],
    options=CREATOR, host={"created": []})
scen("room-page-create-forbidden-after-one", EMPTY, [
    room(b(c("block.insert", {"type": "page", "id": "a", "position": "end"}), c("block.insert", {"type": "page", "id": "b", "position": "end"})),
        {"ok": False, "code": "ORPHANED_SIDE_EFFECT", "committed": 0, "revision": "", "result": {"/error/details/cause/code": "FORBIDDEN",
         "/error/details/orphaned": [{"command": "block.insert", "type": "page", "prepared": {"pageId": "host-1"}}]}}, actor=None)],
    options=CREATOR, create=["host-1", ""], host={"created": ["host-1"]})

# RoomAgentHistory approvals (BlokAgentRoomHistoryTests).
TABLE = {"id": "v", "name": "Table", "type": "table", "position": "a0", "filters": [], "sorts": [], "visibleProperties": []}
SCHEMA = [{"id": "t", "name": "Name", "type": "title", "position": "a0"}]
def database(*views):
    return {"id": "db", "type": "database", "content": [], "data": {"title": "Tasks", "activeViewId": "v", "views": [TABLE, *views], "schema": SCHEMA}}
scen("room-undo-unlock", {"blocks": [database()]}, [
    room(b(c("database.setLock", {"id": "db", "locked": True})), {"ok": True, "state": {"/blocks/0/data/schema/0/databaseLocked": True}}),
    room(UNDO, {"ok": False, "code": "APPROVAL_REQUIRED", "committed": 0, "state": {"/blocks/0/data/schema/0/databaseLocked": True},
        "result": {"/error/retryable": False, "/error/details": {"reason": "no-channel", "approval": {"kind": "database.unlock", "blockId": "db"}},
                   "/error/message": "This undo would unlock database \"db\". Unlocking needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to unlock it themselves."}})])
FORM = {"id": "f", "name": "Signup", "type": "form", "position": "a1", "filters": [], "sorts": [], "visibleProperties": [], "form": {"public": True}}
scen("room-undo-share-public-form", {"blocks": [database(FORM)]}, [
    room(b(c("database.deleteView", {"id": "db", "viewId": "f"})), {"ok": True, "state": {"/blocks/0/data/views": {"length": 1}}}),
    room(UNDO, {"ok": False, "code": "APPROVAL_REQUIRED", "committed": 0, "state": {"/blocks/0/data/views": {"length": 1}},
        "result": {"/error/details": {"reason": "no-channel", "approval": {"kind": "database.share", "blockId": "db", "viewId": "f"}},
                   "/error/message": "This undo would change who can see or fill out view \"f\" of database \"db\". That needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to do it themselves."}})])
for label, view, view_id in [
        ("no-id", {k: v for k, v in FORM.items() if k != "id"}, ""),
        ("submission-access", FORM | {"form": {"submissionAccess": "everyone"}}, "f"),
        ("unreadable", FORM | {"form": {"public": "yes"}}, "f")]:
    scen("room-undo-share-" + label, {"blocks": [{"id": "p", "type": "paragraph", "data": {"text": "P"}}, database(view)]}, [
        room(b(c("block.delete", {"id": "db"})), {"ok": True, "state": {"/blocks": {"length": 1}}}),
        room(UNDO, {"ok": False, "code": "APPROVAL_REQUIRED", "committed": 0, "state": {"/blocks": {"length": 1}},
            "result": {"/error/details/approval": {"kind": "database.share", "blockId": "db", "viewId": view_id}}})])
# F16: a step from another lineage than the caller's head.
scen("room-undo-lineage-changed", HIST_SEED, [room(insert("a", "Agent"), {"ok": True}),
    room(UNDO | {"expectRevision": "ffffffffffffffffffffffffffffffff:1"}, {"ok": False, "code": "CONFLICT", "committed": 0, "revision": "",
        "result": {"/error/retryable": True, "/error/message": "The room was reset or reloaded since this step, so it can no longer be undone. Re-read the document."}})])
# F14 and F22: a draining room refuses the edit and the undo, and says a retry may pass.
scen("room-refused-draining", HIST_SEED, [room(insert("a", "Agent"), {"ok": True}), {"run": "drain"},
    room(UNDO | {"expectRevision": "{rev:0}"}, {"ok": False, "code": "APPLY_FAILED", "revision": "", "result": {"/error/retryable": True,
        "/error/details": {"status": "Draining"}, "/error/message": "The room refused the undo (Draining). Nothing was written."}}),
    room(insert("b", "Late"), {"ok": False, "code": "APPLY_FAILED", "revision": "", "result": {"/error/retryable": True,
        "/error/details": {"status": "Draining"}, "/error/message": "The room refused the edit (Draining). Nothing was written."}})])
# T7: every call is a new operation id, so the same batch twice commits twice.
scen("room-same-batch-twice-commits-twice", HIST_SEED, [dict(room(b(c("text.insert", {"id": "p", "at": 0, "text": "x"})), {"ok": True, "committed": 1}), times=2),
    room(b(c("doc.read", {})), {"ok": True, "state": {"/blocks/0/data/text": [{"text": "xxHello"}]}})])

# H17: an undo puts back the edit stamp the block had, not only its data.
scen("room-undo-restores-the-stamp", HIST_SEED, [
    room(replace("p", "One"), {"ok": True, "state": {"/blocks/0/lastEditedBy": "agent-b"}}, actor={"id": "agent-b", "name": "B"}),
    room(replace("p", "Two"), {"ok": True, "state": {"/blocks/0/lastEditedBy": "agent-cs"}}),
    room(UNDO, {"ok": True, "state": {"/blocks/0/lastEditedBy": "agent-b", "/blocks/0/data/text": [{"text": "One"}]}})])

def clean(node):
    if isinstance(node, dict):
        return {k: clean(v) for k, v in node.items() if not (k == "code" and v is None) and not (k == "actor" and v is None)}
    if isinstance(node, list):
        return [clean(v) for v in node]
    return node
for name, s in S.items():
    with open(os.path.join(root, name + ".json"), "w") as f:
        json.dump(clean(s), f, indent=2, ensure_ascii=False)
        f.write("\n")
print(len(S))
