import "@tanstack/react-start/server-only";

import {
  createCliFlowTaskPayload,
  getCliFlowDefinition,
  normalizeCliFlowConfig,
} from "../../../packages/cli/src/modules/flow-cli/flow-registry";
import {
  getAdminCliConnectionSummaryById,
  type CliConnectionActorScope,
  isCliConnectionOwnedByActor,
  isSharedCliConnection,
} from "./cli-connections";
import { getDb } from "./db/client";
import { adminNotifications } from "./db/schema";
import { createId } from "./security";

function buildTaskTitle(flowId: string) {
  return `Dispatch ${flowId}`;
}

function buildTaskBody(input: {
  flowId: string;
  cliName?: string | null;
  configCount: number;
}) {
  const target = input.cliName?.trim() || "CLI";
  const configLabel = input.configCount === 1 ? "override" : "overrides";
  return `Run ${input.flowId} on ${target} with ${input.configCount} ${configLabel}.`;
}

export async function dispatchCliFlowTask(input: {
  connectionId: string;
  flowId: string;
  config?: Record<string, unknown> | null;
  actor?: CliConnectionActorScope;
}) {
  const connection = await getAdminCliConnectionSummaryById(input.connectionId);
  if (!connection) {
    throw new Error("CLI connection not found.");
  }

  if (
    input.actor &&
    !isCliConnectionOwnedByActor(connection, input.actor) &&
    !isSharedCliConnection(connection)
  ) {
    throw new Error(
      "You can only dispatch tasks to your own CLI connection or a shared service-client connection.",
    );
  }

  if (connection.status !== "active") {
    throw new Error("CLI connection is no longer active.");
  }

  if (!connection.registeredFlows.length) {
    throw new Error(
      "This CLI has not reported any dispatchable flows yet. Reconnect the daemon and try again.",
    );
  }

  if (!connection.registeredFlows.includes(input.flowId)) {
    throw new Error("The selected flow is not registered on this CLI.");
  }

  const flowDefinition = getCliFlowDefinition(input.flowId);
  if (!flowDefinition) {
    throw new Error("Unsupported flow type.");
  }

  const config = normalizeCliFlowConfig(flowDefinition.id, input.config);
  const [notification] = await getDb()
    .insert(adminNotifications)
    .values({
      id: createId(),
      title: buildTaskTitle(flowDefinition.id),
      body: buildTaskBody({
        flowId: flowDefinition.id,
        cliName: connection.cliName,
        configCount: Object.keys(config).length,
      }),
      kind: "flow_task",
      flowType: flowDefinition.id,
      target: connection.target,
      cliConnectionId: connection.id,
      payload: createCliFlowTaskPayload(flowDefinition.id, config),
    })
    .returning();

  return {
    notification,
    connection,
    config,
  };
}
