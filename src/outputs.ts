// SPDX-FileCopyrightText: RUST-TOOLCHAIN-MATRIX contributors
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { MsrvSource } from "./manifest.ts";
import type { MatrixLeg } from "./matrix.ts";

/** One ordered step of the declarative install plan. */
export interface InstallStep {
  readonly step: "toolchain" | "profile" | "components" | "target";
  readonly argv: readonly string[];
}

/** Everything this action publishes. Declaration order is the key order. */
export interface ActionOutputs {
  readonly matrix: { readonly include: readonly MatrixLeg[] };
  readonly toolchains: readonly string[];
  readonly targets: readonly string[];
  readonly runners: readonly string[];
  readonly crates: readonly string[];
  readonly channel: string;
  readonly msrv: string;
  readonly "msrv-source": MsrvSource;
  readonly components: readonly string[];
  readonly profile: string;
  readonly "install-plan": readonly InstallStep[];
}

interface PlanInput {
  readonly profile?: string;
  readonly components: readonly string[];
  readonly hasTargets: boolean;
}

/**
 * Builds the ordered install plan.
 *
 * Ordered because installing the toolchain first and resolving the profile
 * second lets a `complete` profile degrade rather than abort the job.
 * `$TOOLCHAIN` and `$TARGET` are substituted by the consumer from the matrix
 * leg. THIS ACTION NEVER EXECUTES THE PLAN — it is data.
 */
export function buildInstallPlan(input: PlanInput): InstallStep[] {
  const plan: InstallStep[] = [
    {
      step: "toolchain",
      argv: ["rustup", "toolchain", "install", "$TOOLCHAIN"],
    },
  ];
  if (input.profile !== undefined) {
    plan.push({
      step: "profile",
      argv: ["rustup", "set", "profile", input.profile],
    });
  }
  if (input.components.length > 0) {
    plan.push({
      step: "components",
      argv: ["rustup", "component", "add", ...input.components],
    });
  }
  if (input.hasTargets) {
    plan.push({ step: "target", argv: ["rustup", "target", "add", "$TARGET"] });
  }
  return plan;
}

/** Flattens the outputs, serialising every non-scalar so `fromJSON` works. */
export function toOutputEntries(
  outputs: ActionOutputs,
): Array<[string, string]> {
  const entries: Array<[string, string]> = Object.entries(outputs).map(
    ([name, value]) => [
      name,
      typeof value === "string" ? value : JSON.stringify(value),
    ],
  );
  entries.push(["json", JSON.stringify(outputs)]);
  return entries;
}
