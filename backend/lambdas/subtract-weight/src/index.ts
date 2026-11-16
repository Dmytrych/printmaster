import { createFilamentManagementService } from "@printmaster/filament-management";
import { getPathId, json, parseJsonBody, withErrorHandling } from "@printmaster/api-utils";

const service = createFilamentManagementService();

export const handler = withErrorHandling(async (event) => {
  const { amount } = parseJsonBody(event);
  const spool = await service.subtractWeight(getPathId(event), amount as number);
  return json(200, { data: spool });
});
