# Kursi

A REST API for booking seats at events, built with Node.js, TypeScript, Express 5 and PostgreSQL. Work in progress.

## Run it

You need Docker. From a fresh clone:

```sh
cp .env.example .env
docker compose up --build
```

Then open http://localhost:3000/docs. Compose starts PostgreSQL, applies the migrations, adds demo data, and starts the API once the database is ready. On the docs page, press **Execute** on **Log in** (it's pre-filled with a demo account), then try any other endpoint.

Stop it with Ctrl+C, or `docker compose down` if it runs in the background. Add `--volumes` to delete the data as well.

## Develop

You need Node.js 26 and Docker for the database.

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

`npm test` runs the tests against a throwaway PostgreSQL container, or against `TEST_DATABASE_URL` when it's set.
