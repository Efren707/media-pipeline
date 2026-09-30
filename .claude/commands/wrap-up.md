---
description: End a work session. Log progress, update Current focus, check costly resources, commit the docs.
---

Wrap up this work session. Do these steps in order.

1. **Summarize the session:** use `git log` and `git diff` on the current branch since the session started, plus our conversation. Draft one line: what got done and what's next.
2. **Progress log:** append a line to the active phase plan in `docs/plans/` under **Progress log**:
   `- YYYY-MM-DD <Name>: <done>. Next: <next>.`
3. **Current focus:** in `ROADMAP.md`, update **only my own block** (Working on / Next / Blockers / updated date). Don't touch my partner's block. Change "Active phase" or a phase's Status in the Phases table (📝/🔨/✅) only if that actually changed this session.
4. **Decisions:** if we made a significant design choice this session, add an entry to `docs/decisions.md`.
5. **Costly resources check ($20 budget):** list anything still running that charges by the hour:
   - `aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key=='Name']|[0].Value]" --output table`
   - `aws rds describe-db-instances --query "DBInstances[?DBInstanceStatus=='available'].[DBInstanceIdentifier,DBInstanceClass]" --output table`
   - `aws elbv2 describe-load-balancers --query "LoadBalancers[].[LoadBalancerName,State.Code]" --output table`
   - `aws ec2 describe-nat-gateways --filter Name=state,Values=available --query "NatGateways[].NatGatewayId"` (there should never be any)

   If anything is running, ask whether to stop or destroy it (use the teardown script in `scripts/` if one exists). Don't stop anything without confirmation.
6. **Commit and push:** stage only the doc updates (`ROADMAP.md`, `docs/plans/`, `docs/decisions.md`) plus any finished work I confirm. Commit with `docs: session wrap-up <date>` and push the current branch. **Never push to `main`.** If I'm on `main`, create a branch first.
7. Print a 3-line summary: done / next / anything left running.
