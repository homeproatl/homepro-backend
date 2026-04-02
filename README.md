# Rico Backend

NestJS API for the Rico admin app.

## What it does

- owns the canonical domain logic for estimates, customers, vehicles, services, auth, and settings
- stores scheduling and billing state
- exposes the API consumed directly by the frontend
 
The frontend reaches this API through its same-origin `/api` proxy layer.

This README is safe to update independently of runtime behavior.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env
```

3. Set the required values in `.env`:

```env
APP_PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/rico?replicaSet=rs0
FRONTEND_ORIGIN=http://127.0.0.1:3000

JWT_ACCESS_SECRET=replace-with-secure-access-secret
JWT_REFRESH_SECRET=replace-with-secure-refresh-secret
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

OWNER_ADMIN_NAME=Rico
OWNER_ADMIN_EMAIL=rico@admin.com
OWNER_ADMIN_PASSWORD=replace-with-secure-password
```

`FRONTEND_ORIGIN` controls which browser origin is allowed to call the API during development or deployment.

For the live frontend, set:

```env
FRONTEND_ORIGIN=https://www.gmbworkshop.shop
```

`OWNER_ADMIN_*` only matters for `npm run seed:owner-admin` and `npm run seed:bootstrap`. It is not required for normal API startup.

## Invoice email transport

For production invoice sending, the backend uses Resend.

Recommended configuration:

```env
INVOICE_EMAIL_TRANSPORT=RESEND
INVOICE_EMAIL_FROM=Gmb Workshop <billing@gmbworkshop.shop>
INVOICE_EMAIL_RESEND_API_KEY=re_replace_with_your_resend_api_key
```

Notes:
- `INVOICE_EMAIL_FROM` must use a sender address on a verified Resend domain or subdomain.
- `LOG` and `DISABLED` are still available for non-delivery environments, but production sending is Resend-only.

## Run the API

```bash
# watch mode
npm run start:dev

# production build
npm run build
npm run start:prod
```

By default the API runs on `http://127.0.0.1:4000`.

## Seed and reset helpers

```bash
# reset the database to the clean-sheet state
npm run reset:clean-sheet

# create the owner admin user
npm run seed:owner-admin

# seed a minimal service catalog
npm run seed:services

# seed the common bootstrap data
npm run seed:bootstrap
```

Recommended first-run flow:

```bash
npm run reset:clean-sheet
npm run seed:bootstrap
```

`seed:bootstrap` creates the configured owner admin and the minimal service catalog used by the estimate flow.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
