import { createFilamentManagementService } from "@printmaster/filament-management";
import { getPathId, json, withErrorHandling } from "@printmaster/api-utils";

const service = createFilamentManagementService();

export const handler = withErrorHandling(async (event) => {
  await service.delete(getPathId(event));
  return json(204);
});
