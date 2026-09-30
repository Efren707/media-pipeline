# Contracts

Example files that define the data passed between the parts of the system. Both partners build against these, so the Lambdas, backend and frontend can be developed in parallel, before the other parts exist.

The example files are written in **Phase 1 (Design finalization)**. The planned files:

| File | Produced by | Used by |
|---|---|---|
| `status.example.json` | Lambdas (every stage), backend (Queued, watchdog) | Backend status API, Lambda tests |
| `result.example.json` | Analyze Lambda | Backend (gallery, search indexing), SNS email trigger |
| `api/*.response.json` | Spring Boot REST API | React (mock data until the backend exists), backend tests |

## How they're used
- **Lambda tests** (pytest) load the examples to check the output format.
- **React** uses `api/*.response.json` as mock responses until the real endpoints exist.
- **Backend tests** check that responses match the examples.

## Rule
Changing a contract means updating the example file **and** the matching table in [`../media_pipeline.md`](../media_pipeline.md) **in the same PR**. Call out the change in the PR description so the partner sees it.
