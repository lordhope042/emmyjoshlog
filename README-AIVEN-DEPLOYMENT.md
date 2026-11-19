# Emmyjosh Marketplace — Aiven + single root .env + Prisma pool patch

This is an **overlay patch**, not a complete marketplace repository. Extract it over the existing project root and keep all other project files.

## What this update changes

- Keeps the Aiven CA and TLS-aware `backend/db.js` connection from the previous patch.
- Makes `legacy-api/src/db.js` a process-wide Prisma singleton.
- Adds `legacy-api/src/load-env.js`, which always loads the one project-root `.env`, independent of the current working directory.
- Updates `legacy-api/src/config.js` and the Prisma category seed to use that same root `.env` and shared Prisma client.
- Uses conservative Prisma pool settings (`connection_limit=5`, `pool_timeout=20`) in the example URL to reduce pressure on the Aiven service.

## 1. Apply the overlay

Extract this ZIP into the existing Emmyjosh project root and allow the included files to replace matching files. Do not replace the whole project with this ZIP. It is an overlay only.

## 2. Keep one environment file

Use only:

```text
<project-root>\.env
```

Merge the relevant entries from `.env.aiven.example` into the existing root `.env`. Do not overwrite the rest of your settings. Keep your existing JWT, encryption, SMSBower, PocketFi, admin bootstrap, and other provider variables.

The example contains a placeholder password only. URL-encode the Aiven password locally before inserting it. Never send the password or completed URL in chat or commit `.env`.

After confirming that every required setting from `legacy-api/.env` has been merged into the root `.env`, rename the old file as a backup so it is no longer used:

```powershell
Move-Item .\legacy-api\.env .\legacy-api\.env.backup
```

Do not delete the backup until the app has been tested. The app code in this patch loads the root `.env` explicitly.

The URL uses `sslcert=../../certs/aiven-ca.pem` because Prisma resolves that CA path relative to `legacy-api/prisma/schema.prisma`. The mysql2 connector reads the same certificate through `DB_SSL_CA_PATH=certs/aiven-ca.pem` from the project root. Both connectors verify the TLS certificate.

## 3. Run Prisma commands from the project root

Run commands from the folder that contains the root `.env` and `package.json`, not from `legacy-api`:

```powershell
npx prisma migrate status --schema=legacy-api/prisma/schema.prisma
```

If status is clean, do not create another migration just to test connectivity. To apply already-created migrations on a deployment, use:

```powershell
npx prisma migrate deploy --schema=legacy-api/prisma/schema.prisma
```

Do not run `migrate reset`, `db push`, or another `migrate dev` against the populated Aiven database as a troubleshooting step.

## 4. Verify

```powershell
node tools/check-aiven-connection.js
npm run dev
```

Then test customer registration again. The singleton and smaller pool reduce duplicate Prisma pools and connection pressure, but `P2024` can also be caused by long-running queries, unreleased transactions, or multiple app processes. If it remains, capture the full server-side Prisma error and inspect Aiven's active connection count before changing pool limits again.

## Safety and scope

- This patch does not include or modify your real `.env` or any password.
- It does not migrate local database records to Aiven.
- It does not reset or delete database tables or migration history.
- The previous MySQL TLS check was successful, but this archive has not been tested against your live Aiven credentials from this environment.
- Review the final merged root `.env` locally; never paste its secrets into chat.
