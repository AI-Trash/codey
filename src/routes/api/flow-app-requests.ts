import { createFileRoute } from "@tanstack/react-router";
import { createFlowAppRequest } from "../../lib/server/admin";
import { json, text } from "../../lib/server/http";
import {
  readJsonBody,
  requireFlowAppApiKey,
} from "../../lib/server/request";

interface FlowAppRequestBody {
  appName?: string;
  flowType?: string;
  requestedBy?: string;
  requestedIdentity?: string;
  notes?: string;
}

export const Route = createFileRoute("/api/flow-app-requests")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = requireFlowAppApiKey(request);
        if (authError) {
          return authError;
        }

        const body = await readJsonBody<FlowAppRequestBody>(request);
        const appName = String(body.appName || "").trim();
        if (!appName) {
          return text("appName is required", 400);
        }

        const record = await createFlowAppRequest({
          appName,
          flowType: String(body.flowType || "").trim() || undefined,
          requestedBy: String(body.requestedBy || "").trim() || undefined,
          requestedIdentity:
            String(body.requestedIdentity || "").trim() || undefined,
          notes: String(body.notes || "").trim() || undefined,
        });

        return json({ ok: true, id: record.id }, 201);
      },
    },
  },
});
