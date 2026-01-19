#!/bin/bash
# Hook script to auto-trigger /refactor after code changes
# Triggers /compact first if context exceeds threshold

set -e

# Configuration (override via environment)
CONTEXT_THRESHOLD_DEFAULT=60  # percentage
CONTEXT_THRESHOLD=${REFACTOR_CONTEXT_THRESHOLD:-$CONTEXT_THRESHOLD_DEFAULT}
DRY_RUN=${REFACTOR_HOOK_DRY_RUN:-0}
DEBUG=${REFACTOR_HOOK_DEBUG:-0}
LOG_FILE=".claude/hooks/refactor-hook.log"

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        mkdir -p "$(dirname "$LOG_FILE")"
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
