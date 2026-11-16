import { createFilamentManagementService } from "@printmaster/filament-management";
import { json, withErrorHandling } from "@printmaster/api-utils";

const service = createFilamentManagementService();

export const handler = withErrorHandling(async () => {
  const spools = await service.getAll();
  return json(200, { data: spools });
});
