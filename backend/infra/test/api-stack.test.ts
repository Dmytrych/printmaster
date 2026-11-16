import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack.js";
import { DataStack } from "../lib/data-stack.js";

const env = { account: "123456789012", region: "eu-central-1" };
const app = new cdk.App();
const data = new DataStack(app, "TestDataStack", {
  env,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  deletionProtection: false,
});
const stack = new ApiStack(app, "TestStack", { env, spoolsTable: data.spoolsTable });
const template = Template.fromStack(stack);

type Statement = { Action: string | string[] };
type Resource = { Properties: Record<string, unknown> };

/** Maps each function's logical ID to the IAM actions its role is granted. */
const actionsByFunction = (): Map<string, Set<string>> => {
  const policies = Object.values(template.findResources("AWS::IAM::Policy")) as Resource[];
  const actionsByRole = new Map<string, Set<string>>();
  for (const policy of policies) {
    const roles = policy.Properties.Roles as Array<{ Ref: string }>;
    const statements = (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement;
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    for (const { Ref } of roles) {
      const set = actionsByRole.get(Ref) ?? new Set<string>();
      for (const a of actions) set.add(a);
      actionsByRole.set(Ref, set);
    }
  }
  const functions = template.findResources("AWS::Lambda::Function") as Record<string, Resource>;
  return new Map(
    Object.entries(functions).map(([id, fn]) => {
      const role = (fn.Properties.Role as { "Fn::GetAtt": [string, string] })["Fn::GetAtt"][0];
      return [id, actionsByRole.get(role) ?? new Set<string>()];
    }),
  );
};

const actionsFor = (prefix: string): Set<string> => {
  const match = [...actionsByFunction()].find(([id]) => id.startsWith(`${prefix}Function`));
  assert.ok(match, `function ${prefix} not found`);
  return match[1];
};

test("lambda is configured as expected", () => {
  template.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "nodejs22.x",
    Architectures: ["arm64"],
    MemorySize: 256,
    Timeout: 10,
    Handler: "index.handler",
  });
});

test("log group has 5-day retention and is wired to the function", () => {
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 5 });
  template.hasResourceProperties("AWS::Lambda::Function", {
    LoggingConfig: { LogGroup: Match.anyValue() },
  });
});

test("deprecated LogRetention helper is not used", () => {
  template.resourceCountIs("Custom::LogRetention", 0);
  // Only the app functions (hello + 5 spool lambdas) should exist (no helper Lambdas).
  template.resourceCountIs("AWS::Lambda::Function", 6);
});

test("GET /hello route exists and only API Gateway may invoke the lambda", () => {
  template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    RouteKey: "GET /hello",
  });
  template.hasResourceProperties("AWS::Lambda::Permission", {
    Action: "lambda:InvokeFunction",
    Principal: "apigateway.amazonaws.com",
  });
});

test("ApiUrl output exists", () => {
  template.hasOutput("ApiUrl", {});
});

test("every function receives the generated spools table name via its env var", () => {
  const functions = Object.values(template.findResources("AWS::Lambda::Function")) as Resource[];
  assert.equal(functions.length, 6);
  for (const fn of functions) {
    const vars = (fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables;
    // Weak cross-stack reference to the DataStack table, not a hardcoded string or an export.
    assert.deepEqual(Object.keys(vars.FILAMENT_SPOOLS_TABLE_NAME as object), [
      "Fn::GetStackOutput",
    ]);
  }
});

test("read-only routes cannot write to the spools table", () => {
  for (const name of ["Hello", "ListSpools", "GetSpool"]) {
    const actions = actionsFor(name);
    assert.ok(actions.has("dynamodb:GetItem"), `${name} should read`);
    assert.ok(actions.has("dynamodb:Query"), `${name} should query`);
    assert.ok(!actions.has("dynamodb:PutItem"), `${name} must not write`);
    assert.ok(!actions.has("dynamodb:DeleteItem"), `${name} must not delete`);
  }
});

test("write routes can read and write the spools table", () => {
  for (const name of ["CreateSpool", "DeleteSpool", "SubtractSpoolWeight"]) {
    const actions = actionsFor(name);
    for (const action of ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]) {
      assert.ok(actions.has(action), `${name} should have ${action}`);
    }
  }
});
