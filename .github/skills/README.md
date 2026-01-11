# Skills Library

This directory contains skills for GitHub Copilot, inspired by [obra/superpowers](https://github.com/obra/superpowers).

## What are Skills?

Skills are structured workflow guides that encode proven approaches to common development tasks. They prevent common mistakes by providing:

- **When to use** - Clear triggers for the skill
- **Process** - Step-by-step guidance
- **Anti-patterns** - What NOT to do
- **Verification** - How to know it's done

## Available Skills

| Skill | Description |
|-------|-------------|
| [using-skills](./using-skills/SKILL.md) | Introduction to the skills system |
| [brainstorming](./brainstorming/SKILL.md) | Socratic design before implementation |
| [test-driven-development](./test-driven-development/SKILL.md) | RED-GREEN-REFACTOR cycle |
| [systematic-debugging](./systematic-debugging/SKILL.md) | 4-phase root cause analysis |
| [writing-plans](./writing-plans/SKILL.md) | Create detailed implementation plans |
| [executing-plans](./executing-plans/SKILL.md) | Execute plans with checkpoints |
| [verification-before-completion](./verification-before-completion/SKILL.md) | Ensure work is actually done |
| [code-review](./code-review/SKILL.md) | Preparing and receiving reviews |

## How It Works

1. The `copilot-instructions.md` file includes a skills bootstrap that:
   - Lists all available skills
   - Instructs Copilot to check for relevant skills before each task
   - Requires skills to be followed when they apply

2. Each skill lives in its own directory with a `SKILL.md` file containing:
   - YAML frontmatter with name and description
   - When to use the skill
   - The process to follow
   - Anti-patterns to avoid
   - Verification checklist

## Skill Format

```markdown
---
name: skill-name
description: Use when [trigger] - [what it does]
---

# Skill Name

## Overview
[Core principle]

## When to Use
[Triggers]

## The Process
[Steps]

## Anti-Patterns
[What not to do]

## Verification Checklist
[How to know it's done]
```

## Philosophy

- **Process over guessing** - Follow proven workflows
- **Test-Driven Development** - Write tests first
- **Verify before claiming done** - Evidence over claims
- **Simplicity** - Reduce complexity as primary goal

## Adding New Skills

1. Create a new directory: `.github/skills/[skill-name]/`
2. Add `SKILL.md` with proper frontmatter
3. Update `copilot-instructions.md` to list the new skill
4. Update this README

## Credits

Inspired by [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent.
