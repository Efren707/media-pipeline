## What & why
<!-- What does this PR change, and why? Link the phase plan: docs/plans/NN-*.md -->

Phase:

## Area
- [ ] backend
- [ ] frontend
- [ ] lambdas
- [ ] infra
- [ ] docs / plan

## How I tested it
<!-- Commands run, sandbox deploy, screenshots of the UI, etc. -->

## Definition of done (SETUP.md §6)
- [ ] Tests for the touched area pass (pytest / Spring Boot tests / `npm run build`)
- [ ] Linters/formatters clean, CI green
- [ ] `cdk synth` has no `AWS::IAM::Role` and no NAT Gateway (infra changes)
- [ ] Lambda code calls only S3 (lambdas changes)
- [ ] Contract changes are also reflected in `docs/media_pipeline.md`
- [ ] No credentials, account IDs, emails or `.env` files committed (public repo)
- [ ] Docs, the phase plan's Progress log and my Current focus block are updated
