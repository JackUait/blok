---
name: git-clean-worktrees
description: Use when git worktrees have accumulated from feature branches and you need to remove them to reclaim disk space or clean up after completed work
---

# Git Clean Worktrees

## Overview

Removes all git worktrees except the main one. Worktrees are parallel working directories created by `git worktree add` for isolated feature branch development. They accumulate over time and consume disk space.

## When to Use

**Use this when:**
- Feature branches are merged and deleted
- Disk space is low from accumulated worktrees
- Cleaning up after completing feature work
- Resetting to a clean development state

**DO NOT use when:**
- Active feature branches are still in progress
- You need to preserve worktree state for debugging
- Worktrees contain uncommitted changes you need

## Quick Reference

```bash
# Remove all worktrees except main
git worktree list | grep -v '/main$' | awk '{print $1}' | xargs -I {} git worktree remove {}
```

## Implementation

The skill leverages `git worktree remove` which safely removes the worktree directory and metadata. Git prevents removal if there are uncommitted changes.

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Running with uncommitted work | Git refuses removal | Commit or stash changes first |
| Removing wrong worktree | Lost work | Always check `git worktree list` first |
| Assuming main branch name | Misses worktrees if main is `master` | Check actual main branch name |

## Real-World Impact

Worktrees can consume hundreds of MB per branch. Cleaning up 10 old feature worktrees can reclaim several GB of disk space.
