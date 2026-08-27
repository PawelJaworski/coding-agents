---
name: session-memory
description: >
   Maintain a long-lived memory — a single memory.md at the project root holding the current goal, a replaceable point-by-point plan (todo list), and one-line digests of finished steps. Use when the active model has a small context window (roughly under 100k tokens — local models, Ollama, LM Studio, MLX, llama.cpp, GGUF), when the user says "remember my plan", "keep track", "continue where I left off", "long-lived/session memory", or when work must survive restarts, compaction, or subagents. Goal: stop small-context models from blowing their window, re-planning endlessly, or losing their place.
---

# Session Memory

One small file, `memory.md` at the project root, is the **single source of
truth** for where the work stands. Read it, obey it, update it, keep it tiny.
Assume every future turn, restart, and subagent starts with **zero memory**.

## The memory file

Find `memory.md` by walking up from the cwd to the worktree root (same search
opencode uses for `opencode.json`). If it is missing, create it (see
**Starting fresh**). It is the **only** persistent state — never create
additional notes or state files.

### Exact format

```markdown
# Memory
LAST UPDATED: <YYYY-MM-DD HH:MM>

GOAL: <one line — the current objective>

DECISIONS:
- <bullets, only decisions still relevant; drop used-up ones>

PLAN: (replace wholesale on any change — never accumulate)
[x] <step> — <1-line digest>
[~] <step> — current step
[ ] <step>
[ ] <step>

BACKLOG:
- <parked or displaced steps, or empty>

DONE:
- <finished-step digests, newest last, max 5; older ones folded into a single line>
```

### Size budget — hard cap: 45 lines, ~2 KB

If the file would exceed it, compress: fold the oldest DONE digests into one
line, drop stale DECISIONS, shorten step labels. Never let `memory.md` grow
until reading it costs more than it saves.

## Rules — apply in this order, every turn

1. **Read first.** Before any other action, read `memory.md`.
2. **Resume, don't re-plan.** If PLAN exists and one step is `[~]`, continue
   exactly there. Do not derive a new plan. Re-planning is the most common
   thinking loop with small models — suppress it.
3. **One point at a time.** Mark the current step `[~]`, execute **only it**,
   update the file, then either move to the next step or report and stop.
   Never try to execute the whole plan in one turn.
4. **Replace, never grow.** On any plan change, rewrite the PLAN block with the
   current steps only; move dropped steps to BACKLOG, one line each. Never keep
   an old PLAN section.
5. **Digest every finish.** When a step completes: mark it `[x]`, append a
   one-line digest (what changed / result, not what you did) to DONE.
6. **Persist before you stop.** End of every turn: `LAST UPDATED` must be
   current and the file must reflect reality. Assume the very next message has
   no memory.
7. **Stuck = stop.** If the same step fails twice in a row: record what was
   tried in DECISIONS, mark it `[~] <step> — STUCK`, and stop to ask the user.
   Do not retry a third time, re-derive the plan, or loop.
8. **Subagent handoff.** When delegating a step with the Task tool, point the
   subagent at `<project-root>/memory.md`, tell it to read it first and apply
   these same rules, and update it on completion.
9. **Context hygiene throughout.** Do not re-read files you already hold that
   didn't change; trim tool outputs with targeted reads/greps. Every token
   spent is a token of the window gone.

## Starting fresh (no memory.md exists)

1. Read only enough to understand the request (one focused pass).
2. Scaffold `memory.md`: GOAL = the request, DECISIONS empty, DONE empty.
3. Draft PLAN: max ~6 concrete steps, front-load the riskiest or most unknown
   one. If the user gave steps, use theirs verbatim.
4. Follow Rules onward.

## Plan change protocol (user redirects the work)

- Update GOAL if it changed.
- Rewrite PLAN to the new steps (max ~6).
- Park displaced steps in BACKLOG, one line each.
- Keep finished digests in DONE.
- Mark the first new step `[~]`, execute it, persist.

## Checklist before claiming done

- `memory.md` present, ≤45 lines, `LAST UPDATED` fresh.
- Every finished step has a DONE digest.
- PLAN holds only current steps; nothing duplicated.
- No loose notes files created.