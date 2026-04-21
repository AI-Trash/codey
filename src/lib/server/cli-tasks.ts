import "@tanstack/react-start/server-only";

import { getCliFlowDefinition, normalizeCliFlowTaskOptions } from "../../../packages/cli/src/modules/flow-cli/flow-registry";
import {
  getAdminCliConnectionSummaryById,
  type CliConnectionActorScope,
  isCliConnectionOwnedByActor,
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
  optionCount: number;
}) {
  const target = input.cliName?.trim() || "CLI";
  const optionLabel = input.optionCount === 1 ? "option" : "options";
  return `Run ${input.flowId} on ${target} with ${input.optionCount} ${optionLabel}.`;
}

export async function dispatchCliFlowTask(input: {
  connectionId: string;
  flowId: string;
  options?: Record<string, unknown> | null;
  actor?: CliConnectionActorScope;
}) {
  const connection = await getAdminCliConnectionSummaryById(input.connectionId);
  if (!connection) {
    throw new Error("CLI connection not found.");
  }

  if (input.actor && !isCliConnectionOwnedByActor(connection, input.actor)) {
    throw new Error("You can only dispatch tasks to your own CLI connection.");
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

  const options = normalizeCliFlowTaskOptions(input.flowId, input.options);
  const [notification] = await getDb()
    .insert(adminNotifications)
    .values({
      id: createId(),
      title: buildTaskTitle(flowDefinition.id),
      body: buildTaskBody({
        flowId: flowDefinition.id,
        cliName: connection.cliName,
        optionCount: Object.keys(options).length,
      }),
      kind: "flow_task",
      flowType: flowDefinition.id,
      target: connection.target,
      cliConnectionId: connection.id,
      payload: {
        kind: "flow_task",
        flowId: flowDefinition.id,
        options,
      },
    })
    .returning();

  return {
    notification,
    connection,
    options,
  };
}
