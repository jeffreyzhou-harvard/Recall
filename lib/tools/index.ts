import { capture_exact_contribution, publish_contribution, request_assent } from "./impl/contribution";
import { assess_conversation_state, render_prompt, select_scaffold } from "./impl/conversation";
import { query_context_graph, verify_claim_support } from "./impl/evidence";
import { get_access_policy, inspect_request, resolve_identity_and_relationships } from "./impl/intake";
import { build_caregiver_receipt } from "./impl/receipt";
import type { ToolImpls } from "./runtime";

/** The twelve tools, in the enforced order. */
export const TOOL_IMPLS: ToolImpls = {
  inspect_request,
  resolve_identity_and_relationships,
  get_access_policy,
  query_context_graph,
  verify_claim_support,
  assess_conversation_state,
  select_scaffold,
  render_prompt,
  capture_exact_contribution,
  request_assent,
  publish_contribution,
  build_caregiver_receipt,
};

export * from "./contracts";
export * from "./context";
export type { FamilyNotice, PostedMessage, SupportReceipt, ThreadBridge, ThreadMessage, VoiceCard } from "@/lib/bridge/thread-bridge";
export { GateError, GateKeeper, type AssentRecord, type PolicyToken } from "./gates";
export { evaluatePolicy, policySchema, type AccessPolicy } from "./policy";
export { ToolContractError, ToolRuntime, ToolTimeoutError, type Fault, type ToolCallRecord } from "./runtime";
