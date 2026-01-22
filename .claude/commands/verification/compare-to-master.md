# Compare to Master

Use when verifying refactoring didn't introduce bugs, behavior differs between branches, or systematic-debugging requires side-by-side comparison.

## Purpose

Compare how `$ARGUMENTS` behaves in your current branch vs master to detect regressions introduced as part of the changes made to this branch.

## Quick Start

```bash
/systematic-debugging compare how <feature> behaves after changes in this branch vs master
```

## Process

1. **Create worktrees** (isolated git workspaces):
   ```bash
   # Master worktree - only create if not exists
   if [ ! -d "../blok-master" ]; then
     git worktree add ../blok-master master
   fi

   # Current branch worktree - unique name from branch name
   BRANCH_NAME=$(git branch --show-current)
   WORKTREE_NAME="../blok-$(echo $BRANCH_NAME | sed 's/\//-/g')"
   git worktree add "$WORKTREE_NAME" "$BRANCH_NAME"
   ```

2. **Start dev servers** in parallel on available ports:
   ```bash
   # Terminal 1 - Master
   cd ../blok-master && yarn serve

   # Terminal 2 - Current branch
   cd "$WORKTREE_NAME" && yarn serve
   ```
   The dev server will automatically find an available port (3303, 3304, ...)

3. **Run systematic-debugging** with `/dev-browser`:
   - Check the terminal output for the actual ports assigned
   - Master: typically http://localhost:3303/
   - Current: typically http://localhost:3304/

4. **Document differences** in behavior


## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Recreating master worktree every time | Use the existence check - master persists across sessions |
| Hardcoding branch name | Use `git branch --show-current` for dynamic naming |
| Assuming specific ports | Check terminal output - dev server auto-selects available ports |
| Removing master worktree | Keep master for reuse, only remove current branch worktree |