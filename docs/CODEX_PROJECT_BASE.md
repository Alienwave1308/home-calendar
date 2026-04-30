# Codex Project Base

Last updated: 2026-04-30

## Snapshot

- Repository: `Alienwave1308/home-calendar`
- Default branch: `main`
- Current baseline: `fae986f66f84fd0e3ccb6c578cbc8c6541bb6271`
- Latest main merge: PR #97, `auto-repair promo schema fixed-amount hotfix to main`
- Current bug focus: master promo codes, especially fixed-amount promo creation and legacy schema repair.

## Architecture

This is a Telegram Mini App for booking appointments with a master.

- Backend: Node.js, Express, PostgreSQL through `pg`, JWT auth, Helmet, CORS.
- Frontend: vanilla JS, HTML, CSS.
- Primary production flows: client booking at `/book/:slug` and master panel at `/master`.
- Priority code paths: `frontend/booking.*`, `frontend/master.*`, `backend/routes/public-booking.js`, and master routes.
- Legacy family/task tracker code still exists, but it is not the priority surface for production booking work.

## CI/CD

CI is defined in `.github/workflows/ci.yml`.

- Trigger: pushes and PRs for `main` and `dev`.
- Pipeline: lint, backend Jest tests, parallel Cypress E2E matrix, E2E coverage, then summary.
- Promo E2E coverage lives in `cypress/e2e/master-promo-codes.cy.js`.

Deploy is defined in `.github/workflows/deploy.yml`.

- Trigger: manual dispatch or successful CI workflow on `main`.
- Latest observed green chain on 2026-04-29:
  - CI #399, success, `main`, run `25104432262`
  - Deploy #151, success, run `25104593974`
- Deploy pulls `origin main` on the VPS and rebuilds the Docker Compose production stack.

## Recent Promo History

- PR #95: promo create error handling to `main`.
- PR #96: auto-repair promo schema for fixed-amount create.
- PR #97: auto-repair promo schema fixed-amount hotfix to `main`.
- Related feature branch: `feature/promo-fixed-and-gift-zone`.
- Related hotfix branch: `hotfix/promo-create-error-handling`.

## Promo Risk Map

- `backend/routes/master-promo-codes.js`: master CRUD, validation, legacy insert fallbacks, on-demand schema repair.
- `backend/routes/public-booking.js`: promo application, preview pricing, booking persistence, usage count updates.
- `backend/db.js`: runtime schema compatibility on server startup.
- `backend/migrations/034_promo_fixed_amount_and_gift_complex_discount.sql`: fixed amount and gift-complex schema migration.
- `frontend/master.js`: master promo creation UI and error display.
- `frontend/booking.js`: client-side promo preview and final booking payload.
- `cypress/e2e/master-promo-codes.cy.js`: master UI regression tests for promo creation and toggles.

## Verification Commands

Run the narrow checks first when touching promo code:

```bash
npm run lint
npm test -- backend/routes/master.test.js backend/routes/public-booking.test.js
npx cypress run --spec cypress/e2e/master-promo-codes.cy.js
```

Before deploy, run the full gate when Docker is available:

```bash
npm run predeploy:check:docker
```

## Current Bug Notes

Observed in Telegram Mini App master panel: creating fixed-ruble promo `BIKINI300` with amount `300` shows:

```text
Скидка в рублях пока недоступна: требуется обновление схемы промокодов на сервере
```

Likely cause: the schema repair path added the new fixed/gift columns and recreated `master_promo_codes_reward_check`, but existing legacy rows could still violate the new check. Repair must normalize legacy `fixed_amount` and `gift_service` rows before adding the constraint.
