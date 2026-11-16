import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { spoolsTable as spoolsTableDef } from "@printmaster/filament-management/tables";
import type { TableAccess } from "./tables.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lambdasDir = path.join(__dirname, "../../lambdas");
const lambdaRoot = path.join(lambdasDir, "my-lambda");
const workspaceRoot = path.join(__dirname, "../../");

export interface ApiStackProps extends cdk.StackProps {
  /** Owned by DataStack; passed in so the table's lifecycle stays independent of this stack. */
  readonly spoolsTable: dynamodb.ITableV2;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Weak references (Fn::GetStackOutput) instead of CloudFormation exports: avoids the
    // "export cannot be deleted as it is in use" deadlock when tables are added or removed.
    // DataStack is protected by its removal policy / deletion protection instead.
    cdk.CrossStackReferences.of(this).consume(cdk.ReferenceStrength.WEAK);

    const spools =(access: TableAccess["access"]): TableAccess => ({
      def: spoolsTableDef,
      table: props.spoolsTable,
      access,
    });

    const fn = this.createFunction("Hello", path.join(lambdaRoot, "src/index.ts"), [
      spools("read"),
    ]);

    const api = new apigw.HttpApi(this, "HttpApi", {
      apiName: "printmaster-api",
    });

    api.addRoutes({
      path: "/hello",
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration("HelloIntegration", fn),
    });

    const spoolRoutes: Array<{
      id: string;
      dir: string;
      method: apigw.HttpMethod;
      path: string;
      access: TableAccess["access"];
    }> = [
      {
        id: "ListSpools",
        dir: "list-spools",
        method: apigw.HttpMethod.GET,
        path: "/spools",
        access: "read",
      },
      {
        id: "GetSpool",
        dir: "get-spool",
        method: apigw.HttpMethod.GET,
        path: "/spools/{id}",
        access: "read",
      },
      {
        id: "CreateSpool",
        dir: "create-spool",
        method: apigw.HttpMethod.POST,
        path: "/spools",
        access: "readwrite",
      },
      {
        id: "DeleteSpool",
        dir: "delete-spool",
        method: apigw.HttpMethod.DELETE,
        path: "/spools/{id}",
        access: "readwrite",
      },
      {
        id: "SubtractSpoolWeight",
        dir: "subtract-weight",
        method: apigw.HttpMethod.POST,
        path: "/spools/{id}/subtract-weight",
        access: "readwrite",
      },
    ];

    for (const route of spoolRoutes) {
      api.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new HttpLambdaIntegration(
          `${route.id}Integration`,
          this.createFunction(route.id, path.join(lambdasDir, route.dir, "src/index.ts"), [
            spools(route.access),
          ]),
        ),
      });
    }

    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
  }

  private createFunction(
    name: string,
    entry: string,
    tables: readonly TableAccess[] = [],
  ): nodejs.NodejsFunction {
    // Explicit log group: without a retention setting, logs are kept forever (and billed).
    const logGroup = new logs.LogGroup(this, `${name}FunctionLogs`, {
      retention: logs.RetentionDays.FIVE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // `cdk destroy` also deletes the logs
    });

    const fn = new nodejs.NodejsFunction(this, `${name}Function`, {
      entry,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // cheaper, same perf for most workloads
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logGroup,
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
      },
      projectRoot: workspaceRoot,
      depsLockFilePath: path.join(workspaceRoot, "pnpm-lock.yaml"),
      bundling: {
        format: nodejs.OutputFormat.ESM, // your code is "type": "module"
        target: "node22",
        sourceMap: true,
        minify: false,
        externalModules: ["@aws-sdk/*"], // AWS SDK v3 is provided by the Lambda runtime
        mainFields: ["module", "main"],
      },
    });

    for (const { def, table, access } of tables) {
      // Generated table name (a cross-stack reference), never a hardcoded physical name.
      fn.addEnvironment(def.envVar, table.tableName);
      if (access === "readwrite") table.grantReadWriteData(fn);
      else table.grantReadData(fn);
    }

    return fn;
  }
}
