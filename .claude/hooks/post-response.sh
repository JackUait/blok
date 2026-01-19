#!/bin/bash
# Hook script to run refactor skill after response completes
# Only suggests refactor if context is getting large (>50% estimated)

# Read stdin for JSON context
input=$(cat)

# Extract transcript_path from JSON input
transcript_path=$(echo "$input" | grep -o '"transcript_path":[^,}]*' | cut -d'"' -f4)

# Get the project directory from environment
PROJECT_DIR="${CLAUDE_PROJECT_DIR}"

# Estimate context usage by checking transcript file size
# Claude's context window is ~200K tokens, roughly 1 token = 4 chars
# 50% = 100K tokens = ~400K characters
CONTEXT_THRESHOLD=400000

if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    # Get file size in bytes (approximate character count)
    file_size=$(wc -c < "$transcript_path" 2>/dev/null || echo 0)

    # Only suggest refactor if context is over 50%
    if [ "$file_size" -gt "$CONTEXT_THRESHOLD" ]; then
        cat <<EOF
Context is at ~$(( (file_size * 100) / CONTEXT_THRESHOLD / 2 ))% capacity. Consider running /compact to reduce size, then /refactor to review recent changes.
EOF
        exit 0
    fi
fi

# For smaller context, just suggest refactor
cat <<EOF
Run /refactor to review recent changes.
EOF

exit 0
