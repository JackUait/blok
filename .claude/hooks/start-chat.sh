#!/bin/bash
# Hook script to capture baseline git state at session start
# Stores initial state so refactor can identify session-only changes

set -e

# Configuration
DEBUG=${REFACTOR_HOOK_DEBUG:-0}
# STATE_FILE=".claude/hooks/session-state.json"
LOG_FILE=".claude/hooks/start-chat.log"

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        mkdir -p "$(dirname "$LOG_FILE")"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
    fi
}

# Read JSON input from stdin (required by hook protocol)
input=$(cat)

# Extract working directory from JSON
working_dir=$(echo "$input" | grep -o '"working_directory":[^,}]*' | cut -d'"' -f4)
if [ -z "$working_dir" ]; then
    working_dir="$CLAUDE_PROJECT_DIR"
fi

if [ -z "$working_dir" ]; then
    debug_log "No working directory found"
    exit 0
fi

cd "$working_dir" 2>/dev/null || exit 0

# Check if this is a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    debug_log "Not a git repository"
    exit 0
fi

# Capture baseline state
before_files=$(git diff --name-only HEAD 2>/dev/null || echo "")
before_staged=$(git diff --name-only --staged 2>/dev/null || echo "")
current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
head_commit=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Create state directory
mkdir -p "$(dirname "$STATE_FILE")"

# Save state as JSON
cat > "$STATE_FILE" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "working_dir": "$working_dir",
  "branch": "$current_branch",
  "head_commit": "$head_commit",
  "modified_files": [
$(echo "$before_files" | sed 's/$/,/' | sed '$ s/,$//' | sed 's/^/    "/' | sed 's/$/"/' | tr '\n' '\n' | sed '$ s/,$//')
  ],
  "staged_files": [
$(echo "$before_staged" | sed 's/$/,/' | sed '$ s/,$//' | sed 's/^/    "/' | sed 's/$/"/' | tr '\n' '\n' | sed '$ s/,$//')
  ]
}
EOF

debug_log "Session state captured: $current_branch@$head_commit"
debug_log "Modified files: $(echo "$before_files" | wc -l | tr -d ' ')"
