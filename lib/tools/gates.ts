/**
 * Hard gates. Policy, evidence, and confirmation are enforced here as services -
 * not as prompt instructions and not as decorative wrappers. The model selects
 * tool calls; it cannot reach past this object.
 *
 * Every check fails closed: a missing record, a mismatch, or an expired token
 * throws GateError, and nothing downstream runs. There is no override flag.
 *
 * Changes to this file need a second reviewer (AGENTS.md section 13).
 */
import type { SourceClass } from "@/lib/graph/types";
import { contentHash } from "@/lib/provenance/hash";
import type { GateName, ShareDecision, StoreDecision } from "@/lib/state/machine";

export class GateError extends Error {
  constructor(
    public readonly gate: GateName,
    public readonly detail: string,
  ) {
    super(`${gate} gate: ${detail}`);
    this.name = "GateError";
  }
}

/** Proof that the joint setup allowed THIS call: her, this topic, now. Everything after the grant must present it. */
export interface PolicyToken {
  token_id: string;
  policy_id: string;
  person_id: string;
  topic_id: string;
  allowed_source_classes: SourceClass[];
  issued_at: string;
  expires_at: string;
  /** Hash of every field above. A token whose fields were edited no longer matches. */
  digest: string;
}

/** What `verify_claim_support` established about one id. `render_prompt` reads the speaker from here, not from its caller. */
export interface VerifiedEvidence {
  id: string;
  speaker: string;
  patient_confirmed: boolean;
}

const tokenBody = (t: Omit<PolicyToken, "digest">): Omit<PolicyToken, "digest"> => ({
  token_id: t.token_id,
  policy_id: t.policy_id,
  person_id: t.person_id,
  topic_id: t.topic_id,
  allowed_source_classes: t.allowed_source_classes,
  issued_at: t.issued_at,
  expires_at: t.expires_at,
});

export class GateKeeper {
  private readonly tokens = new Map<string, PolicyToken>();
  private readonly verified = new Map<string, VerifiedEvidence>();
  private pendingContributionHash: string | null = null;
  private storeDecision: { hash: string; decision: StoreDecision } | null = null;
  private shareDecision: { hash: string; decision: ShareDecision } | null = null;
  private readonly alerted = new Set<string>();

  // policy -----------------------------------------------------------------

  async issueToken(body: Omit<PolicyToken, "digest">): Promise<PolicyToken> {
    const token: PolicyToken = { ...tokenBody(body), digest: await contentHash(tokenBody(body)) };
    this.tokens.set(token.token_id, token);
    return token;
  }

  /** The token must be one this keeper issued, unaltered, unexpired, and for this topic. */
  async requireToken(tokenId: string | null | undefined, topicId: string, nowIso: string): Promise<PolicyToken> {
    if (!tokenId) throw new GateError("policy", "no policy token was presented");
    const token = this.tokens.get(tokenId);
    if (!token) throw new GateError("policy", `policy token "${tokenId}" was not issued by this session`);
    if ((await contentHash(tokenBody(token))) !== token.digest) throw new GateError("policy", "policy token has been altered");
    if (token.topic_id !== topicId) throw new GateError("policy", "policy token is for a different topic");
    if (token.expires_at <= nowIso) throw new GateError("policy", "policy token has expired");
    return token;
  }

  // evidence ---------------------------------------------------------------

  recordVerifiedEvidence(entries: Iterable<VerifiedEvidence>): void {
    for (const e of entries) this.verified.set(e.id, { ...e });
  }

  /** Rule 6: no citations, no speech. */
  requireVerifiedEvidence(ids: readonly string[]): VerifiedEvidence[] {
    const missing = ids.filter((id) => !this.verified.has(id));
    if (missing.length > 0) throw new GateError("evidence", `not verified by verify_claim_support: ${missing.join(", ")}`);
    return ids.map((id) => ({ ...this.verified.get(id)! }));
  }

  isVerified(id: string): boolean {
    return this.verified.has(id);
  }

  verifiedIds(): string[] {
    return [...this.verified.keys()].sort();
  }

  // contribution, store-confirmation, share-confirmation ----------------------

  /** A new capture replaces the pending artifact and voids every earlier confirmation (rule 3). */
  setPendingContribution(hash: string): void {
    if (this.pendingContributionHash !== hash) {
      this.storeDecision = null;
      this.shareDecision = null;
    }
    this.pendingContributionHash = hash;
  }

  requirePendingContribution(hash: string): void {
    if (this.pendingContributionHash === null) throw new GateError("confirmation", "there is no captured contribution");
    if (this.pendingContributionHash !== hash) throw new GateError("confirmation", "hash does not match the captured contribution");
  }

  recordStoreConfirmation(hash: string, decision: StoreDecision): void {
    this.requirePendingContribution(hash);
    this.storeDecision = { hash, decision };
  }

  /** The share question is asked only after a yes to the store question (section 5). */
  recordShareConfirmation(hash: string, decision: ShareDecision): void {
    this.requirePendingContribution(hash);
    if (this.storeDecision?.hash !== hash || this.storeDecision.decision !== "yes") {
      throw new GateError("confirmation", "the share question comes only after she has said yes to remembering it");
    }
    if (this.shareDecision?.hash === hash) throw new GateError("confirmation", "the share question has already been answered for this contribution");
    this.shareDecision = { hash, decision };
  }

  /**
   * The commit gate. Requires her recorded yes for exactly this hash, the contribution unchanged since,
   * and the share question resolved - because commit comes last. Returns whether she chose to share it.
   */
  requireCommittable(hash: string): { shared: boolean } {
    this.requirePendingContribution(hash);
    if (!this.storeDecision || this.storeDecision.hash !== hash) throw new GateError("confirmation", "no confirmation has been recorded for this contribution");
    if (this.storeDecision.decision !== "yes") throw new GateError("confirmation", `her answer was "${this.storeDecision.decision}", not yes`);
    if (!this.shareDecision || this.shareDecision.hash !== hash) throw new GateError("confirmation", "the share question has not resolved; commit comes last");
    return { shared: this.shareDecision.decision === "yes" };
  }

  // safety -----------------------------------------------------------------

  /** At most one alert per category per caregiver per call. Returns false if this one has already gone. */
  claimAlert(category: string, caregiverId: string): boolean {
    const key = JSON.stringify([category, caregiverId]);
    if (this.alerted.has(key)) return false;
    this.alerted.add(key);
    return true;
  }

  /** The alert did not go out after all, so it has not been sent: a second try may claim it again. */
  releaseAlert(category: string, caregiverId: string): void {
    this.alerted.delete(JSON.stringify([category, caregiverId]));
  }
}
