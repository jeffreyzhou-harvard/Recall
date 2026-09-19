/**
 * Hard gates. Identity, policy, evidence, and assent are enforced here as
 * services - not as prompt instructions and not as decorative wrappers. The
 * model selects tool calls; it cannot reach past this object.
 *
 * Every check fails closed: a missing record, a mismatch, or an expired token
 * throws GateError, and nothing downstream runs. There is no override flag.
 *
 * Changes to this file need a second reviewer (AGENTS.md section 13).
 */
import type { SourceClass } from "@/lib/graph/types";
import { contentHash } from "@/lib/provenance/hash";
import type { AssentDecision, GateName } from "@/lib/state/machine";

export class GateError extends Error {
  constructor(
    public readonly gate: GateName,
    public readonly detail: string,
  ) {
    super(`${gate} gate: ${detail}`);
    this.name = "GateError";
  }
}

export interface PolicyToken {
  token_id: string;
  policy_id: string;
  ask_id: string;
  person_id: string;
  asker_id: string;
  purpose: string;
  audience: string;
  allowed_source_classes: SourceClass[];
  forbidden_claims: string[];
  issued_at: string;
  expires_at: string;
  /** Hash of every field above. A token whose fields were edited no longer matches. */
  digest: string;
}

export interface AssentRecord {
  assent_id: string;
  decision: AssentDecision;
  contribution_hash: string;
  audience: string;
  recorded_at: string;
}

const tokenBody = (t: Omit<PolicyToken, "digest">): Omit<PolicyToken, "digest"> => ({
  token_id: t.token_id,
  policy_id: t.policy_id,
  ask_id: t.ask_id,
  person_id: t.person_id,
  asker_id: t.asker_id,
  purpose: t.purpose,
  audience: t.audience,
  allowed_source_classes: t.allowed_source_classes,
  forbidden_claims: t.forbidden_claims,
  issued_at: t.issued_at,
  expires_at: t.expires_at,
});

export class GateKeeper {
  private identityVerifiedFor: string | null = null;
  private readonly tokens = new Map<string, PolicyToken>();
  private readonly verifiedEvidence = new Set<string>();
  private pendingContributionHash: string | null = null;
  private readonly assents = new Map<string, AssentRecord>();

  // identity ---------------------------------------------------------------

  recordIdentityVerified(askId: string): void {
    this.identityVerifiedFor = askId;
  }

  requireIdentity(askId: string): void {
    if (this.identityVerifiedFor !== askId) {
      throw new GateError("identity", `identities for ask "${askId}" have not been verified`);
    }
  }

  // policy -----------------------------------------------------------------

  async issueToken(body: Omit<PolicyToken, "digest">): Promise<PolicyToken> {
    this.requireIdentity(body.ask_id);
    const token: PolicyToken = { ...tokenBody(body), digest: await contentHash(tokenBody(body)) };
    this.tokens.set(token.token_id, token);
    return token;
  }

  /** The token must be one this keeper issued, unaltered, unexpired, and for this ask. */
  async requireToken(tokenId: string | null | undefined, askId: string, nowIso: string): Promise<PolicyToken> {
    if (!tokenId) throw new GateError("policy", "no policy token was presented");
    const token = this.tokens.get(tokenId);
    if (!token) throw new GateError("policy", `policy token "${tokenId}" was not issued by this session`);
    if ((await contentHash(tokenBody(token))) !== token.digest) {
      throw new GateError("policy", "policy token has been altered");
    }
    if (token.ask_id !== askId) throw new GateError("policy", "policy token is for a different ask");
    if (token.expires_at <= nowIso) throw new GateError("policy", "policy token has expired");
    return token;
  }

  // evidence ---------------------------------------------------------------

  recordVerifiedEvidence(ids: Iterable<string>): void {
    for (const id of ids) this.verifiedEvidence.add(id);
  }

  /** Rule 6: no citations, no speech. */
  requireVerifiedEvidence(ids: readonly string[]): void {
    const missing = ids.filter((id) => !this.verifiedEvidence.has(id));
    if (missing.length > 0) {
      throw new GateError("evidence", `not verified by verify_claim_support: ${missing.join(", ")}`);
    }
  }

  isVerified(id: string): boolean {
    return this.verifiedEvidence.has(id);
  }

  verifiedIds(): string[] {
    return [...this.verifiedEvidence].sort();
  }

  // contribution and assent -------------------------------------------------

  /** A new capture replaces the pending artifact and voids every earlier approval (rule 3). */
  setPendingContribution(hash: string): void {
    if (this.pendingContributionHash !== hash) this.assents.clear();
    this.pendingContributionHash = hash;
  }

  requirePendingContribution(hash: string): void {
    if (this.pendingContributionHash === null) throw new GateError("assent", "there is no captured contribution");
    if (this.pendingContributionHash !== hash) {
      throw new GateError("assent", "hash does not match the captured contribution");
    }
  }

  recordAssent(record: AssentRecord): void {
    this.requirePendingContribution(record.contribution_hash);
    this.assents.set(record.assent_id, record);
  }

  /**
   * The publish gate. Requires a recorded yes for exactly this hash and
   * exactly this destination, with the contribution unchanged since.
   */
  requirePublishable(hash: string, destination: string, token: PolicyToken): AssentRecord {
    this.requirePendingContribution(hash);
    if (destination !== token.audience) {
      throw new GateError("permission", `destination "${destination}" is not the audience the policy approved`);
    }
    const yes = [...this.assents.values()].find(
      (a) => a.decision === "yes" && a.contribution_hash === hash && a.audience === destination,
    );
    if (!yes) {
      const any = [...this.assents.values()].find((a) => a.contribution_hash === hash);
      if (!any) throw new GateError("assent", "no assent has been recorded for this contribution");
      if (any.decision !== "yes") throw new GateError("assent", `assent was "${any.decision}", not yes`);
      throw new GateError("assent", "assent was given for a different audience");
    }
    return yes;
  }
}
