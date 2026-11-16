import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { createFilamentManagementService } from "@printmaster/filament-management";

const service = createFilamentManagementService();

export const handler = async (): Promise<APIGatewayProxyResultV2> => {
  const spools = await service.getAll();

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: spools }),
  };
};
