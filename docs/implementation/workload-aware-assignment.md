# Workload-Aware Assignment

## Purpose

Recommend one best-fit employee for a new task while preserving manager or task-giver control over the final assignment. The system prioritises demonstrated delivery on comparable work, then verified CV skills, reliability, and available capacity.

## Scope

- Generate a single assignment recommendation and up to three alternatives.
- Require a manager or task giver to approve the recommendation or select another eligible employee.
- Ingest CV-derived skills as unverified evidence until reviewed.
- Maintain internal employee performance metrics and reserve 25% of normal capacity for top performers, except when they are uniquely qualified.
- Restrict raw performance scores and detailed ranking rationale to organisation owners and admins.

## Non-goals

- Automatic assignment without human approval.
- Salary, bonus, promotion, disciplinary, or termination decisions.
- Treating unverified CV extraction as demonstrated experience.

## Recommendation model

Only active employees are eligible. The initial deterministic score is:

| Signal | Weight | Notes |
| --- | ---: | --- |
| Similar completed work | 45% | Highest priority; based on completed tasks with matching tags/skills. |
| On-time delivery/reliability | 25% | Uses completed task history; excludes approved leave/unavailability where available. |
| Verified skills | 15% | CV or manager-reviewed skills only. |
| Available capacity | 15% | Uses weighted active task count and task priority. |

The system applies the top-performer capacity buffer after calculating normal availability. A top performer is considered at capacity after 75% of the normal active-workload limit unless no other qualified person is available.

## Data model

- `employee_skills`: employee profile, canonical skill, proficiency, verification state, source, and timestamps.
- `employee_performance_metrics`: rolling task counts, on-time rate, similar-work score, workload score, composite score, and refreshed timestamp.
- `assignment_recommendations`: task, recommended employee, structured score breakdown, short explanation, alternatives, status, approver, final assignee, override reason, and timestamps.
- Add task skill/tag fields and an optional link to the final recommendation record.

All new records are organisation-scoped and access-controlled. CV documents remain restricted; their derived skills are exposed only according to verification and role rules.

## Approval flow

1. A task creator submits task title, description, priority, due date, and optional required skills.
2. The service creates a pending recommendation.
3. The task giver or a manager sees one suggested person with a concise reason and may approve or choose another eligible employee.
4. The selected assignee is written to the task only after approval.
5. The decision is retained for audit and recommendation-quality reporting.

## Safeguards and edge cases

- If no employee is eligible, leave the task unassigned and explain the skill/capacity gap.
- If a unique specialist is at the protected-capacity threshold, include them with a clear overload warning.
- Manual overrides never lower an employee's score by themselves.
- Missing or sparse history lowers recommendation confidence rather than inventing evidence.
- Recompute metrics asynchronously after task completion/status changes; use the latest stored metrics for low-latency recommendations.

## Decision log

| Decision | Alternatives considered | Rationale |
| --- | --- | --- |
| Human approval is mandatory | Fully automatic assignment | The task giver/manager keeps accountability and can use context the system lacks. |
| Deterministic rules engine first | LLM-first matching | Scores remain explainable, testable, and auditable. |
| Completed similar work is highest-weight signal | CV-only matching | Demonstrated delivery is the requested primary signal. |
| 25% capacity buffer for top performers | Equal distribution only | Rewards effective delivery without turning high performers into bottlenecks. |
| Owners/admins see raw metrics | Employee-visible scoring | Limits misuse and protects sensitive personnel data. |

## Validation

- Unit-test score calculation, eligibility, capacity buffer, and tie-breaking.
- API-test tenant isolation, role permissions, approvals, overrides, and audit rows.
- Test CV skill extraction with review states and missing/invalid documents.
- Add UI tests for recommendation, approval, alternative selection, and no-match states.
- Evaluate recommendation quality against approved/overridden assignments before enabling it for every task creator.
