import { randomBytes } from 'node:crypto';
import { type Span, context, trace } from '@opentelemetry/api';

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
        const parentSpan = current?.span;
        if (!parentSpan || !current) return await fn();

        const tracer = trace.getTracer('ai');
        const childSpan = tracer.startSpan(name, undefined, trace.setSpan(context.active(), parentSpan));
        const savedSpan = current.span;
        const savedName = current.name;
        current.span = childSpan;
        current.name = name;
        return await context.with(trace.setSpan(context.active(), childSpan), async () => {
          try {
            return await fn();
          } finally {
            childSpan.end();
            current!.span = savedSpan;
            current!.name = savedName;
          }
        });
      }

      const tracer = trace.getTracer('ai');
      const spanContext = {
        traceId: current?.traceId || randomBytes(16).toString('hex'),
        spanId: randomBytes(8).toString('hex'),
        traceFlags: 1,
      };
      const rootContext = trace.setSpanContext(context.active(), spanContext);

      const initSpan = tracer.startSpan(name, undefined, rootContext);
      initSpan.setAttribute('langfuse.trace.name', name);
      initSpan.setAttribute('langfuse.trace.id', current?.traceId || '');
      if (current?.metadata?.sessionId) {
        initSpan.setAttribute('langfuse.trace.session_id', String(current.metadata.sessionId));
      }
      if (current?.metadata?.userId) {
        initSpan.setAttribute('langfuse.trace.user_id', String(current.metadata.userId));
      }
      if (current?.metadata?.tags && Array.isArray(current.metadata.tags)) {
        initSpan.setAttribute('langfuse.trace.tags', current.metadata.tags);
      }
      initSpan.end();

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
