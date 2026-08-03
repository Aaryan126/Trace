# Trace — Agent Guidelines

## Project Context

**Trace** is "Git for your recurring decisions." It treats personal decisions (tech choices, vendor picks, etc.) as first-class, revisitable objects — with threads, commits, branches, merges, regret markers, and diffs — mirroring how git treats code changes.

- **Runtime:** OpenClaw daemon (self-hosted, Mac background process)
- **Model:** GPT-5.4 via OpenAI API
- **Storage:** SQLite (local-first)
- **UI:** Native SwiftUI menu bar app + localhost web dashboard
- **Agents:** Ingestion (OCR + browser history), Clustering, Synthesis, Resurfacing
- **Scope:** Single-user, desktop-only, v1

See the [PRD](./prd.md) for full product requirements.

## Key Project Files

| File | Purpose |
|------|---------|
| [AGENTS.md](./AGENTS.md) | This file — coding guidelines and project context for agents |
| [readme.md](./readme.md) | Project overview, architecture, and core concepts |
| [prd.md](./prd.md) | Full product requirements document |
| [implementation.md](./implementation.md) | Latest implementation progress, decisions, and technical notes |

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

## 5. Keep Documentation Updated

**Update the relevant docs as you work. Don't let them go stale.**

After completing implementation work:

1. **Update [implementation.md](./implementation.md):**
   - Change the relevant task status (Not Started → In Progress → Done).
   - Log any key technical decisions in the Technical Decisions Log.
   - Add implementation notes or blockers if warranted.
   - Update the "Last Updated" date at the top.

2. **Update [readme.md](./readme.md)** if your changes affect:
   - Architecture or tech stack choices.
   - Core concepts or data model.
   - UI screens or agent descriptions.

3. **Update [prd.md](./prd.md)** only if the user explicitly requests a scope or requirements change.

The rule: when you finish a coding task, spend 30 seconds updating the docs so the next agent (or future you) has accurate context.