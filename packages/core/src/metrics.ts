import { getLogContext } from "./log-context.js";

export type MetricUnit = "Count" | "Milliseconds" | "None" | "Percent";

export interface Metrics {
  count(name: string, value?: number): void;
  value(name: string, value: number, unit: MetricUnit): void;
}

export interface MetricsOptions {
  readonly namespace: string;
  /** Kept small on purpose: every combination of values is a billed custom metric. */
  readonly dimensions: Record<string, string>;
  readonly sink?: (line: string) => void;
}

/**
 * Embedded Metric Format: CloudWatch reads the metric straight out of the log line, so there
 * is no PutMetricData call to fail, to throttle or to pay for on the request path.
 */
export class EmfMetrics implements Metrics {
  private readonly sink: (line: string) => void;

  constructor(private readonly options: MetricsOptions) {
    this.sink = options.sink ?? console.log;
  }

  count(name: string, value = 1): void {
    this.value(name, value, "Count");
  }

  value(name: string, value: number, unit: MetricUnit): void {
    this.sink(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: this.options.namespace,
              Dimensions: [Object.keys(this.options.dimensions)],
              Metrics: [{ Name: name, Unit: unit }],
            },
          ],
        },
        ...this.options.dimensions,
        ...getLogContext(),
        [name]: value,
      }),
    );
  }
}

/** For tests and for anything that must not emit. */
export class NoopMetrics implements Metrics {
  count(): void {}
  value(): void {}
}
