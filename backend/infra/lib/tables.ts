import type * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { KeyAttribute, TableDefinition } from "@printmaster/dynamodb/schema";

export interface TableOptions {
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly deletionProtection: boolean;
}

/** Which permissions a Lambda gets on a table, and through which env var it receives the name. */
export interface TableAccess {
  readonly def: TableDefinition;
  readonly table: dynamodb.ITableV2;
  readonly access: "read" | "readwrite";
}

const attributeTypes: Record<KeyAttribute["type"], dynamodb.AttributeType> = {
  S: dynamodb.AttributeType.STRING,
  N: dynamodb.AttributeType.NUMBER,
  B: dynamodb.AttributeType.BINARY,
};

const toAttribute = (key: KeyAttribute): dynamodb.Attribute => ({
  name: key.name,
  type: attributeTypes[key.type],
});

/**
 * Creates a table from a domain-owned definition. The physical name is deliberately not set:
 * CloudFormation generates it, and Lambdas receive it via `def.envVar`.
 */
export const createTable = (
  scope: Construct,
  def: TableDefinition,
  options: TableOptions,
): dynamodb.TableV2 =>
  new dynamodb.TableV2(scope, def.id, {
    partitionKey: toAttribute(def.partitionKey),
    ...(def.sortKey ? { sortKey: toAttribute(def.sortKey) } : {}),
    globalSecondaryIndexes: def.globalSecondaryIndexes?.map((gsi) => ({
      indexName: gsi.indexName,
      partitionKey: toAttribute(gsi.partitionKey),
      ...(gsi.sortKey ? { sortKey: toAttribute(gsi.sortKey) } : {}),
    })),
    billing: dynamodb.Billing.onDemand(),
    // Off to minimise cost: PITR is billed per GB stored. Data here is treated as disposable.
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    removalPolicy: options.removalPolicy,
    deletionProtection: options.deletionProtection,
  });
