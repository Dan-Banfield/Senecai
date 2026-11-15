This workflow eliminates slow, buggy AI coding loops by splitting *thinking, building, and reviewing* into isolated context windows—preventing build logs and guesswork from polluting the main session or biasing code reviews.

---

## 1. How It Works (The 4-Stage Loop)

| Stage | Mechanism | What Happens |
| --- | --- | --- |
| *1. Interview* | ⁠ AskUserQuestion ⁠ → ⁠ SPEC.md ⁠ | Claude asks 3–5 targeted questions about inputs, edge cases, and performance before writing code, locking answers into ⁠ SPEC.md ⁠. |
| *2. Plan* | Read-only ⁠ Explore ⁠ subagents | Claude maps relevant files in isolated contexts and presents a step-by-step plan split into parallel tracks for your approval. |
| *3. Orchestrate* | Parallel ⁠ implementer ⁠ subagents | Independent modules are built simultaneously in separate context windows; verbose test/build logs stay out of the main thread. |
| *4. Scrutinize* | Read-only ⁠ scrutinizer ⁠ subagent | An adversarial reviewer (⁠ Write ⁠/⁠ Edit ⁠ disabled) inspects ⁠ git diff ⁠, runs typechecks/tests, hunts for lag and logic bugs, and forces fixes until it returns ⁠ PASS ⁠. |

---

## 2. One-Time Global Setup

Create the directories (⁠ mkdir -p ~/.claude/agents ~/.claude/skills/spec-build ⁠) and add these four files so the workflow works in every repo:

*1. Pre-approve safe read/test commands (⁠ ~/.claude/settings.json ⁠)*
Prevents background subagents from stalling on permission prompts while keeping destructive commands blocked.

⁠ json
{
  "permissions": {
    "allow": [
      "Read", "Grep", "Glob", "Agent",
      "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)",
      "Bash(npm run test*)", "Bash(npm run lint*)", "Bash(npm run typecheck*)",
      "Bash(npx tsc*)", "Bash(bun test*)", "Bash(cargo test*)", "Bash(pytest*)"
    ],
    "deny": ["Bash(rm -rf*)", "Bash(git push --force*)"]
  }
}

 ⁠

*2. Parallel Builder Subagent (⁠ ~/.claude/agents/implementer.md ⁠)*

⁠ markdown
---
name: implementer
description: Focused builder for self-contained modules once a plan or SPEC.md is approved.
tools: Read, Write, Edit, Grep, Glob, Bash
model: inherit
maxTurns: 25
---
Execute your assigned module from the approved plan. Read only relevant files plus `CLAUDE.md`/`SPEC.md`. Write strongly typed code matching repo conventions, run targeted tests/typechecks, and return a concise summary of touched files and interfaces.

 ⁠

*3. Adversarial QA Subagent (⁠ ~/.claude/agents/scrutinizer.md ⁠)*

⁠ markdown
---
name: scrutinizer
description: Adversarial code reviewer and QA gate. Run after any implementation to audit git diff, tests, and performance.
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: sonnet
maxTurns: 15
---
Audit `git status` and `git diff`, run the project's typechecker, linter, and tests, and inspect line-by-line for logic bugs, race conditions, UI/thread lag, memory leaks, and `SPEC.md` compliance. Output **VERDICT: PASS** or **FAIL**, listing exact `file:line` blockers and required fixes.

 ⁠

*4. The ⁠ /spec-build ⁠ Slash Command (⁠ ~/.claude/skills/spec-build/SKILL.md ⁠)*

⁠ markdown
---
name: spec-build
description: Run the Interview -> Plan -> Orchestrate -> Scrutinize engineering workflow.
---
Execute strictly in order for: $ARGUMENTS
1. **Interview:** Use `AskUserQuestion` in concise batches until zero ambiguity remains, write `SPEC.md`, and get user confirmation. Do not write code yet.
2. **Plan:** Use read-only `Explore` subagents to map the codebase, then present a parallelized implementation plan for user approval.
3. **Orchestrate:** Delegate independent tracks to parallel `implementer` subagents while keeping sequential glue code scoped.
4. **Scrutinize:** Invoke `scrutinizer` on the diff. Fix every blocker and re-run `scrutinizer` until it returns `PASS` before reporting completion.

 ⁠

(Note: If you use ⁠ /effort ultracode ⁠, turn on **Dynamic workflows* inside ⁠ /config ⁠ first; otherwise ⁠ /effort xhigh ⁠ works out of the box.)*

---

## 3. Day-to-Day Usage

•⁠  ⁠*Starting a new project:*
1.⁠ ⁠Scaffold your repo, launch Claude Code, and run ⁠ /init ⁠.
2.⁠ ⁠Trim ⁠ CLAUDE.md ⁠ to *<150 lines* (exact test/build commands, architecture rules, and performance invariants) and ⁠ git commit ⁠.


•⁠  ⁠*Onboarding an existing project:*
1.⁠ ⁠Run ⁠ /init ⁠ and trim ⁠ CLAUDE.md ⁠ (include a *Frozen Zones* section for working code not to touch).
2.⁠ ⁠Run a read-only audit: "Use parallel Explore subagents to audit the codebase for bugs, async errors, lag, and dead code. Have scrutinizer rank findings in AUDIT.md."
3.⁠ ⁠Delete low-priority items in ⁠ AUDIT.md ⁠, run ⁠ /clear ⁠, have parallel ⁠ implementer`s + `scrutinizer ⁠ fix the Critical/High blockers, delete ⁠ AUDIT.md ⁠, and ⁠ git commit ⁠.


•⁠  ⁠*Building every feature:
1.⁠ ⁠Run ⁠ /clear ⁠ so previous debugging noise never carries over.
2.⁠ ⁠Run ⁠ /spec-build <what you want to build> ⁠.
3.⁠ ⁠Answer the interview prompts, approve the plan, verify the ⁠ PASS ⁠ result in your app, and ⁠ git commit ⁠.
