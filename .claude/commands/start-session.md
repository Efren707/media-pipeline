---
description: Start a work session. Sync, read the current state, check the sandbox, and suggest the next step.
---

Start a work session on this project. Do these steps in order, then give a short summary.

1. **Sync:** run `git status` and `git branch --show-current`. If there are no uncommitted changes, run `git fetch` and `git pull --rebase` on the current branch. If there are uncommitted changes, report them and don't pull.
2. **Read the state:**
   - The "Current focus" block at the top of `ROADMAP.md`.
   - The active phase plan in `docs/plans/` (the one whose status is 📝 or 🔨 in ROADMAP), especially its Tasks and the last few **Progress log** entries.
   - Any entries in `docs/decisions.md` added since the last Progress log date.
3. **Check the sandbox:** run `aws sts get-caller-identity`.
   - If it fails, tell me to start the lab and refresh credentials (SETUP.md §3).
   - Don't print the account ID in the summary.
   - Remind me to check the remaining budget on the AWS Academy lab page ($20 per sandbox).
4. **Summarize** in under 15 lines:
   - current phase and milestone, plus days left until the milestone date
   - what my partner did most recently (from the Progress log / git log)
   - open PRs to review, if `gh` is available (`gh pr list`)
   - the suggested next task for me, and which branch to use
   - any blockers

Ask who I am (Efren or Fahad) if you can't tell from `git config user.name`.
