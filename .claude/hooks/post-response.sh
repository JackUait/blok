#!/bin/bash
# Hook script to auto-trigger /refactor when agent stops
# Runs on Stop event - triggers refactor to review code changes

set -e

# Configuration (override via environment)
DEBUG=${REFACTOR_HOOK_DEBUG:-0}
LOG_FILE=".claude/hooks/refactor-hook.log"
NOTIFICATION_ENABLED=${NOTIFICATION_ENABLED:-1}
SKIP_REFACTOR=${SKIP_REFACTOR:-0}

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

# Send notification that agent is done
if [ "$NOTIFICATION_ENABLED" = "1" ]; then
    osascript -e 'display notification "Agent finished - awaiting your input" with title "Claude Code" sound name "Glass"' 2>/dev/null || true
    debug_log "Agent complete notification sent"
fi

# Allow skipping refactor via environment variable
if [ "$SKIP_REFACTOR" = "1" ]; then
    debug_log "Refactor skipped (SKIP_REFACTOR=1)"
    exit 0
fi

# Check for actual code changes before triggering refactor
if [ -n "$working_dir" ]; then
    cd "$working_dir" 2>/dev/null || exit 0
    
    if git rev-parse --git-dir > /dev/null 2>&1; then
        # Get modified files (excluding hooks, node_modules, etc.)
        changed_files=$(git diff --name-only HEAD 2>/dev/null | grep -v -E '^(\.claude/|node_modules/|dist/|\.git/|coverage/)' || true)
        
        if [ -z "$changed_files" ]; then
            debug_log "No code changes detected - skipping refactor"
            exit 0
        fi
        
        debug_log "Code changes detected: $(echo "$changed_files" | wc -l | tr -d ' ') files"
    fi
fi

debug_log "Triggering /refactor"

# Output the refactor command - Claude Code will execute this
echo "/refactor"
