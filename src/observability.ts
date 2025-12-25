import { randomBytes } from 'node:crypto';
import { context, trace, type Span } from '@opentelemetry/api';

type TelemetryMetadata = Record<string, unknown>;

type TelemetryState = {
  metadata: TelemetryMetadata;
  traceId: string;
  updateParent: boolean;
  name: string;
  span?: Span;
};

let current: TelemetryState | null = null;
let depth = 0;

export const Observability = {
  async run<T>(name: string, metadata: TelemetryMetadata, fn: () => Promise<T>): Promise<T> {
    const started = Observability.startTrace(name, metadata);

    try {
      if (!started) {
        return await fn();
      }

      const tracer = trace.getTracer('ai');
      const spanContext = {
        traceId: current?.traceId || randomBytes(16).toString('hex'),
        spanId: randomBytes(8).toString('hex'),
        traceFlags: 1,
      };
      const rootContext = trace.setSpanContext(context.active(), spanContext);
      const span = tracer.startSpan(name, undefined, rootContext);
      current.span = span;

      return await context.with(trace.setSpan(rootContext, span), async () => {
        try {
          return await fn();
        } finally {
          span.end();
          current.span = undefined;
        }
      });
    } finally {
      Observability.endTrace(started);
    }
  },

  startTrace(name: string, metadata: TelemetryMetadata) {
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
      name,
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
      functionId: current.name,
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

  isTracing() {
    return Boolean(current);
  },

  getSpan() {
    return current?.span;
  },
};
