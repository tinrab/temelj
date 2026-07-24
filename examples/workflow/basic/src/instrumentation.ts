import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= otlpEndpoint;
process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??= "http/protobuf";
process.env.OTEL_SERVICE_NAME ??= "temelj-workflow-basic";
process.env.OTEL_RESOURCE_ATTRIBUTES ??= "deployment.environment=local";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME,
    [ATTR_SERVICE_NAMESPACE]: "temelj-examples",
    [ATTR_SERVICE_VERSION]: "0.1.0",
  }),
  traceExporter: new OTLPTraceExporter(),
  logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 1_000,
    }),
  ],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown();
}
