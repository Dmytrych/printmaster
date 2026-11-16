# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Everything lives in `backend/`, a pnpm workspace (`pnpm-workspace.yaml`: `packages/*`, `lambdas/*`, `infra`). Node 22 (`.nvmrc`), ESM everywhere (`"type": "module"`).

pnpm 12.18.0 is pinned only in `backend/package.json` (`packageManager` + `devEngines`), because pnpm reads that field from the workspace root only. An older global pnpm switches to it automatically. Don't add `packageManager` or `pnpm` settings to sub-packages: pnpm ignores them there. Build-script approval lives in `pnpm-workspace.yaml` (`allowBuilds`).

The shared `backend/eslint.config.mjs` imports `@eslint/js` and `typescript-eslint`, so they (plus `eslint` and `typescript`) must stay in `backend/package.json` devDependencies.

- `backend/packages/filament-management` (`@printmaster/filament-management`): domain logic (`FilamentManagementService`, a repository file, types). Exported as raw TypeScript via `exports: ./src/index.ts`, so it has no build step. Consumers bundle it.
  - `FilamentManagementService` requires a `FilamentSpoolRepository`. There is no default.
  - Lambdas build the service with `createFilamentManagementService()` (`src/create-service.ts`) once, at module scope. It wires `DynamoDbFilamentSpoolRepository` to the shared DocumentClient and the table name from `FILAMENT_SPOOLS_TABLE_NAME`.
  - Tests use `InMemoryFilamentSpoolRepository`, or mock the SDK with `aws-sdk-client-mock`.
  - Repository writes are intent-level (`create`, `subtractWeight`, `deleteById`) rather than a generic `save`, so DynamoDB can do check-and-write atomically with condition expressions.
  - `src/persistence/` holds the DynamoDB adapter (`dynamodb-spool.repository.ts`), the table definition (`tables.ts`, also exported as the `./tables` subpath for infra) and the item schema (`spool.item.ts`).
- `backend/packages/shared` (`@printmaster/shared`): cross-cutting primitives. It currently holds only `ApplicationError`. Raw TS export, like the other packages.
- `backend/packages/dynamodb` (`@printmaster/dynamodb`): shared DynamoDB setup.
  - `getDocumentClient()` returns a module-level singleton. `createDocumentClient()` honours `DYNAMODB_ENDPOINT` for DynamoDB Local.
  - `requireEnv()` reads required env vars such as table names.
  - Cursor pagination: `queryPage`, `queryAll`, `encodeCursor`, `decodeCursor`.
  - `isConditionalCheckFailed()` identifies failed conditional writes.
  - `TableDefinition` is the framework-neutral table schema type. It's also exported as the type-only `./schema` subpath.

  Domain packages implement their repository adapters on top of it.
- `backend/lambdas/my-lambda`: API Gateway HTTP API v2 handler (`src/index.ts`). It is a thin adapter that calls the domain package and returns JSON.
- `backend/infra`: AWS CDK app (`bin/app.ts`) with two stacks:
  - `lib/data-stack.ts` → `PrintMaster-Data-Dev`: stateful resources only, i.e. the DynamoDB tables, built by `lib/tables.ts` from the domain packages' `TableDefinition`s.
  - `lib/api-stack.ts` → `PrintMaster-Api-Dev`: `NodejsFunction`s (ARM64, Node 22) with 5-day log groups, and the HTTP API with `GET /hello` plus the `/spools` routes. It receives tables through props and consumes them via weak cross-stack references (`Fn::GetStackOutput`).
- `CDK_GUIDE.md` (repo root): a tutorial written for an earlier layout (`backend/my-lambda`). Paths in it are outdated: the Lambda is now `backend/lambdas/my-lambda`.

## Commands

Run from the relevant package directory (there is no root-level script runner).

Lambda and shared packages (`lambdas/*`, `packages/filament-management`, `packages/shared`, `packages/dynamodb`):
- `pnpm test` runs vitest. Run one test with `pnpm vitest run test/index.test.ts -t "name"`.
- `pnpm typecheck`, `pnpm lint` (eslint), `pnpm format` (prettier)
- Lambda only: `pnpm build` (esbuild to `dist/index.mjs`) and `pnpm package` (zips to `function.zip`). CDK bundles on its own, so these aren't needed for deploys.

Infra (`backend/infra`):
- `pnpm verify` runs typecheck, tests (`node --import tsx --test test/*.test.ts`, node's built-in runner and not vitest) and `cdk synth --quiet`.
- `pnpm synth`, `pnpm diff` and `pnpm run deploy` (deploys both stacks with `--all`).
  - Use `pnpm run deploy`, not `pnpm deploy`: `deploy` is a built-in pnpm command, and the built-in wins over the script. The same applies to `pnpm run destroy`.
  - Deploying needs AWS credentials and a default region. `bin/app.ts` takes the account and region from `CDK_DEFAULT_*`.
- Run one infra test with `node --import tsx --test --test-name-pattern="name" test/api-stack.test.ts`.

## Conventions and gotchas

- **Relative imports must end in `.js`** (e.g. `./foo.js`), even though the files are `.ts`. ESLint enforces this via `no-restricted-syntax` in `backend/eslint.config.mjs`.
- **All custom error classes must extend `ApplicationError`** from `@printmaster/shared`, either directly or through a package-level base such as `DynamoDbError`. Never extend `Error` directly. Pass a stable `code` string, and pass `{ cause }` when wrapping another error.
- Prettier: `printWidth: 100`, `trailingComma: all`.
- The CDK bundling config (`api-stack.ts`) sets `projectRoot` to `backend/` and uses `backend/pnpm-lock.yaml`. Workspace packages are bundled into the Lambda, while `@aws-sdk/*` is left external because the runtime provides it. A new workspace dependency used by a Lambda must be declared in that Lambda's `package.json` as `workspace:*`.
- **DynamoDB tables:**
  - Each domain package owns its tables. It declares them in `src/persistence/tables.ts` (exported as `./tables`) as `TableDefinition` objects. That file may only have type-only imports, because infra imports it.
  - Never set `tableName`. CloudFormation generates the name, and Lambdas receive it through `def.envVar` (convention: `<NAME>_TABLE_NAME`). Adapters read it with `requireEnv(def.envVar)`.
  - A definition's `id` is the CDK construct id and therefore the logical ID. It is permanent: changing it replaces the table and loses its data. `infra/test/data-stack.test.ts` pins it.
  - Item schema:
    - Generic `PK`/`SK` keys with type-prefixed values (`SPOOL#<id>`) and an `entityType` attribute.
    - Item types, key builders and `to*Item`/`from*Item` mappers go in `src/persistence/<entity>.item.ts`. The domain types stay free of storage attributes.
  - Add new tables to `DataStack`. Give Lambdas access via the `tables` argument of `createFunction` in `api-stack.ts` (`read` → `grantReadData`, `readwrite` → `grantReadWriteData`), which also sets the env var.
- `cdk.out/` and `dist/` are generated. Ignore them when searching or editing.
- `lambdas/my-lambda` has its own nested `.git` directory, separate from the parent folder. The root `printmaster/` isn't a git repo.
- `typescript` versions differ between packages (`~6.0.3` in the Lambda and domain package, `^7` in infra). Keep this in mind when sharing `tsconfig.base.json` settings.
