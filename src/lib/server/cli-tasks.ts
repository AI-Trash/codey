import "@tanstack/react-start/server-only";

import {
  createCliFlowTaskPayload,
  DEFAULT_CLI_FLOW_TASK_PARALLELISM,
  type CliFlowCommandId,
  getCliFlowDefinition,
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
  MAX_CLI_FLOW_TASK_PARALLELISM,
  normalizeCliFlowConfig,
  normalizeCliFlowTaskParallelism,
} from "../../../packages/cli/src/modules/flow-cli/flow-registry";
import {
  getAdminCliConnectionSummaryById,
  type CliConnectionActorScope,
  isCliConnectionOwnedByActor,
  isSharedCliConnection,
} from "./cli-connections";
import { getDb } from "./db/client";
import { adminNotifications } from "./db/schema";
import { hasEnabledSub2ApiServiceConfig } from "./external-service-configs";
import { createId } from "./security";

export {
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
  MAX_CLI_FLOW_TASK_PARALLELISM,
};

function buildTaskTitle(input: {
  flowId: string;
  sequence: number;
  total: number;
  email?: string | null;
}) {
  const emailSuffix = input.email?.trim() ? ` - ${input.email.trim()}` : "";

  if (input.total <= 1) {
    return `Dispatch ${input.flowId}${emailSuffix}`;
  }

  return `Dispatch ${input.flowId} (${input.sequence}/${input.total})${emailSuffix}`;
}

function buildTaskBody(input: {
  flowId: string;
  cliName?: string | null;
  configCount: number;
  sequence: number;
  total: number;
  parallelism: number;
  email?: string | null;
}) {
  const target = input.cliName?.trim() || "CLI";
  const configLabel = input.configCount === 1 ? "override" : "overrides";
  const emailDetail = input.email?.trim()
    ? ` Target email ${input.email.trim()}.`
    : "";
  const base = `Run ${input.flowId} on ${target} with ${input.configCount} ${configLabel}.${emailDetail}`;

  if (input.total <= 1) {
    return base;
  }

  return `${base} Batch item ${input.sequence} of ${input.total}. Parallelism ${input.parallelism}.`;
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

function resolveRequestedParallelism(input: {
  parallelism?: number | null;
  count: number;
}) {
  if (input.parallelism == null) {
    return DEFAULT_CLI_FLOW_TASK_PARALLELISM;
  }

  if (!Number.isInteger(input.parallelism) || input.parallelism < 1) {
    throw new Error("Parallelism must be a whole number greater than 0.");
  }

  if (input.parallelism > MAX_CLI_FLOW_TASK_PARALLELISM) {
    throw new Error(
      `Parallelism cannot exceed ${MAX_CLI_FLOW_TASK_PARALLELISM}.`,
    );
  }

  if (input.parallelism > input.count) {
    throw new Error("Parallelism cannot exceed the task count.");
  }

  return normalizeCliFlowTaskParallelism(input.parallelism, {
    count: input.count,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEmailKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function validateBatchedCliFlowConfigs<TFlowId extends CliFlowCommandId>(input: {
  flowId: TFlowId;
  configs: ReturnType<typeof normalizeCliFlowConfig<TFlowId>>[];
  requestedCount?: number | null;
}) {
  if (input.flowId !== "codex-oauth") {
    return;
  }

  if (input.configs.length <= 1) {
    if ((input.requestedCount || 1) > 1) {
      throw new Error(
        "Codex OAuth batch dispatch requires one unique email address per task.",
      );
    }
    return;
  }

  const seenEmails = new Set<string>();
  for (const config of input.configs) {
    if (typeof config.identityId === "string" && config.identityId.trim()) {
      throw new Error(
        "Codex OAuth email batches cannot include identityId overrides.",
      );
    }

    const email = normalizeEmailKey(config.email);
    if (!email) {
      throw new Error(
        "Each Codex OAuth batch item must include an email address.",
      );
    }

    if (seenEmails.has(email)) {
      throw new Error(
        `Duplicate Codex OAuth batch email detected: ${email}.`,
      );
    }

    seenEmails.add(email);
  }
}

function resolveRequestedTaskConfigs<TFlowId extends CliFlowCommandId>(input: {
  flowId: TFlowId;
  config?: Record<string, unknown> | null;
  configs?: Array<Record<string, unknown>> | null;
  count?: number | null;
}) {
  const requestedConfigs = Array.isArray(input.configs)
    ? input.configs.filter(isRecord)
    : [];

  if (!requestedConfigs.length) {
    return [normalizeCliFlowConfig(input.flowId, input.config)];
  }

  if (requestedConfigs.length > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
    throw new Error(
      `Task count cannot exceed ${MAX_CLI_FLOW_TASK_BATCH_SIZE}.`,
    );
  }

  if (input.count != null && input.count !== requestedConfigs.length) {
    throw new Error("Task count must match the provided config count.");
  }

  const normalizedConfigs = requestedConfigs.map((config) =>
    normalizeCliFlowConfig(input.flowId, config),
  );
  validateBatchedCliFlowConfigs({
    flowId: input.flowId,
    configs: normalizedConfigs,
    requestedCount: input.count,
  });
  return normalizedConfigs;
}

async function resolveDispatchableCliFlow(input: {
  connectionId: string;
  flowId: string;
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
  };
}

async function resolveCliFlowTaskExternalServices(flowId: string) {
  if (flowId !== "codex-oauth") {
    return undefined;
  }

  if (!(await hasEnabledSub2ApiServiceConfig())) {
    return undefined;
  }

  return {
    sub2api: {
      source: "app" as const,
    },
  };
}

export async function dispatchCliFlowTasks(input: {
  connectionId: string;
  flowId: string;
  config?: Record<string, unknown> | null;
  configs?: Array<Record<string, unknown>> | null;
  count?: number | null;
  parallelism?: number | null;
  actor?: CliConnectionActorScope;
}) {
  const { connection, flowDefinition } = await resolveDispatchableCliFlow(input);
  const taskConfigs = resolveRequestedTaskConfigs({
    flowId: flowDefinition.id,
    config: input.config,
    configs: input.configs,
    count: input.count,
  });
  const count =
    taskConfigs.length > 1
      ? taskConfigs.length
      : resolveRequestedTaskCount(input.count);
  const parallelism = resolveRequestedParallelism({
    parallelism: input.parallelism,
    count,
  });
  const externalServices = await resolveCliFlowTaskExternalServices(
    flowDefinition.id,
  );
  const batchId = count > 1 ? createId() : undefined;
  const queuedConfigs =
    taskConfigs.length > 1
      ? taskConfigs
      : Array.from({ length: count }, () => taskConfigs[0] || {});
  const notifications = await getDb()
    .insert(adminNotifications)
    .values(
      queuedConfigs.map((config, index) => {
        const sequence = index + 1;
        const email =
          typeof config.email === "string" ? config.email.trim() : undefined;
        return {
          id: createId(),
          title: buildTaskTitle({
            flowId: flowDefinition.id,
            sequence,
            total: count,
            email,
          }),
          body: buildTaskBody({
            flowId: flowDefinition.id,
            cliName: connection.cliName,
            configCount: Object.keys(config).length,
            sequence,
            total: count,
            parallelism,
            email,
          }),
          kind: "flow_task" as const,
          flowType: flowDefinition.id,
          target: connection.target,
          cliConnectionId: connection.id,
          payload: createCliFlowTaskPayload(flowDefinition.id, config, {
            ...(batchId ? { batchId } : {}),
            ...(count > 1 ? { sequence, total: count } : {}),
            ...(parallelism > 1 ? { parallelism } : {}),
          }, externalServices),
        };
      }),
    )
    .returning();

  return {
    notifications,
    connection,
    config: queuedConfigs[0] || {},
    configs: queuedConfigs,
    batchId,
    externalServices,
    parallelism,
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
