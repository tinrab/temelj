import {
  implementWorkflow,
  defineWorkflowStep,
  type WorkflowImplementation,
  type WorkflowStepContext,
} from "@temelj/workflow";

export interface ReportInput {
  readonly reportId: string;
  readonly rows: number;
}

export interface ReportResult {
  readonly reportId: string;
  readonly checksum: number;
  readonly rows: number;
}

export const generateRows = defineWorkflowStep(
  { name: "generate-report-rows" },
  (input: ReportInput, { log }: WorkflowStepContext): number => {
    log.info("generating report rows", {
      reportId: input.reportId,
      rows: input.rows,
    });
    let checksum = 0;
    for (let index = 0; index < input.rows; index++) {
      checksum = (checksum + (index * 31 + input.reportId.length)) % 1_000_000_007;
    }
    return checksum;
  },
);

export const reportWorkflow: WorkflowImplementation<ReportInput, ReportResult> = implementWorkflow<
  ReportInput,
  ReportResult
>({ name: "basic.report", version: "v1" }, async ({ input, log, step }) => {
  log.info("report workflow started", {
    reportId: input.reportId,
    rows: input.rows,
  });
  await step.runData.setAttributes("mark-workload", {
    workload: "report",
    rows: input.rows,
  });
  step.log.info("report attributes recorded", {
    workload: "report",
  });
  const checksum = await step.task.call(generateRows, input);
  return {
    reportId: input.reportId,
    checksum,
    rows: input.rows,
  };
});
