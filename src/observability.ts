import { randomBytes } from 'node:crypto';

type TelemetryMetadata = Record<string, unknown>;

type TelemetryState = {
  metadata: TelemetryMetadata;
  traceId: string;
  updateParent: boolean;
};

let current: TelemetryState | null = null;
let depth = 0;

export const Observability = {
  async run<T>(name: string, metadata: TelemetryMetadata, fn: () => Promise<T>): Promise<T> {
    const started = Observability.startTrace(metadata);

    try {
      return await fn();
    } finally {
      Observability.endTrace(started);
    }
  },

  startTrace(metadata: TelemetryMetadata) {
    if (current) {
      depth += 1;
      return false;
    }

    const langfuseTraceId = metadata.langfuseTraceId || randomBytes(16).toString('hex');
    current = {
      metadata: {
        ...metadata,
        langfuseTraceId,
      },
      traceId: langfuseTraceId,
      updateParent: true,
    };
    depth = 1;
    return true;
  },

  endTrace(started: boolean) {
    if (!current) {
      return;
    }

    if (!started) {
      depth -= 1;
      return;
    }

    depth -= 1;
    if (depth <= 0) {
      current = null;
      depth = 0;
    }
  },

  getTelemetry() {
    if (!current) {
      return undefined;
    }

    const telemetry = {
      isEnabled: true,
      metadata: {
        ...current.metadata,
        langfuseTraceId: current.traceId,
        langfuseUpdateParent: current.updateParent,
      },
    };

    if (current.updateParent) {
      current.updateParent = false;
    }

    return telemetry;
  },
};
