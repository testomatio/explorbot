import { type Span, trace } from '@opentelemetry/api';

type TelemetryMetadata = Record<string, unknown>;

type TelemetryState = {
  metadata: TelemetryMetadata;
  name: string;
  span?: Span;
};

let current: TelemetryState | null = null;

export const Observability = {
  async run<T>(name: string, metadata: TelemetryMetadata, fn: () => Promise<T>): Promise<T> {
    const tracer = trace.getTracer('ai');

    if (current) {
      return await tracer.startActiveSpan(name, {}, async (span) => {
        const saved = current!;
        current = {
          metadata: { ...saved.metadata, ...metadata },
          name,
          span,
        };
        try {
          return await fn();
        } finally {
          span.end();
          current = saved;
        }
      });
    }

    const attributes = buildRootSpanAttributes(name, metadata);
    return await tracer.startActiveSpan(name, { attributes }, async (span) => {
      current = { metadata, name, span };
      try {
        return await fn();
      } finally {
        span.end();
        current = null;
      }
    });
  },

  getTelemetry() {
    if (!current) {
      return undefined;
    }

    const metadata: Record<string, unknown> = {};
    if (current.metadata.sessionId) metadata.sessionId = current.metadata.sessionId;
    if (current.metadata.userId) metadata.userId = current.metadata.userId;
    if (Array.isArray(current.metadata.tags)) metadata.tags = current.metadata.tags;

    return {
      isEnabled: true,
      functionId: current.name,
      metadata,
    };
  },

  isTracing() {
    return Boolean(current);
  },

  getSpan() {
    return current?.span ?? trace.getActiveSpan();
  },
};

function buildRootSpanAttributes(name: string, metadata: TelemetryMetadata): Record<string, any> {
  const attributes: Record<string, any> = {
    'langfuse.trace.name': name,
  };

  if (metadata.sessionId) {
    attributes['session.id'] = String(metadata.sessionId);
  }
  if (metadata.userId) {
    attributes['user.id'] = String(metadata.userId);
  }
  if (Array.isArray(metadata.tags)) {
    attributes['langfuse.trace.tags'] = metadata.tags as string[];
  }
  if (metadata.input !== undefined) {
    attributes['langfuse.trace.input'] = JSON.stringify(metadata.input);
  }

  return attributes;
}
