// Types only, no imports: consumed by both runtime adapters and the CDK app (infra).

export type KeyAttribute = {
  readonly name: string;
  readonly type: "S" | "N" | "B";
};

export type GlobalSecondaryIndexDefinition = {
  readonly indexName: string;
  readonly partitionKey: KeyAttribute;
  readonly sortKey?: KeyAttribute;
};

/**
 * Framework-neutral description of a DynamoDB table. The owning domain package declares it once;
 * infra turns it into a CDK table and the repository adapter uses it for key names and the env var.
 */
export type TableDefinition = {
  /** CDK construct id, which becomes the logical ID. NEVER rename: renaming replaces the table. */
  readonly id: string;
  /** Env var through which Lambdas receive the generated table name. Convention: <NAME>_TABLE_NAME. */
  readonly envVar: string;
  readonly partitionKey: KeyAttribute;
  readonly sortKey?: KeyAttribute;
  readonly globalSecondaryIndexes?: readonly GlobalSecondaryIndexDefinition[];
};
