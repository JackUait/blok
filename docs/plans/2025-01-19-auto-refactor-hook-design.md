# Auto-Refactor Hook Design

**Date:** 2025-01-19
**Status:** Design Complete

## Overview

Automatically trigger `/refactor` after code changes, with `/compact` when context exceeds 60% capacity. The hook runs after every response via `post-response.sh`, checks for actual code changes via git, and outputs auto-executable command syntax.

## Goals

- Review and clean up code changes automatically after they're made
- Keep conversation context manageable by compacting when needed
- Only run when actual code changes occur (not on every chat message)
- Work seamlessly without requiring manual invocation

## Implementation

### Hook: `.claude/hooks/post-response.sh`

```bash
#!/bin/bash
set -e

# Configuration (override via environment)
CONTEXT_THRESHOLD_DEFAULT=60  # percentage
CONTEXT_THRESHOLD=${REFACTOR_CONTEXT_THRESHOLD:-$CONTEXT_THRESHOLD_DEFAULT}
DRY_RUN=${REFACTOR_HOOK_DRY_RUN:-0}
DEBUG=${REFACTOR_HOOK_DEBUG:-0}
LOG_FILE=".claude/hooks/refactor-hook.log"

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
    fi
}

# Read JSON input from stdin
input=$(cat)

# Extract paths from JSON
transcript_path=$(echo "$input" | grep -o '"transcript_path":[^,}]*' | cut -d'"' -f4)
working_dir=$(echo "$input" | grep -o '"working_directory":[^,}]*' | cut -d'"' -f4)

if [ -z "$working_dir" ]; then
    working_dir="$CLAUDE_PROJECT_DIR"
fi

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
    debug_log "No valid transcript_path"
    exit 0
fi

# Calculate context usage
# Claude context ~200K tokens, 1 token ≈ 4 chars
# 60% threshold = 120K tokens ≈ 480K chars
CONTEXT_MAX_CHARS=800000  # 200K tokens * 4
threshold_chars=$(( CONTEXT_MAX_CHARS * CONTEXT_THRESHOLD / 100 ))

file_size=$(wc -c < "$transcript_path" 2>/dev/null || echo 0)
context_percent=$(( file_size * 100 / CONTEXT_MAX_CHARS ))

debug_log "Context: ${context_percent}% (${file_size} chars), threshold: ${CONTEXT_THRESHOLD}%"

# Check for code changes via git
cd "$working_dir" 2>/dev/null || exit 0

if ! git rev-parse --git-dir > /dev/null 2>&1; then
    debug_log "Not a git repository"
    exit 0
fi

# Get modified files (excluding .claude/, node_modules, etc.)
changed_files=$(git diff --name-only HEAD 2>/dev/null | grep -v -E '^(\.claude/|node_modules/|dist/|\.git/)' || true)

if [ -z "$changed_files" ]; then
    debug_log "No code changes detected"
    exit 0
fi

debug_log "Code changes: $(echo "$changed_files" | wc -l | tr -d ' ') files"

# Output commands for auto-execution
if [ "$file_size" -gt "$threshold_chars" ]; then
    debug_log "Context exceeds threshold - triggering compact + refactor"
    echo "<!-- /compact -->"
    echo "<!-- /refactor -->"
else
    debug_log "Context within threshold - triggering refactor only"
    echo "<!-- /refactor -->"
fi
```

### Configuration Options

| Variable | Default | Purpose |
|----------|---------|---------|
| `REFACTOR_CONTEXT_THRESHOLD` | 60 | Context % to trigger compact first |
| `REFACTOR_HOOK_DRY_RUN` | 0 | Set to 1 to disable execution (logging only) |
| `REFACTOR_HOOK_DEBUG` | 0 | Set to 1 to enable debug logging |

### Command Syntax

The hook outputs commands using HTML comment syntax:
```html
<!-- /compact -->
<!-- /refactor -->
```

Claude Code interprets this as auto-executable commands in hook output.

## Behavior

| Context | Code Changes | Hook Output |
|---------|--------------|-------------|
| < 60% | Yes | `<!-- /refactor -->` |
| ≥ 60% | Yes | `<!-- /compact -->` then `<!-- /refactor -->` |
| Any | No | (silent, no output) |

## File Filtering

The hook ignores changes to:
- `.claude/` directory
- `node_modules/`, `dist/`, build artifacts
- `.git/` directory

This ensures refactor only runs on actual code changes, not configuration or hook file modifications.

## Testing

### Manual Testing

Disable hook temporarily during development:
```bash
chmod -x .claude/hooks/post-response.sh
```

### Dry Run Mode
```bash
export REFACTOR_HOOK_DRY_RUN=1
export REFACTOR_HOOK_DEBUG=1
```

Check log output:
```bash
cat .claude/hooks/refactor-hook.log
```

### Test Scenarios

1. **Fresh session (no changes)**: No hook output
2. **Small session with changes (< 60%)**: `/refactor` only
3. **Large session with changes (> 60%)**: `/compact` then `/refactor`
4. **Changes only to ignored files**: No output
5. **Missing transcript path**: Graceful exit with debug log

## Integration with Existing Refactor Command

The hook doesn't duplicate the logic in `.claude/commands/refactor.md`. It simply triggers it at appropriate times. The refactor command handles:
- Establishing git baseline
- Identifying session changes
- Analyzing code quality
- Making fixes

## Notes

- The hook runs on **every response** but exits silently if no code changes
- Context estimation is approximate (based on file size)
- The `/compact` command is built into Claude Code
- Hook errors are logged but don't interrupt the conversation
