import { createFilamentManagementService } from "@printmaster/filament-management";
import { getPathId, json, withErrorHandling } from "@printmaster/api-utils";

const service = createFilamentManagementService();

export const handler = withErrorHandling(async (event) => {
  const spool = await service.getById(getPathId(event));
  return json(200, { data: spool });
});
