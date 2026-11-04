# Course file storage

Course materials are stored privately and served only through
`GET /api/v1/content/[itemId]/file`, which resolves the session and asks the
content service whether this actor may read this item. There are no public URLs,
signed links, or static directories.

## Development and tests (works today)

Default behaviour outside production is the local adapter:

```bash
# optional; these are the defaults
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=.data/storage
```

- Files are written under `.data/storage/tenants/<tenantId>/offerings/<offeringId>/items/<uuid>`.
- `.data/` is gitignored; deleting it removes uploaded files but leaves the
  database rows, whose downloads then return 404.
- Writes are atomic (write to a temporary file, then rename), so a crash cannot
  leave a partially written file that a later download would serve.
- Keys are validated (`^[A-Za-z0-9][A-Za-z0-9/_.-]*$`, no `..`, no absolute
  paths, no empty segments) before they touch the filesystem.
- Integration tests point `STORAGE_LOCAL_ROOT` at a temporary directory, so they
  never write into a developer's `.data`.

## Production (installed, unverified)

The S3 adapter talks to any S3-compatible endpoint. **It has not been run against
a real bucket in this repository.** Treat the integration as unconfigured until
someone performs the checks below; the UI does not claim otherwise, and the
download route returns `503 STORAGE_NOT_CONFIGURED` when the variables are
missing.

```bash
STORAGE_DRIVER=s3
OBJECT_STORAGE_ENDPOINT=https://s3.eu-west-1.amazonaws.com   # or MinIO/R2/etc.
OBJECT_STORAGE_BUCKET=lms-course-files
OBJECT_STORAGE_REGION=eu-west-1
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
# OBJECT_STORAGE_SESSION_TOKEN=...          # only for temporary credentials
# OBJECT_STORAGE_FORCE_PATH_STYLE=true      # true for MinIO, false for virtual-hosted style
```

The bucket must be **private**. Do not enable public access, website hosting, or
a CDN in front of it; the application is the only reader.

Uploads are limited to 25 MB per file and are served as attachments with
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.

### Checklist before calling it configured

1. Upload a file from a faculty course editor; confirm the object appears under
   `tenants/…/offerings/…/items/…` in the bucket.
2. Download it as an enrolled learner: expect `200`, `Content-Disposition:
attachment`, and the original filename.
3. Download it signed out: expect `401`. From another institution: expect `404`.
4. Replace a file in the editor; confirm the old object is removed.
5. Delete the item; confirm the object is removed.
6. Confirm the app returns `503 STORAGE_NOT_CONFIGURED` (not a 500) when the
   credentials are removed.

Record the result in `docs/IMPLEMENTATION_STATUS.md`. Until then the README and
the ledger describe file storage as "local in development, S3 unverified".

## Notes and limits

- Downloads are buffered in memory (25 MB ceiling), which keeps the route simple
  and the tests honest. Streaming to large files would need range requests and a
  signed-URL decision; that is a Phase 12 concern.
- `copy` re-reads and re-writes the object. S3 server-side copy could replace
  this without changing the interface.
- The S3 signer is a small, purpose-built SigV4 implementation for GET/PUT/
  DELETE with no query string. It is unit-tested for deterministic output, not
  against AWS's published signature vectors.
