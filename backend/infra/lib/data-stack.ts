import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import { spoolsTable } from "@printmaster/filament-management/tables";
import { createTable, type TableOptions } from "./tables.js";

export interface DataStackProps extends cdk.StackProps, TableOptions {}

/**
 * Stateful resources only, kept apart from the stateless API stack so that stack can be destroyed
 * or re-created freely. Construct ids here are permanent: changing one replaces the table.
 */
export class DataStack extends cdk.Stack {
  public readonly spoolsTable: dynamodb.ITableV2;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const options: TableOptions = {
      removalPolicy: props.removalPolicy,
      deletionProtection: props.deletionProtection,
    };
    this.spoolsTable = createTable(this, spoolsTable, options);
  }
}
