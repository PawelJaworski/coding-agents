---
name: skill-creator
description: Create new opencode skills and improve existing ones. Use whenever the user wants to author a SKILL.md, scaffold a skill from scratch, turn a repeated workflow into a reusable skill, edit or refactor an existing skill, fix a skill that never triggers, or tune a skill's description for better triggering. Also use when the user says "make this a skill", "write a skill for X", or mentions .opencode/skills.
---

# Skill Creator

A skill for authoring and iterating on **opencode skills**. A skill is a folder
containing a `SKILL.md` file (plus optional bundled resources) that injects
focused, reusable instructions into a session when its task comes up.

The job here is to figure out where the user is and help them move forward:

- They have a vague idea ("I want a skill for X") → help narrow it, then draft.
- They have a workflow in the current conversation ("turn this into a skill") →
  extract the steps from history and capture them.
- They have a draft already → go straight to reviewing and tightening it.
- Their skill never fires → jump to **Description & triggering**.

Stay flexible. If the user just wants to "vibe and write it", do that. Don't
force a heavy process onto a simple skill.

> opencode loads config and skills once at startup and does **not** hot-reload.
> After creating or editing a skill, tell the user to **quit and restart
> opencode** before the skill will be available in a session.

---

## How opencode skills work (the facts you must get right)

opencode scans for `**/SKILL.md` and surfaces each skill's `name` +
`description` to the model. When a task matches, the model calls the `skill`
tool, which injects the full `SKILL.md` body into the conversation.

**Location** — the folder name must equal the skill `name`. opencode searches,
in order, walking up from the cwd to the git worktree root for project paths:

| Scope   | Path                                                                 | Availability        |
| ------- | -------------------------------------------------------------------- | ------------------- |
| Project | `.opencode/skills/<name>/SKILL.md`                                   | this repo only      |
| Global  | `~/.config/opencode/skills/<name>/SKILL.md`                          | every project       |
| Compat  | `.claude/skills/`, `~/.claude/skills/`, `.agents/skills/`, `~/.agents/skills/` | also auto-loaded    |

Prefer `.opencode/skills/` for new opencode skills. Ask the user which scope
they want if it isn't obvious: project scope for anything tied to a specific
codebase, global for personal cross-project workflows.

**Frontmatter** — YAML between `---` fences:

```markdown
---
name: my-skill
description: One or two sentences — what it does AND when to trigger it.
---
```

- `name` (**required**): lowercase alphanumeric with single-hyphen separators,
  ≤64 chars, no leading/trailing `-`, no `--`, and **identical to the folder
  name**. Regex: `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `description` (**required**, 1–1024 chars): skills without one are filtered
  out and never shown to the model. This is the *only* thing the model sees when
  deciding whether to invoke the skill, so it carries the entire triggering
  burden. See **Description & triggering** below.
- Optional: `license`, `compatibility`, `metadata` (a flat string→string map).
  Unknown frontmatter fields are ignored.

Everything else is the markdown body. `SKILL.md` must be spelled in all caps, or
opencode won't discover it.

**Three-level loading (progressive disclosure)** — design around it:

1. **Frontmatter** (`name` + `description`): always in context for every skill.
   Keep it tight.
2. **`SKILL.md` body**: injected only when the skill triggers. Aim for under
   ~500 lines.
3. **Bundled resource files**: read on demand from within the body. Effectively
   unlimited, since they only enter context when the body tells the model to
   read them.

The point: put the always-relevant workflow in the body, and push large
reference material (long tables, schemas, per-variant details) into separate
files the body points to. The user chose a single-file skill here unless they
say otherwise — but keep the principle in mind, and if a body balloons past
~500 lines, that's the signal to split.

**Gating (optional)** — skills can be allow/deny/ask-gated per name or pattern
via `permission.skill` in `opencode.json`, globally or per agent (e.g.
`"internal-*": "deny"`). If the user wants a skill restricted to certain agents
or behind a confirmation prompt, that lives in config, not in the skill itself —
so loading the `customize-opencode` skill is the right move for those edits.

---

## Creating a skill

### 1. Capture intent

The current conversation may already contain the workflow (the user did a thing
manually and now wants it reusable). If so, **mine the history first** — the
tools and commands used, the order of steps, the corrections the user made,
the input and output formats — and only ask the user to fill gaps. Confirm the
captured workflow before writing.

Otherwise, pin down four things:

1. **What** should this skill let the model do?
2. **When** should it trigger — what phrases, file types, or situations?
3. **What output** does success look like (a file, a code change, a command
   sequence, a report shape)?
4. **Verifiable?** Skills with objective outputs (code generation, file
   transforms, fixed command sequences, data extraction) are worth testing
   (step 4 below). Skills with subjective outputs (writing tone, naming style)
   usually aren't — eyeballing is enough. Suggest a sensible default; let the
   user decide.

### 2. Interview and research

Ask about edge cases, exact input/output formats, example files, success
criteria, and dependencies *before* drafting. A skill is only useful if it
works across many future invocations, not just today's example — so dig for the
general shape, not the one-off.

If research helps (reading existing code, conventions, similar skills, library
docs), use the `task` tool with the `explore` agent to gather it in parallel
rather than spending the user's turns on it. Come back with context, not
questions you could have answered yourself.

For a codebase-specific skill, **read the neighbors**: look at how the relevant
part of the repo is structured and at any sibling skills, and match their
conventions. (The two skills already in `.opencode/skills/` here —
`create-test-ability` and `flyway-migration` — are good local style references:
imperative steps, concrete paths, project-specific commands.)

### 3. Write the SKILL.md

Create `.opencode/skills/<name>/SKILL.md` (or the global path). Fill in:

- **name** — the identifier; folder name must match.
- **description** — what it does + when to use it. All "when to use" guidance
  lives here, not in the body. See **Description & triggering**.
- **body** — the instructions.

#### Body writing patterns

**Use the imperative.** "Read the source class", not "You should read the source
class" or "The model will read…". It reads as a procedure.

**Explain the *why*, not just the *what*.** Today's models are capable and have
good theory of mind; when they understand the reason behind a step, they handle
cases the skill never explicitly anticipated. A wall of `ALWAYS`/`NEVER` in
all-caps is a yellow flag — it usually means the reasoning wasn't transmitted.
Reserve hard mandates for the few places a wrong move is genuinely costly
(destructive commands, irreversible writes, strict output contracts), and
explain even those.

**Pin down output formats explicitly** when the shape matters:

```markdown
## Report structure
Use this exact template:
# [Title]
## Summary
## Findings
## Recommendations
```

**Show examples** with input → output framing:

```markdown
## Commit message format
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

**Embed live shell output** only if you've confirmed the running opencode
build supports it. Some skill loaders expand a `!`-prefixed backtick command
at injection time:

````markdown
Existing ability files in the project:
!`find src/test/java -name "*Ability.java" | sort`
````

This is **not documented** as an opencode skill feature, so don't rely on it
blindly — verify it actually expands in the user's setup first. When in doubt,
have the skill body instruct the model to *run* the command with the `bash` tool
instead, which always works. Either way, keep such commands cheap, fast, and
read-only.

**Point to bundled resources** (if the skill grows to need them) with explicit
read-this-when guidance, e.g. "For the full column list, read
`references/schema.md`." For any reference file over ~300 lines, give it a table
of contents so the model can jump.

#### Writing style

Write a draft, then reread it with fresh eyes and cut what isn't pulling its
weight. Keep it general rather than overfit to one example. Prefer prose that
teaches the task over a brittle checklist that only covers the cases you thought
of.

#### Principle of least surprise

A skill's behavior must match what its description implies. Don't build skills
that hide malware, exfiltrate data, or do something materially different from
what they claim. (Benign framing like "act as a code reviewer" is fine.)

### 4. Test it (for skills with verifiable output)

Skip this for subjective skills. For everything else, sanity-check the skill
*before* declaring it done, because a skill that reads well can still fail in
practice.

Come up with **2–3 realistic prompts** — phrased the way a real user would
actually ask, not idealized restatements of the skill's purpose. Show them to
the user: *"Here are a few prompts I'd like to test the skill against — do these
look right, or do you want to add others?"*

Then run each one with the `task` tool. opencode subagents start with a fresh
context and see the project's skills, so a subagent is a clean stand-in for a
real session:

- Give the subagent (`general` agent) the test prompt as if it were the user.
- Tell it explicitly to use the skill, and where outputs should go.
- Have it report what it produced and which steps it followed.

Optionally run the same prompt **without** mentioning the skill, to check
whether the description triggers it on its own — that doubles as a triggering
test (see below).

Read the **transcript**, not just the final output. If the subagent wandered,
wrote throwaway helper scripts, or fought the instructions, that's signal: the
skill is pushing it the wrong way. If every run independently wrote the same
helper, that's a strong hint to bundle that helper as a `scripts/` file and
have the skill call it instead of reinventing it each time.

Show the user the outputs and get their read before you start rewriting.

### 5. Improve and iterate

This is the core loop. Apply what the test runs and the user's feedback
revealed, then run the prompts again.

- **Generalize from feedback.** The user knows their handful of examples cold,
  which makes iteration fast — but the skill has to work on the *next thousand*
  prompts, not just these. Resist fiddly, overfit patches. If an issue is
  stubborn, try reframing: a different metaphor, a different suggested working
  pattern, a clearer explanation of intent. It's cheap to try.
- **Keep it lean.** Cut instructions that don't earn their place. If the skill
  makes the model waste effort, remove the part causing it and rerun.
- **Lead with reasoning over rules.** Terse or frustrated feedback still has a
  real need underneath it — find that need and write the instruction that
  addresses it, rather than bolting on another `MUST`.

Repeat until the user is happy, the outputs are consistently good, or you've
stopped making meaningful progress.

---

## Improving an existing skill

When the user wants to change a skill that already exists:

- **Read it first** and preserve its `name` and folder — renaming breaks any
  references and the user's mental model.
- If the installed copy is read-only (e.g. a global skill you can't edit in
  place), copy it somewhere writable, edit there, and tell the user where the
  updated version is.
- Decide your **baseline for comparison**: when testing improvements, compare
  the new version against the version the user came in with so you can tell
  whether a change actually helped.
- Apply the same draft → test → tighten loop as above.

---

## Description & triggering

The `description` is the entire basis on which opencode decides to invoke a
skill. A perfect body is worthless if the description never fires. Two failure
modes, and both are common:

**Under-triggering** (the frequent one): the skill doesn't activate when it
should. Fixes:

- Front-load the **literal words, file names, and phrases** the user is likely
  to type. If users say "flyway", "migration", "DDL" — put those exact tokens
  in the description.
- State **what it does AND when to use it**, explicitly. "Generate a Flyway
  migration **after adding, changing, or deleting a JPA entity**" beats
  "Generate Flyway migrations."
- Be a little **pushy** when the skill is genuinely useful but easy to miss:
  *"Use whenever the user mentions dashboards, metrics, or wants to display
  company data — even if they don't say 'dashboard'."*
- Note that opencode tends to skip skills for trivial one-step tasks it can do
  directly. Triggering is most reliable for substantive, multi-step, or
  specialized work — so write the description (and any test prompts) around that
  kind of request.

**Over-triggering**: the skill fires on adjacent tasks it shouldn't own. Fixes:

- Gate it: *"Use ONLY when … Do not use for …"* — name the near-miss cases that
  should stay out. (The built-in `customize-opencode` skill is a clean example
  of this pattern.)
- Drop overly generic keywords that collide with unrelated work.

Write the description in **third person** about the task ("Use when…", "Create…"),
not first person ("I help you…").

### Optionally, test triggering directly

To check triggering without guessing, draft ~8–12 realistic queries split
between **should-trigger** and **should-not-trigger**, and make the negatives
genuine near-misses (sharing keywords but needing something else), not obvious
non-matches. Then run each through the `task` tool **without naming the skill**
and see whether the subagent reaches for it. Tighten the description toward the
queries it got wrong, and rerun. Stop when triggering is reliable in both
directions.

---

## Checklist before declaring done

- Folder name equals the `name` in frontmatter; `name` is lowercase-hyphenated.
- `description` covers **what** and **when**, front-loads real trigger keywords,
  and is in third person.
- Body is imperative, explains its reasoning, and isn't padded with empty
  mandates.
- Output formats and examples are concrete where the shape matters.
- For verifiable skills: tested against 2–3 realistic prompts via the `task`
  tool, transcripts read, user has seen the outputs.
- The skill lives at the right scope (`.opencode/skills/` vs
  `~/.config/opencode/skills/`).
- **Told the user to quit and restart opencode** so the skill loads.
