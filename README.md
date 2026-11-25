# Glide (app.getglued.co)

The Sales part of Glide, live. Sign-in is Google only, for the people in `ALLOWED_EMAILS` (all on getglued.co).

## How it fits together

- `/` serves the Sales screens. They are built from the prototype by `build_app.py` and sit in `bundle/`, sealed with AES-256-GCM. `BUNDLE_KEY` opens them, so the public repo holds nothing readable.
- Numbers live in one JSON document in the private Vercel Blob store (`glide/sales-daily.json`), one entry per day and channel, with a daily backup in `glide/backups/`.
- `POST /api/refresh` (the refresh button), `POST /api/v1/sync` (Grokbot) and the 6:00 job in `vercel.json` pull Smartlead into it.
- Grokbot writes with `POST /api/v1/days` and the `GLIDE_API_TOKEN`. Signed in, `/api-docs` explains the fields.

## Environment

| Name | What |
| --- | --- |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` | Google sign-in |
| `ALLOWED_EMAILS` | Who can log in, comma separated |
| `BUNDLE_KEY` | Opens `bundle/` |
| `BLOB_READ_WRITE_TOKEN` | The private Blob store |
| `GLIDE_API_TOKEN` | Grokbot's bearer token |
| `CRON_SECRET` | The daily job |
| `SMARTLEAD_API_KEY` | Smartlead, for sends, positives and inbox health |
| `EXPLEE_API_KEY` | Explee (its API has no sending numbers yet) |

## Local

`GLIDE_DEV_USER=andres@getglued.co npm run dev` skips Google (development only) and keeps data in `.data/`.
