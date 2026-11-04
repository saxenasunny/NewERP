import { z } from "zod";

/**
 * Versioned attainment-policy configuration.
 *
 * This module stores and validates the policy. It does not calculate attainment.
 * Direct and indirect methods stay `unconfigured` until an institution confirms
 * its formula; missing marks are never treated as zero.
 */

export const DEFAULT_CORRELATION_SCALE = [
  { level: 1, label: "Slight", code: "L" },
  { level: 2, label: "Moderate", code: "M" },
  { level: 3, label: "Substantial", code: "H" },
] as const;

const correlationLevelSchema = z
  .object({
    level: z.coerce.number().int().min(1).max(9),
    label: z.string().trim().min(1).max(40),
    code: z.string().trim().min(1).max(8),
  })
  .strict();

const methodSchema = z
  .object({
    status: z.enum(["unconfigured", "configured"]),
    description: z.string().trim().max(4000).optional(),
  })
  .strict();

export const attainmentPolicyConfigSchema = z
  .object({
    correlationScale: z.array(correlationLevelSchema).min(1).max(9),
    rounding: z.object({ decimalPlaces: z.coerce.number().int().min(0).max(6) }).strict(),
    missingData: z.literal("insufficient_evidence"),
    directMethod: methodSchema,
    indirectMethod: methodSchema,
    thresholds: z
      .object({
        courseOutcome: z.coerce.number().min(0).max(100).nullable(),
        programmeOutcome: z.coerce.number().min(0).max(100).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const levels = value.correlationScale.map((entry) => entry.level);
    if (new Set(levels).size !== levels.length) {
      ctx.addIssue({
        code: "custom",
        message: "Correlation levels must be unique.",
        path: ["correlationScale"],
      });
    }
  });

export type AttainmentPolicyConfig = z.infer<typeof attainmentPolicyConfigSchema>;

export const defaultAttainmentPolicyConfig = (): AttainmentPolicyConfig => ({
  correlationScale: DEFAULT_CORRELATION_SCALE.map((entry) => ({ ...entry })),
  rounding: { decimalPlaces: 2 },
  missingData: "insufficient_evidence",
  directMethod: {
    status: "unconfigured",
    description: "Direct attainment is not calculated until the institution confirms a formula.",
  },
  indirectMethod: {
    status: "unconfigured",
    description: "Indirect attainment is not calculated until the institution confirms a formula.",
  },
  thresholds: { courseOutcome: null, programmeOutcome: null },
});

export function parseAttainmentPolicyConfig(value: unknown): AttainmentPolicyConfig {
  return attainmentPolicyConfigSchema.parse(value);
}

export function formulaIsConfigured(config: AttainmentPolicyConfig): boolean {
  return (
    config.directMethod.status === "configured" || config.indirectMethod.status === "configured"
  );
}

export function correlationLevelsOf(config: AttainmentPolicyConfig): number[] {
  return config.correlationScale.map((entry) => entry.level);
}

export function isAllowedCorrelation(config: AttainmentPolicyConfig, level: number): boolean {
  return correlationLevelsOf(config).includes(level);
}

export function labelForCorrelation(config: AttainmentPolicyConfig, level: number): string {
  return config.correlationScale.find((entry) => entry.level === level)?.label ?? String(level);
}

export const policyDraftInputSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(120),
  notes: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(4000).optional(),
  ),
  rounding: z.coerce.number().int().min(0).max(6).default(2),
  courseOutcomeThreshold: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().min(0).max(100).nullable(),
  ),
  programmeOutcomeThreshold: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().min(0).max(100).nullable(),
  ),
  directMethodNotes: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(4000).optional(),
  ),
  indirectMethodNotes: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(4000).optional(),
  ),
});

export type PolicyDraftInput = z.infer<typeof policyDraftInputSchema>;

export function configFromDraftInput(input: PolicyDraftInput): AttainmentPolicyConfig {
  const defaults = defaultAttainmentPolicyConfig();
  return {
    ...defaults,
    rounding: { decimalPlaces: input.rounding },
    thresholds: {
      courseOutcome: input.courseOutcomeThreshold,
      programmeOutcome: input.programmeOutcomeThreshold,
    },
    directMethod: {
      status: "unconfigured",
      description: input.directMethodNotes ?? defaults.directMethod.description,
    },
    indirectMethod: {
      status: "unconfigured",
      description: input.indirectMethodNotes ?? defaults.indirectMethod.description,
    },
  };
}
