# DynamoDB in `@printmaster/filament-management`

This guide shows how the filament-management package stores spools in DynamoDB: how the schema is
defined, how infra creates the table, and how the code reads and writes it. It also explains the
DynamoDB ideas you need to follow the code. If you are new to DynamoDB, read Part 1 first.

---

## Part 1: DynamoDB basics you need

### 1.1 What DynamoDB is (and isn't)

DynamoDB is a managed key-value and document database. It does **not** work like SQL:

| SQL habit                         | DynamoDB reality                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Design tables, then write queries | Write down your **access patterns** first, then design keys to serve them        |
| `SELECT ... WHERE any_column = ?` | Efficient lookups only work on **key attributes** (table keys or index keys)     |
| JOINs                             | None. Put related data together (same partition) or make several requests        |
| Fixed schema with columns         | Only the **key attributes** are declared. Every other attribute is free-form     |
| One table per entity              | Usually **few tables** with generic keys (`PK`/`SK`) that can hold many entities |

The main rule: **you can only query efficiently by key.** If you need "find X by Y", Y must be part
of a key, either on the table or on an index.

### 1.2 Tables, items, attributes

- **Table**: a collection of items.
- **Item**: one record, like a row. Its maximum size is **400 KB**.
- **Attribute**: a named value on an item. Types include `S` (string), `N` (number), `B` (binary),
  `BOOL`, `NULL`, `L` (list), `M` (map) and sets (`SS`, `NS`, `BS`).

Items in the same table can have completely different attributes. DynamoDB only requires each item
to have the key attributes.

### 1.3 Primary key: partition key + sort key

Every table has a **primary key**, and every item must have it. It comes in two forms:

1. **Partition key only** (also called the "hash key"). Each item has a unique partition key value.
2. **Partition key + sort key** (the sort key is also called the "range key"). The **pair** must be
   unique. Many items can share a partition key as long as their sort keys differ.

```
            Partition key (PK)  Sort key (SK)       other attributes...
           ┌──────────────────┬──────────────────┬────────────────────────────────────┐
partition  │ SPOOLS           │ SPOOL#1          │ name=PLA Spool  weight=1000  ...    │
"SPOOLS" → │ SPOOLS           │ SPOOL#2          │ name=PETG Spool weight=640   ...    │
           │ SPOOLS           │ SPOOL#3          │ name=ABS Spool  weight=120   ...    │
           └──────────────────┴──────────────────┴────────────────────────────────────┘
             items with the same PK are stored together, sorted by SK
```

- The **partition key** decides *which physical partition* (storage node) holds the item. DynamoDB
  hashes it, which is why it's called the hash key.
- The **sort key** orders the items *inside* a partition. All items with the same partition key form
  an **item collection**.

You declare key attribute types when you create the table, and **you cannot change the primary key
afterwards**. Changing it means creating a new table and migrating the data.

### 1.4 The operations (and which ones are cheap)

| Operation                  | What it does                                                                | Cost / speed                    |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| `GetItem`                  | Fetch **one** item by its **full** primary key                              | Cheapest. Single-digit ms       |
| `PutItem`                  | Create the item, or **fully replace** it if one with that key exists        | One write                       |
| `UpdateItem`               | Change some attributes of one item (creates it if missing, unless you add a condition) | One write          |
| `DeleteItem`               | Delete one item by its full key. Succeeds silently if the item is missing   | One write                       |
| `Query`                    | Read items in **one partition**, optionally filtered by a sort key condition | Pays only for items read       |
| `Scan`                     | Read **every item in the table**                                            | Expensive. Avoid in app code    |
| `BatchGetItem` / `BatchWriteItem` | Up to 100 gets or 25 writes per request. Not atomic                  | Same as individual operations   |
| `TransactGetItems` / `TransactWriteItems` | Up to 100 items, all or nothing (ACID)                       | 2× the normal cost              |

Things to remember:

- `Query` **always** needs an exact partition key value (`PK = :value`). The sort key condition is
  optional and can be `=`, `<`, `<=`, `>`, `>=`, `BETWEEN` or `begins_with`.
- `Query` and `Scan` return at most **1 MB per request**. If there's more, the response includes
  `LastEvaluatedKey`, and you pass it back as `ExclusiveStartKey` to get the next page. **You must
  loop**, or you'll silently get partial results.
- A `FilterExpression` on Query/Scan runs **after** the read. You still pay for every item read, and
  the 1 MB limit counts items *before* filtering. A filter is not a substitute for a good key.
- `PutItem` overwrites the existing item by default, so creating can silently replace a record. Use a
  condition to prevent that (see 1.6).

### 1.5 Expressions and placeholders

Request parameters are mostly small expression strings:

- `KeyConditionExpression` (Query): which keys to read.
- `ConditionExpression` (Put/Update/Delete): the write only happens if this is true.
- `UpdateExpression` (Update): `SET a = :v`, `REMOVE b`, `ADD counter :n`, `DELETE someSet :x`.
- `FilterExpression` (Query/Scan): drop items after reading.
- `ProjectionExpression`: return only some attributes.

Values never go directly into the string. Use placeholders instead:

- `:name` placeholders are **values**, defined in `ExpressionAttributeValues`.
- `#name` placeholders are **attribute names**, defined in `ExpressionAttributeNames`. They're
  required when a name is a DynamoDB reserved word (there are hundreds, e.g. `name`, `status`,
  `size`, `data`) or contains special characters. Many codebases, including this one, use `#`
  placeholders for every attribute so they never hit this.

### 1.6 Condition expressions, the key to correct writes

A `ConditionExpression` is checked **atomically, on the server, against the current version of the
item with that key**, in the same step as the write. If it's false, the write doesn't happen and
DynamoDB throws `ConditionalCheckFailedException`.

That gives you, without locks or transactions:

- **Create, but don't overwrite**: `attribute_not_exists(PK)`. This reads as "no item with this exact
  key exists yet". It is **not** "no item anywhere has this PK". The condition is evaluated only
  against the one item addressed by the full key (PK + SK).
- **Update only if it exists**: `attribute_exists(PK)`. Without it, `UpdateItem` on a missing key
  **creates a new partial item**.
- **Business rules**: `weight >= :amount`, `version = :expectedVersion` (optimistic locking), and so on.

This is how you avoid the classic read-modify-write race:

```
 Lambda A: read weight=100 ──┐                       Lambda A: write 100-60=40
                             ├── both see 100 ──►
 Lambda B: read weight=100 ──┘                       Lambda B: write 100-70=30   ← A's update lost,
                                                                                    and 130g used from 100g
```

With `SET weight = weight - :amount` plus the condition `weight >= :amount`, the arithmetic and the
check both run on the server against the latest value. One request succeeds and the other is rejected.

### 1.7 Consistency

- Reads are **eventually consistent by default**. Right after a write, a read *may* return the old
  value for a short time (usually under a second).
- `GetItem` and `Query` accept `ConsistentRead: true` for strongly consistent reads, at 2× the read
  cost. They're not available on GSIs.
- Writes and their condition checks are always consistent.

### 1.8 Secondary indexes

When you need to look items up by something other than the primary key:

- **GSI (Global Secondary Index)**: a second "view" of the table with a different partition key and
  sort key. You can add one at any time. It's always eventually consistent. Write capacity is
  consumed for every index an item appears in. Items that lack the index key attributes don't appear
  in it ("sparse index").
- **LSI (Local Secondary Index)**: same partition key, different sort key. It can **only be created
  together with the table**, and it limits each item collection to 10 GB. Rarely worth it.

### 1.9 Single-table design and generic keys

The common pattern, which this project follows:

- Name the key attributes generically: `PK` and `SK`, not `spoolId`.
- Store **type-prefixed values** in them: `SPOOL#123`, `USER#42`, `PRINT#2026-11-15T10:00`.
- Add an `entityType` attribute so you can tell item types apart when reading raw data.

Different entities can then share one table, related items can share a partition (one `Query` fetches
a user plus all their spools), and new access patterns usually need only new key *values*. The table
definition stays the same.

### 1.10 Capacity, billing and limits

- **On-demand** (`PAY_PER_REQUEST`): pay per read and write, no capacity planning. This project uses it.
- **Provisioned**: you reserve read/write capacity units, which is cheaper at steady high load.
- Write cost is 1 WCU per 1 KB written. Read cost is 1 RCU per 4 KB for a strongly consistent read,
  and half that for an eventually consistent one.
- **Per-partition throughput limit**: one partition key value can handle roughly 3,000 reads/s and
  1,000 writes/s. Too much traffic on one key is a **hot partition**. Spread load across key values
  when you expect high traffic.

### 1.11 Other features worth knowing (not used here yet)

- **TTL**: mark a number attribute as an expiry timestamp, and DynamoDB deletes the item for free
  after that time.
- **Streams**: an ordered change log of the table that can trigger Lambdas (events, projections, audit).
- **Point-in-time recovery (PITR)**: continuous backups for restoring to any second in the last 35
  days. It's billed per GB of table data, so this project turns it **off** to save money.
- **Deletion protection**: the table can't be deleted until the flag is turned off.

---

## Part 2: How this project uses DynamoDB

### 2.1 The big picture

```
                    ┌──────────────────────────────────────────────┐
                    │ @printmaster/filament-management             │
                    │                                              │
                    │  src/persistence/tables.ts   ◄── single source of truth
                    │    spoolsTable: TableDefinition              │  for table shape
                    │       │                │                     │
                    │       │                ▼                     │
                    │       │   dynamodb-spool.repository.ts       │
                    │       │   spool.item.ts (keys + mappers)     │
                    │       │                ▲                     │
                    │       │   FilamentManagementService          │
                    └───────┼────────────────┼─────────────────────┘
       imported as          │                │ built by createFilamentManagementService()
  "@pm/fm/tables"           ▼                │
                    ┌──────────────┐   ┌─────┴─────────────────────┐
                    │ infra (CDK)  │   │ lambdas/* (one per route) │
                    │ DataStack    │   │ reads FILAMENT_SPOOLS_    │
                    │  createTable │   │ TABLE_NAME from env       │
                    │ ApiStack     │──►│ (set by ApiStack)         │
                    │  grants+env  │   └───────────────────────────┘
                    └──────────────┘
                                ▲
                    @printmaster/dynamodb: TableDefinition type, DocumentClient,
                    requireEnv, queryAll/queryPage, isConditionalCheckFailed
```

The design idea is that **the domain package owns its table**. It describes the table once, in a
framework-neutral way, and two consumers use that description:

1. **Infra** turns it into a real CloudFormation table.
2. **The repository adapter** uses the same key names and env var name at runtime.

That way infra and runtime code can't disagree about key names.

### 2.2 The schema, part A: the table definition

`src/persistence/tables.ts`

```ts
export const spoolsTable = {
  id: "FilamentSpoolsTable",            // CDK construct id → CloudFormation logical ID. NEVER change.
  envVar: "FILAMENT_SPOOLS_TABLE_NAME", // how Lambdas learn the generated table name
  partitionKey: { name: "PK", type: "S" },
  sortKey: { name: "SK", type: "S" },
} as const satisfies TableDefinition;
```

- `TableDefinition` (`packages/dynamodb/src/schema.ts`) is a **types-only** description: key names,
  key types (`S`/`N`/`B`) and optional GSIs. It has no CDK or AWS SDK dependency, so both the Lambda
  bundle and the CDK app can import it.
- This file may **only have type imports**. Infra imports it, and you don't want the AWS SDK pulled
  into the CDK app this way.
- It declares only the **key attributes** (Part 1.2). `name`, `color`, `weight` and the rest aren't
  declared anywhere in DynamoDB. They're attributes the code writes.
- `id` is permanent. CDK derives the table's logical ID from it (`FilamentSpoolsTable615771BD`). If
  the logical ID changes, CloudFormation thinks the old table was removed and a new one added, so it
  **deletes the old table and its data**. `infra/test/data-stack.test.ts` pins this ID so an
  accidental rename fails the tests.
- There is **no `tableName`**. CloudFormation generates a unique physical name such as
  `PrintMaster-Data-Dev-FilamentSpoolsTable615771BD-XXXX`. Hardcoded names prevent replacements and
  break multi-stage deployments.

### 2.3 The schema, part B: the item shape

`src/persistence/spool.item.ts`

The domain type `FilamentSpool` (`src/types/filament-spool.type.ts`) knows nothing about DynamoDB:

```ts
{ id, name, color, material, initialWeight, weight }
```

The **item** adds the storage attributes:

```ts
SpoolItem = FilamentSpool & { PK: "SPOOLS"; SK: `SPOOL#${id}`; entityType: "Spool" }
```

A stored item looks like this:

```json
{
  "PK": "SPOOLS",
  "SK": "SPOOL#3f0c9a8e-...",
  "entityType": "Spool",
  "id": "3f0c9a8e-...",
  "name": "PLA Spool",
  "color": "Red",
  "material": "PLA",
  "initialWeight": 1000,
  "weight": 640
}
```

The file contains:

- `spoolKey(id)` builds the full primary key `{ PK: "SPOOLS", SK: "SPOOL#<id>" }`. Every
  Get/Update/Delete uses it, so key formatting lives in one place.
- `toSpoolItem(spool)` maps domain → item: it adds `PK`, `SK` and `entityType`.
- `fromSpoolItem(item)` maps item → domain: it strips them again.

**Why do all spools share one partition (`PK = "SPOOLS"`)?** Look at the access patterns, which come
first in DynamoDB design:

| Access pattern        | How it's served                                 |
| --------------------- | ----------------------------------------------- |
| Get spool by id       | `GetItem` with `{PK: "SPOOLS", SK: "SPOOL#id"}` |
| Update / delete by id | Same key                                        |
| **List all spools**   | `Query PK = "SPOOLS"`, one partition            |

If each spool had its own partition (`PK = SPOOL#<id>`), "list all" would need a **Scan** or a GSI.
Putting them all in one partition makes listing a single cheap `Query`. The trade-off is that one
partition gets all the traffic. That's fine at this scale (it's far below the ~1,000 writes/s
per-partition limit). The comment in `spool.item.ts` already gives the next step: when users exist,
the partition becomes `USER#<userId>`, so every user gets their own partition and "list my spools"
stays a single `Query`.

The `SPOOL#` prefix on the sort key makes room for other entity types in the same partition later
(e.g. `USAGE#<timestamp>`), and lets you query one type with `begins_with(SK, "SPOOL#")`.

### 2.4 How infra creates the table

**`infra/bin/app.ts`** creates two stacks:

```ts
const data = new DataStack(app, "PrintMaster-Data-Dev", {
  removalPolicy: cdk.RemovalPolicy.DESTROY, // dev: `cdk destroy` deletes the table
  deletionProtection: false,
});
new ApiStack(app, "PrintMaster-Api-Dev", { spoolsTable: data.spoolsTable });
```

The **stateful** part (data) and the **stateless** part (Lambdas, API) are separate stacks, so you can
tear down and redeploy the API freely without endangering the table.

**`infra/lib/data-stack.ts`** imports the domain's definition and creates the table:

```ts
import { spoolsTable } from "@printmaster/filament-management/tables";
this.spoolsTable = createTable(this, spoolsTable, options);
```

**`infra/lib/tables.ts`**, `createTable()`, turns the `TableDefinition` into a CDK `TableV2`:

```ts
new dynamodb.TableV2(scope, def.id, {
  partitionKey: { name: "PK", type: STRING },
  sortKey:      { name: "SK", type: STRING },
  globalSecondaryIndexes: def.globalSecondaryIndexes?.map(...), // none yet
  billing: dynamodb.Billing.onDemand(),                         // pay per request
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false }, // no backups (cost)
  removalPolicy, deletionProtection,                            // from stack props
});
```

Notes:

- `TableV2` synthesizes to the CloudFormation type **`AWS::DynamoDB::GlobalTable`**, which is why the
  infra tests look for that type. With a single region it's an ordinary table, but adding replica
  regions later doesn't require replacing it.
- Only `PK` and `SK` appear in `AttributeDefinitions`. CloudFormation (and DynamoDB) only want key
  attributes declared there. Declaring a non-key attribute is an error.
- In dev, `removalPolicy: DESTROY` means the data is disposable. The comment in `app.ts` describes the
  prod setup: `RETAIN`, `deletionProtection: true`, and stack termination protection.

**`infra/lib/api-stack.ts`** gives each Lambda access to the table. `createFunction` takes a list of
`TableAccess` entries:

```ts
fn.addEnvironment(def.envVar, table.tableName); // FILAMENT_SPOOLS_TABLE_NAME=<generated name>
if (access === "readwrite") table.grantReadWriteData(fn);
else table.grantReadData(fn);
```

- **IAM**: `grantReadData` allows `GetItem`, `Query`, `Scan`, `BatchGetItem` and similar actions.
  `grantReadWriteData` adds `PutItem`, `UpdateItem`, `DeleteItem` and `BatchWriteItem`. Each function
  gets least privilege. The routes `GET /spools`, `GET /spools/{id}` and `/hello` get `read`, while
  create, delete and subtract-weight get `readwrite`.
- **Table name**: it reaches the function as an env var. That's the only link between infra and
  runtime code.
- **Cross-stack reference**: `table.tableName` lives in another stack. The `ApiStack` uses
  `ReferenceStrength.WEAK` (`Fn::GetStackOutput`) instead of classic CloudFormation exports. With
  classic exports, you can't remove or change a table the API stack still uses without a two-step
  deploy (the "export cannot be deleted as it is in use" deadlock).

### 2.5 How the runtime connects

**`packages/dynamodb/src/client.ts`**

```ts
DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint? }), {
  marshallOptions: { removeUndefinedValues: true },
});
```

- The low-level `DynamoDBClient` speaks DynamoDB's wire format, where every value is tagged:
  `{ "weight": { "N": "640" } }`.
- The **DocumentClient** (`@aws-sdk/lib-dynamodb`) wraps it and **marshals** plain JS values
  automatically: `{ weight: 640 }`. That's why the repository code works with plain objects.
- `removeUndefinedValues: true` drops `undefined` properties. Without it, the SDK throws when an
  object contains `undefined`.
- `DYNAMODB_ENDPOINT`, if set, points the client at DynamoDB Local for offline development.
- `getDocumentClient()` is a **module-level singleton**. Lambda containers are reused between
  invocations ("warm starts"), so creating the client once keeps its HTTP connections alive.

**`src/create-service.ts`** is the composition root:

```ts
new FilamentManagementService(
  new DynamoDbFilamentSpoolRepository(getDocumentClient(), requireEnv(spoolsTable.envVar)),
);
```

Every Lambda calls it **once at module scope** (outside the handler), for example in
`lambdas/list-spools/src/index.ts`. If the env var is missing, `requireEnv` throws a
`ConfigurationError` at cold start rather than in the middle of a request.

### 2.6 How it's queried: each repository method

All of this is in `src/persistence/dynamodb-spool.repository.ts`.

#### `findAll()`: `Query` on the spools partition

```ts
queryAll(db, {
  KeyConditionExpression: "#pk = :pk",
  ExpressionAttributeNames: { "#pk": "PK" },
  ExpressionAttributeValues: { ":pk": "SPOOLS" },
});
```

- It's a `Query`, **not** a `Scan`: DynamoDB reads only the `SPOOLS` partition.
- Results come back **sorted by SK** (`SPOOL#<uuid>`). With random UUIDs, that's effectively random
  order, not creation order. If you want "newest first", put a timestamp in the sort key (e.g.
  `SPOOL#<createdAt>#<id>`) and pass `ScanIndexForward: false`.
- `queryAll` (`packages/dynamodb/src/pagination.ts`) loops on `LastEvaluatedKey` until all pages are
  read (Part 1.4, 1 MB limit). That's fine for a small, bounded partition. Its comment warns not to
  use it for unbounded data.
- For an API that returns pages, `queryPage` returns one page plus an opaque `nextCursor`, which is
  `LastEvaluatedKey` JSON-encoded as base64url. `decodeCursor` validates it. Nothing uses `queryPage`
  yet.
- The read is eventually consistent, so a spool created a moment ago can be missing from the list
  for a short time.

#### `findById(id)`: `GetItem` by full key

```ts
new GetCommand({ TableName, Key: { PK: "SPOOLS", SK: "SPOOL#<id>" } });
```

This is the cheapest possible read. A missing item returns no `Item`, which the method turns into
`null`.

#### `create(spool)`: conditional `PutItem`

```ts
new PutCommand({
  Item: toSpoolItem(spool),
  ConditionExpression: "attribute_not_exists(#pk)",
  ExpressionAttributeNames: { "#pk": "PK" },
});
```

- Without the condition, a `Put` with an existing key would **silently replace** that spool.
- `attribute_not_exists(PK)` is evaluated against the item with this exact `PK` + `SK`. It means
  "this spool id isn't taken". It does **not** mean "the SPOOLS partition is empty".
- The service generates the id with `randomUUID()`, so a collision is practically impossible. If one
  happened, the `ConditionalCheckFailedException` isn't caught here, and the API would answer with a
  generic 500.

#### `subtractWeight(id, amount)`: atomic conditional `UpdateItem`

```ts
new UpdateCommand({
  Key: spoolKey(id),
  UpdateExpression: "SET #weight = #weight - :amount",
  ConditionExpression: "attribute_exists(#pk) AND #weight >= :amount",
  ReturnValues: "ALL_NEW",
});
```

This is the most important example in the package:

- **The arithmetic runs on the server.** `#weight - :amount` uses the stored value, so the Lambda
  never reads the old value first. That avoids the race shown in Part 1.6.
- **`attribute_exists(#pk)`**: without it, `UpdateItem` on an unknown id would *create* a broken item
  containing only `PK`, `SK` and a negative `weight`.
- **`#weight >= :amount`** enforces "can't go below zero" atomically.
- **`ReturnValues: "ALL_NEW"`** returns the item as it is after the update, which saves a read.
- **Error path**: when the condition fails, DynamoDB only says "condition failed", not *which* part
  failed. So, on this rare path only, the code does one `findById` to find out. A missing item becomes
  `SpoolNotFoundError` (HTTP 404). An item that exists becomes `InsufficientFilamentError` with the
  current weight (HTTP 409). The mapping to HTTP codes is in `packages/api-utils`. Any other error,
  such as throttling, is rethrown unchanged.
- `isConditionalCheckFailed` checks `err.name`, not `instanceof`, so it still works if the bundle ends
  up with two copies of the SDK.

#### `deleteById(id)`: `DeleteItem` with `ReturnValues: "ALL_OLD"`

```ts
new DeleteCommand({ Key: spoolKey(id), ReturnValues: "ALL_OLD" });
```

`DeleteItem` succeeds even if the item doesn't exist. Asking for `ALL_OLD` returns the deleted item
(or nothing), and that answers "was something deleted?" in a single request. The service turns
`false` into `SpoolNotFoundError` (404).

### 2.7 Why the repository has intent-level methods

`FilamentSpoolRepository` (`src/filament-management.repository.ts`) has `create`, `subtractWeight` and
`deleteById`, not a generic `save(spool)`. A generic `save` would force the read-modify-write pattern:
the service loads the spool, changes `weight` in memory, and saves it back, which is exactly the lost
update race. Methods named after the intent let the DynamoDB adapter express each one as a **single
conditional request**.

`InMemoryFilamentSpoolRepository` implements the same contract for service tests, so business logic
can be tested without AWS.

### 2.8 How it's tested

| Test                                     | What it checks                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `test/spool.item.test.ts`                | Key format (`SPOOLS` / `SPOOL#id`), key names match `tables.ts`, mapper round-trip |
| `test/dynamodb-spool.repository.test.ts` | Mocks the DocumentClient with `aws-sdk-client-mock`; checks the exact command inputs (expressions, conditions, ReturnValues) and the error mapping |
| `test/filament-management.service.test.ts` | Business rules against the in-memory repository                                 |
| `infra/test/data-stack.test.ts`          | Logical ID pinned, PK/SK keys, no hardcoded name, on-demand, PITR off, removal policy |

These tests check that the code *sends the right requests*. They don't run them against a real
DynamoDB, so conditions aren't actually evaluated. To test that behaviour end to end, run DynamoDB
Local (`docker run -p 8000:8000 amazon/dynamodb-local`), set `DYNAMODB_ENDPOINT=http://localhost:8000`,
and create the table there.

---

## Part 3: Cheat sheet for changing things

**Add an attribute to spools** (e.g. `brand`): add it to `FilamentSpool` and the service. That's all.
Non-key attributes aren't declared in DynamoDB, so infra doesn't change. Items that already exist
won't have the attribute, so treat it as optional when reading.

**Add a new access pattern** (e.g. "spools by material"):

1. If it's within one partition and maps to the sort key, use a `Query` with
   `begins_with(SK, :prefix)` or similar. No infra change.
2. Otherwise, add a GSI to `spoolsTable.globalSecondaryIndexes` (e.g. `GSI1PK = MATERIAL#PLA`,
   `GSI1SK = SPOOL#<id>`), write those attributes in `toSpoolItem`, and query with `IndexName`.
   `createTable` already maps GSIs. Items written before the GSI existed won't have the index
   attributes until you backfill them.

**Add a new entity / table**: put the definition in the owning domain package's
`src/persistence/tables.ts`, add `createTable(...)` to `DataStack`, pass the table to `ApiStack`
through props, and grant access via `createFunction`'s `tables` argument. Before adding a *table*,
consider whether the entity can live in the existing table under a new key prefix.

**Never**:

- rename `spoolsTable.id` (the table gets replaced and the data is lost);
- change `partitionKey`/`sortKey` on an existing table (that also forces replacement);
- set `tableName`;
- use `Scan` for request-time reads;
- do read-modify-write when a conditional update can do the job.

**Changing the partition layout** (e.g. `SPOOLS` → `USER#<id>`) changes key *values*, not the table
definition. Existing items keep their old keys, though, so you need a migration script that rewrites
them (a new item with the new key, then delete the old one).
