import { createFilamentManagementService } from "@printmaster/filament-management";
import { json, parseJsonBody, withErrorHandling } from "@printmaster/api-utils";

const service = createFilamentManagementService();

export const handler = withErrorHandling(async (event) => {
  const body = parseJsonBody(event);
  const spool = await service.create({
    name: body.name as string,
    color: body.color as string,
    material: body.material as never,
    initialWeight: body.initialWeight as number,
  });
  return json(201, { data: spool });
});
