# Phase plans

This folder holds one detailed plan per [roadmap](../../ROADMAP.md) phase. It's written during that phase's planning session, **before** any building starts.

## Naming

`NN-short-name.md`, using the roadmap phase number. Examples:
- `01-design-finalization.md`
- `04-validate-stage.md`

## Process

Planning is async, and a planning session is a pull request:

1. The phase owner copies [`_template.md`](_template.md) to the new file name and fills it in.
2. Link it from the phase's row in `ROADMAP.md`, set status to 📝, and open a PR (`docs/plan-NN-short-name`).
3. The partner reviews and comments. **Merging the PR means the plan is approved.** Then set status to 🔨.
4. During the phase, add a **Progress log** line each session.
5. When the phase is done, fill in **Outcome notes** and set status to ✅.

Only create a plan when its phase is being planned. Don't create empty files ahead of time.
