# Backup and restore runbook

Production data is PostgreSQL. There is no application-level backup: the database
is the source of truth, and course files live in object storage, so a complete
recovery needs **both** a database dump and the bucket.

## What to back up

| Asset               | Method                          | Notes                                                         |
| ------------------- | ------------------------------- | ------------------------------------------------------------- |
| PostgreSQL database | `pg_dump --format=custom`       | Includes every tenant, membership, and learning record.       |
| Object storage      | Provider replication/versioning | Course files and submission attachments; not in the database. |
| Secrets             | Provider secret store           | Never in a dump, a repository, or a chat message.             |

The local development container is `lms-pg` (PostgreSQL 17). In this project the
following commands were executed against it; replace the container name and
credentials for staging or production.

## Take a backup

```bash
docker exec lms-pg pg_dump -h 127.0.0.1 -U lms -d lms_dev \
  --format=custom --no-owner --no-privileges --schema=public \
  > backup-$(date +%Y%m%dT%H%M%S).dump
```

- `-h 127.0.0.1` forces TCP. Without it the client connects over the container's
  Unix socket, where the local `lms` role fails with `Peer authentication failed`.
- `--schema=public` is required on this image. The container also hosts a managed
  `auth` schema owned by a different role, and a whole-database dump aborts with
  `permission denied for schema auth`. The `public` schema holds every application
  table; `auth` is Supabase-managed and is not part of the application's data.
- `--format=custom` compresses and allows selective restore.
- `--no-owner --no-privileges` avoids failures when the restore role differs from
  the source role.
- Write the file outside the repository, or into a gitignored directory, and move
  it to encrypted storage. A dump of a real institution is personal data.

Verify the archive is readable before trusting it:

```bash
pg_restore --list backup-20261104T120000.dump | head
```

## Restore into a scratch database

Never restore over the live database to "test" a backup. Create a scratch database
whose name ends in `_restore` or `_test`, restore there, check it, then drop it.

```bash
docker exec lms-pg psql -h 127.0.0.1 -U lms -d postgres -c 'CREATE DATABASE lms_restore_test'
docker exec -i lms-pg pg_restore -h 127.0.0.1 -U lms -d lms_restore_test \
  --no-owner --no-privileges --schema=public < backup-20261104T120000.dump
```

Check `pg_restore`'s exit status; the command can finish without printing anything.
`--clean --if-exists` is only needed when restoring over an existing database, not
into the freshly created scratch one.

Check the restore against the source before declaring success:

```bash
docker exec lms-pg psql -h 127.0.0.1 -U lms -d lms_restore_test -c "
  SELECT
    (SELECT count(*) FROM tenants)      AS tenants,
    (SELECT count(*) FROM users)        AS users,
    (SELECT count(*) FROM course_offerings) AS offerings,
    (SELECT count(*) FROM enrolments)   AS enrolments,
    (SELECT count(*) FROM certificates) AS certificates;
"
```

The same query against the source should return identical counts. Then:

```bash
docker exec lms-pg psql -U lms -d postgres -c 'DROP DATABASE lms_restore_test'
```

## Tested result

On 2026-11-04 this drill ran against the seeded development database. The dump was
252,662 bytes; `pg_restore` exited 0 into `lms_restore_test`; and both the source
and the restored copy returned identical counts — 2 tenants, 13 users, 4 course
offerings, 7 enrolments, 1 certificate, 0 webhook events — with the certificate
still `issued` and still carrying its verification token. The scratch database was
then dropped. See `docs/IMPLEMENTATION_STATUS.md` for the phase record.

## Restore in an incident

1. Stop the application (or put it in maintenance) so nothing writes during the
   restore.
2. Take a **fresh** dump of the damaged database before touching it. It may hold
   records the last backup lacks, and it is evidence.
3. Restore the chosen backup into a new database, verify counts and a few known
   records, then point `DATABASE_URL` at it.
4. Run `npx prisma migrate deploy` — it is a no-op when the dump already contains
   the migrations table, and applies anything newer.
5. Restore the object-storage prefix that matches the backup window, or state
   clearly which files are missing.
6. Start the app, check `/api/health/ready`, sign in, and open one course and one
   certificate. Record the backup timestamp and the data-loss window in the
   incident log.

## Retention and rotation

- Keep daily dumps for at least 30 days, weekly for a quarter, and one before
  every migration or deployment.
- A backup that has never been restored is a hope, not a backup: run the scratch
  restore drill quarterly.
- Encrypt dumps at rest and restrict who can read them; they contain names,
  emails, grades, and assessment feedback.
