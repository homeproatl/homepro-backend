# Rico Backend

NestJS API for the Rico admin app.

## What it does

- owns the canonical domain logic for jobs, customers, vehicles, services, auth, and settings
- stores scheduling and billing state
- exposes the API consumed directly by the frontend

The frontend does not proxy requests through Next.js anymore. The browser talks to this API directly.

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

SUPER_ADMIN_NAME=Rico
SUPER_ADMIN_EMAIL=rico@admin.com
SUPER_ADMIN_PASSWORD=replace-with-secure-password
```

`FRONTEND_ORIGIN` controls which browser origin is allowed to call the API during development or deployment.

`SUPER_ADMIN_*` only matters for `npm run seed:super-admin` and `npm run seed:bootstrap`. It is not required for normal API startup.

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

# create the super admin user
npm run seed:super-admin

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

`seed:bootstrap` creates the configured super admin and the minimal service catalog used by the jobs flow.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
