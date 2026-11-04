# Incident response

## Severities

| Severity | Meaning                                                               | Response                          |
| -------- | --------------------------------------------------------------------- | --------------------------------- |
| SEV-1    | Data loss, cross-tenant exposure, or the service is down for everyone | Immediate; page the on-call owner |
| SEV-2    | A core workflow is broken (sign-in, submissions, grading, quizzes)    | Within 30 minutes                 |
| SEV-3    | A degraded feature with a workaround                                  | Same business day                 |
| SEV-4    | Cosmetic or single-user issue                                         | Normal backlog                    |

A suspected **cross-tenant read** is always SEV-1, even if only one record is
involved. Preserve evidence before changing anything.

## First five minutes

1. Declare the severity and open an incident log with times in UTC.
2. Check the probes: `/api/health`, `/api/health/ready`, `/api/health/queue`.
3. Check the most recent deploy. If the incident began within an hour of a release,
   roll the application back first and investigate afterwards.
4. Do not modify or delete data to make a symptom disappear. Take a database dump
   before any corrective write.

## Where the evidence is

- **Structured logs** — one JSON line per request with `requestId`, method, path,
  and for failures a reason. Request IDs also appear in API error bodies, so a user
  can quote one.
- **Audit events** (`audit_events`) — actor, action, resource, before/after values,
  reason, and request ID for sensitive writes. Some flows (certificate revocation,
  grade overrides, attendance locks) require a reason.
- **Notification queue** — `/api/health/queue` shows due retries, stuck messages,
  and 24-hour volume; `notification_deliveries.last_error` holds the transport error.
- **Webhook events** (`webhook_events`) — provider, event id, type, payload hash,
  status, and last error. A rejected delivery is not stored; the rejection reason is
  logged as `webhook.rejected`.

## Common failures

| Symptom                                     | Likely cause                                                         | Action                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `/api/health/ready` returns 503             | PostgreSQL unreachable or credentials rotated                        | Check the database, connection string, and network; do not restart blindly |
| Sign-in returns 429                         | Rate limit (5/minute for sign-in)                                    | Wait for the window; check whether an attack is in progress                |
| Uploads return 503                          | Object storage not configured or unreachable                         | Check `STORAGE_DRIVER`/`OBJECT_STORAGE_*`; files fail closed by design     |
| Email never arrives                         | No provider is configured                                            | Expected outside development; messages are `unconfigured`, not lost        |
| `/api/health/queue` shows stuck > 0         | Delivery exhausted five attempts                                     | Read `last_error`, fix the transport, then re-queue deliberately           |
| Webhook returns 401                         | Signature mismatch or timestamp outside 300 seconds                  | Check the shared secret and the sender's clock; never disable the check    |
| Webhook returns 503                         | `WEBHOOK_<PROVIDER>_SECRET` missing or too short                     | Set the secret in the platform secret store and redeploy                   |
| A learner sees "not found" for their course | Unpublished course, missing active enrolment, or another institution | Check the offering status, enrolment status, and session tenant            |

## Security incident specifics

- **Suspected cross-tenant access**: capture the request ID, the affected user, and
  the records read. Do not ask the reporter to reproduce it more than once. Rotate
  `AUTH_SECRET` only after preserving sessions evidence; rotating it signs everyone
  out and invalidates any open QR check-in code, so staff must generate a new one.
- **Leaked credential**: rotate it in the provider, redeploy, then confirm the old
  value no longer works. Never paste a live secret into a ticket or chat.
- **Known header gap**: the app sets a restrictive CSP subset
  (`frame-ancestors`, `base-uri`, `form-action`) but not a full `script-src`
  policy, because that requires per-request nonces through the App Router. Treat
  any XSS report as SEV-1 and prioritise nonce plumbing; do not add
  `unsafe-inline` as a fix.

## Communication

- SEV-1/2: post an update every 30 minutes in the incident channel — what is
  affected, what changed, what users should do, next update time.
- Do not speculate about causes or blame individuals. State facts and times.
- Notify the institution administrator when their learners' data or access is
  affected; keep notifications free of other tenants' details.

## After the incident

1. Write a postmortem within five business days: timeline, impact, root cause,
   detection gap, and the corrective actions with owners and dates.
2. Add a regression test for the failure if the cause was in our code.
3. Update this runbook and the implementation ledger when a limitation or missing
   control contributed.
4. A backup restore that was needed must be followed by a restore drill on the
   restored copy, not just a "looks fine".
