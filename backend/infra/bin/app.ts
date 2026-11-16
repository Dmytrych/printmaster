#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack.js";
import { DataStack } from "../lib/data-stack.js";

const app = new cdk.App();

// Uses whatever account/region your current AWS credentials point to.
// For production, hard-code them so a wrong profile can't deploy to the wrong account:
// env: { account: "123456789012", region: "eu-central-1" },
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
const tags = { project: "printmaster", env: "dev" };

// Stateful resources. Dev data is disposable; a prod stage would use RETAIN,
// deletionProtection: true and terminationProtection: true.
const data = new DataStack(app, "PrintMaster-Data-Dev", {
  env,
  tags,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  deletionProtection: false,
});

new ApiStack(app, "PrintMaster-Api-Dev", {
  env,
  tags,
  spoolsTable: data.spoolsTable,
});
