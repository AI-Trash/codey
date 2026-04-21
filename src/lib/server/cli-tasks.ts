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

export const MAX_CLI_FLOW_TASK_BATCH_SIZE = 20;

function buildTaskTitle(input: {
  flowId: string;
  sequence: number;
  total: number;
}) {
  if (input.total <= 1) {
    return `Dispatch ${input.flowId}`;
  }

  return `Dispatch ${input.flowId} (${input.sequence}/${input.total})`;
}

function buildTaskBody(input: {
  flowId: string;
  cliName?: string | null;
  configCount: number;
  sequence: number;
  total: number;
}) {
  const target = input.cliName?.trim() || "CLI";
  const configLabel = input.configCount === 1 ? "override" : "overrides";
  const base = `Run ${input.flowId} on ${target} with ${input.configCount} ${configLabel}.`;

  if (input.total <= 1) {
    return base;
  }

  return `${base} Batch item ${input.sequence} of ${input.total}.`;
}

function resolveRequestedTaskCount(count?: number | null) {
  if (count == null) {
    return 1;
  }

  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Task count must be a whole number greater than 0.");
  }

  if (count > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
    throw new Error(
      `Task count cannot exceed ${MAX_CLI_FLOW_TASK_BATCH_SIZE}.`,
    );
  }

  return count;
}

async function resolveDispatchableCliFlow(input: {
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

  return {
    connection,
    flowDefinition,
    config: normalizeCliFlowConfig(flowDefinition.id, input.config),
  };
}

export async function dispatchCliFlowTasks(input: {
  connectionId: string;
  flowId: string;
  config?: Record<string, unknown> | null;
  count?: number | null;
  actor?: CliConnectionActorScope;
}) {
  const count = resolveRequestedTaskCount(input.count);
  const { connection, flowDefinition, config } =
    await resolveDispatchableCliFlow(input);
  const configCount = Object.keys(config).length;
  const notifications = await getDb()
    .insert(adminNotifications)
    .values(
      Array.from({ length: count }, (_, index) => {
        const sequence = index + 1;
        return {
          id: createId(),
          title: buildTaskTitle({
            flowId: flowDefinition.id,
            sequence,
            total: count,
          }),
          body: buildTaskBody({
            flowId: flowDefinition.id,
            cliName: connection.cliName,
            configCount,
            sequence,
            total: count,
          }),
          kind: "flow_task" as const,
          flowType: flowDefinition.id,
          target: connection.target,
          cliConnectionId: connection.id,
          payload: createCliFlowTaskPayload(flowDefinition.id, config),
        };
      }),
    )
    .returning();

  return {
    notifications,
    connection,
    config,
  };
}

export async function dispatchCliFlowTask(input: {
  connectionId: string;
  flowId: string;
  config?: Record<string, unknown> | null;
  actor?: CliConnectionActorScope;
}) {
  const result = await dispatchCliFlowTasks({
    ...input,
    count: 1,
  });
  const [notification] = result.notifications;

  if (!notification) {
    throw new Error("Unable to dispatch flow task.");
  }

  return {
    notification,
    connection: result.connection,
    config: result.config,
  };
}
