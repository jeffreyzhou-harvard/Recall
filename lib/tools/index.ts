import { capture_contribution, confirm_and_store, confirm_share, record_retrieval_outcome } from "./impl/contribution";
import { assess_conversation_state, render_prompt, select_scaffold } from "./impl/conversation";
import { query_context_graph, verify_claim_support } from "./impl/evidence";
import { build_weekly_note, export_record_for_clinician, get_topic_record, handle_family_query, receive_family_contribution } from "./impl/family";
import { build_caregiver_receipt } from "./impl/receipt";
import { check_safety_phrases, send_safety_alert } from "./impl/safety";
import { get_next_recall_topic, place_recall_call } from "./impl/scheduling";
import type { ToolImpls } from "./runtime";

/** The nineteen tools, numbered as AGENTS.md section 6 numbers them. */
export const TOOL_IMPLS: ToolImpls = {
  get_next_recall_topic, // 1
  place_recall_call, // 2
  query_context_graph, // 3
  verify_claim_support, // 4
  assess_conversation_state, // 5
  select_scaffold, // 6
  render_prompt, // 7
  capture_contribution, // 8
  confirm_and_store, // 9
  record_retrieval_outcome, // 10
  receive_family_contribution, // 11
  handle_family_query, // 12
  build_caregiver_receipt, // 13
  build_weekly_note, // 14
  get_topic_record, // 15
  export_record_for_clinician, // 16
  confirm_share, // 17
  check_safety_phrases, // 18
  send_safety_alert, // 19
};

export * from "./contracts";
export * from "./context";
export { GateError, GateKeeper, type PolicyToken, type VerifiedEvidence } from "./gates";
export { SetupStore, attestationsMissing, dashboardAccess, evaluateCallPolicy, policySchema, reconfirmationDue, type AccessPolicy } from "./policy";
export { ToolContractError, ToolRuntime, ToolTimeoutError, type Fault, type RuntimeContexts, type ToolCallRecord } from "./runtime";
