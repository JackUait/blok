#!/bin/bash
# Hook script to auto-trigger /refactor after EVERY response
# MANDATORY: Always runs refactor after agent completes any work

set -e

# Configuration (override via environment)
DEBUG=${REFACTOR_HOOK_DEBUG:-0}
LOG_FILE=".claude/hooks/refactor-hook.log"
NOTIFICATION_ENABLED=${NOTIFICATION_ENABLED:-1}

# MANDATORY REFACTOR: Always true, never skip
ALWAYS_REFACTOR=${ALWAYS_REFACTOR:-1}

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        mkdir -p "$(dirname "$LOG_FILE")"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
    fi
}

# Read JSON input from stdin (required by hook protocol)
input=$(cat)

# Extract paths from JSON for logging
working_dir=$(echo "$input" | grep -o '"working_directory":[^,}]*' | cut -d'"' -f4)
if [ -z "$working_dir" ]; then
    working_dir="$CLAUDE_PROJECT_DIR"
fi

# Send notification that agent is done
if [ "$NOTIFICATION_ENABLED" = "1" ]; then
    osascript -e 'display notification "Agent finished - awaiting your input" with title "Claude Code" sound name "Glass"' 2>/dev/null || true
    debug_log "Agent complete notification sent"
fi

# MANDATORY: Always output refactor directive
# No conditions, no early exits, no exceptions
debug_log "MANDATORY: Triggering refactor"

# Always output the directive - agent must run /refactor
cat <<'EOF'

<!-- MANDATORY: Run /refactor now -->
<system-reminder>MANDATORY: Run /refactor command to review and clean up code changes from this session.</system-reminder>

EOF
