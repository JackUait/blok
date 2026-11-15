#!/usr/bin/env python3
"""Serialize Blok checks/builds on this Mac and keep worker counts bounded."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = {
    "desktop-test": (ROOT / "desktop", ["npm", "test", "--", "--maxWorkers=1", "--no-file-parallelism"]),
    "core-test": (ROOT, ["node", "node_modules/.bin/vitest", "run", "--project=unit", "--maxWorkers=1", "--no-file-parallelism"]),
    "web": (ROOT / "desktop", ["npm", "run", "build"]),
    "runtime": (ROOT, ["node", "scripts/build-server-runtime.mjs"]),
    "tauri": (ROOT / "desktop", ["npm", "run", "tauri", "--", "build", "--bundles", "app", "--config", '{"build":{"beforeBuildCommand":""}}']),
}

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("Usage: python3 scripts/low-memory.py {desktop-test|core-test|web|runtime|tauri} [test files]", file=sys.stderr)
        return 2
    mode, files = sys.argv[1], sys.argv[2:]
    if files and mode not in ("desktop-test", "core-test"):
        print("Build modes accept no extra arguments.", file=sys.stderr)
        return 2
    if mode == "core-test" and not files:
        print("Name the core test files to run; the global suite is deliberately excluded.", file=sys.stderr)
        return 2
    if any(item.startswith("-") or not item.endswith((".test.ts", ".spec.ts")) for item in files):
        print("Pass test file paths only; worker limits cannot be overridden.", file=sys.stderr)
        return 2
    lock_path = Path(tempfile.gettempdir()) / f"blok-heavy-{os.getuid()}.lock"
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another Blok check/build is running. Wait for it to finish.", file=sys.stderr)
            return 1
        env = dict(os.environ)
        env.update(NODE_OPTIONS="--max-old-space-size=2048", CARGO_BUILD_JOBS="1",
                   RAYON_NUM_THREADS="2", GOMAXPROCS="2", GOMEMLIMIT="512MiB")
        directory, command = COMMANDS[mode]
        print(f"One job at a time: {mode}; Node heap 2 GiB; test/Cargo workers 1.", flush=True)
        try:
            return subprocess.run(command + files, cwd=directory, env=env, check=False).returncode
        except KeyboardInterrupt:
            return 130

if __name__ == "__main__":
    sys.exit(main())
