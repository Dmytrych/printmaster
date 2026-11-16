import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { isConditionalCheckFailed, queryAll } from "@printmaster/dynamodb";
import { InsufficientFilamentError, SpoolNotFoundError } from "../errors.js";
import type { FilamentSpoolRepository } from "../filament-management.repository.js";
import type { FilamentSpool } from "../types/filament-spool.type.js";
import {
  SPOOLS_PARTITION,
  fromSpoolItem,
  spoolKey,
  toSpoolItem,
  type SpoolItem,
} from "./spool.item.js";
import { spoolsTable } from "./tables.js";

const PK = spoolsTable.partitionKey.name;

/** DynamoDB-backed spool repository. See `spool.item.ts` for the key design. */
export class DynamoDbFilamentSpoolRepository implements FilamentSpoolRepository {
  public constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  public async findAll(): Promise<FilamentSpool[]> {
    const items = await queryAll<SpoolItem>(this.db, {
      TableName: this.tableName,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": PK },
      ExpressionAttributeValues: { ":pk": SPOOLS_PARTITION },
    });
    return items.map(fromSpoolItem);
  }

  public async findById(id: string): Promise<FilamentSpool | null> {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: spoolKey(id) }),
    );
    return Item ? fromSpoolItem(Item as SpoolItem) : null;
  }

  public async create(spool: FilamentSpool): Promise<FilamentSpool> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toSpoolItem(spool),
        // Never overwrite an existing spool.
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": PK },
      }),
    );
    return { ...spool };
  }

  public async subtractWeight(id: string, amount: number): Promise<FilamentSpool> {
    try {
      const { Attributes } = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: spoolKey(id),
          // Check and write in one request, so concurrent subtractions can't lose updates.
          UpdateExpression: "SET #weight = #weight - :amount",
          ConditionExpression: "attribute_exists(#pk) AND #weight >= :amount",
          ExpressionAttributeNames: { "#pk": PK, "#weight": "weight" },
          ExpressionAttributeValues: { ":amount": amount },
          ReturnValues: "ALL_NEW",
        }),
      );
      return fromSpoolItem(Attributes as SpoolItem);
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err;
      // Failure path only: read once to report the right reason.
      const current = await this.findById(id);
      if (!current) throw new SpoolNotFoundError(id);
      throw new InsufficientFilamentError(id, current.weight, amount);
    }
  }

  public async deleteById(id: string): Promise<boolean> {
    const { Attributes } = await this.db.send(
      new DeleteCommand({ TableName: this.tableName, Key: spoolKey(id), ReturnValues: "ALL_OLD" }),
    );
    return Attributes !== undefined;
  }
}
