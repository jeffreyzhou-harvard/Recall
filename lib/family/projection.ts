/**
 * The whitelist projection (AGENTS.md section 6: "tools 14-17 read through a
 * whitelist projection of allowed fields, never the raw graph").
 *
 * A family-side tool is handed a `FamilyView` and no graph. Everything a family
 * surface may ever show has to come out of one of the methods below, and each
 * returns a narrow, named shape: a topic's name, a count's raw events, a date,
 * a member's name, a boolean. There is no method that returns a claim, a
 * transcript, a citation, or a node - so a bug in a family tool has nothing to
 * leak. The one way her own words can come through is `sharedLines`, which
 * STARTS from her recorded yes to the share question (rule 10) and returns
 * nothing that has not got one.
 *
 * Writes are as narrow as the reads: a query category and a time, a posted
 * note, an access event, an export event, a family contribution. None of them
 * returns graph content.
 */
import { patientConfirmed, RELAY_AGENT_ID, type GraphEdge, type GraphNode, type Provenance, type SourceClass } from "@/lib/graph/types";
import { edgeId } from "@/lib/graph/seed";
import type { GraphStore } from "@/lib/graph/store";
import type { OutcomeRow } from "./record";

const LOG_ARTIFACT_ID = "artifact:family-side-log";

export interface SharedLine {
  /** Opaque handle, used only to mark the line as posted. Never shown. */
  ref: string;
  text: string;
  speaker_name: string;
  share_confirmed_at: string;
  content_hash: string;
}

export interface FamilyContributionInput {
  contributor_id: string;
  policy_id: string;
  who: string;
  what_happened: string;
  when_where: string | null;
  photo_asset: { asset_id: string; sha256: string } | null;
  about_topic_id: string | null;
  medium: "text" | "voice_note" | "photo";
  received_at: string;
}

export class FamilyView {
  constructor(
    private readonly graph: GraphStore,
    private readonly personId: string,
  ) {}

  // --- reads: names, booleans, counts' raw events, dates ---------------------------------------------------

  private async displayName(personId: string): Promise<string> {
    const node = await this.graph.getNode(personId);
    return node?.type === "Person" ? node.props.display_name : "";
  }

  herName(): Promise<string> {
    return this.displayName(this.personId);
  }

  memberName(memberId: string): Promise<string> {
    return this.displayName(memberId);
  }

  /** Is there anything of hers in the graph at all? A single boolean for the whole graph: it cannot be used to probe a topic. */
  async hasAnythingOfHers(): Promise<boolean> {
    for (const type of ["EpisodicClaim", "Contribution"] as const) {
      if ((await this.graph.nodesOfType(type)).some((n) => n.prov.patient_confirmed)) return true;
    }
    return false;
  }

  private async topicName(topicId: string): Promise<{ label: string; spoken_as: string } | null> {
    const node = await this.graph.getNode(topicId);
    if (!node) return null;
    const facet = "topic" in node.props ? node.props.topic : undefined;
    return { label: node.label, spoken_as: facet?.spoken_as ?? node.label };
  }

  /** Every TopicOutcome, as a topic name, a rung, and a time. */
  async outcomeRows(): Promise<OutcomeRow[]> {
    const rows: OutcomeRow[] = [];
    for (const o of await this.graph.nodesOfType("TopicOutcome")) {
      const name = await this.topicName(o.props.topic_id);
      if (name) rows.push({ topic_key: o.props.topic_id, topic_name: name.label, reached_at_rung: o.props.first_rung_reached_unaided, at: o.props.timestamp });
    }
    return rows;
  }

  /** Topics Relay talked with her about since `sinceIso`, newest first: how each is named aloud, and when. */
  async topicsTalkedAboutSince(sinceIso: string): Promise<Array<{ spoken_as: string; at: string }>> {
    const out: Array<{ spoken_as: string; at: string }> = [];
    for (const o of await this.graph.nodesOfType("TopicOutcome")) {
      if (o.props.timestamp < sinceIso) continue;
      const name = await this.topicName(o.props.topic_id);
      if (name) out.push({ spoken_as: name.spoken_as, at: o.props.timestamp });
    }
    return out.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
  }

  /**
   * Lines she chose to share. The walk starts at her recorded YES to the share question and follows it back
   * to the contribution, so a line with no share-confirmation is not filtered out - it is never reached.
   */
  async sharedLines(sinceIso: string, memberId: string): Promise<SharedLine[]> {
    const alreadyPosted = new Set<string>();
    for (const note of await this.graph.nodesOfType("WeeklyNote")) {
      if (note.props.member_id === memberId && note.props.shared_contribution_id) alreadyPosted.add(note.props.shared_contribution_id);
    }
    const out: SharedLine[] = [];
    for (const share of await this.graph.nodesOfType("ShareConfirmation")) {
      if (share.props.decision !== "yes" || share.props.recorded_at < sinceIso) continue;
      for (const edge of await this.graph.edgesOf(share.id)) {
        if (edge.type !== "SHARE_CONFIRMED_BY" || edge.to !== share.id || alreadyPosted.has(edge.from)) continue;
        const contribution = await this.graph.getNode(edge.from);
        if (contribution?.type !== "Contribution" || !contribution.props.shared || contribution.props.content_hash !== share.props.contribution_hash) continue;
        out.push({ ref: contribution.id, text: contribution.props.literal_transcript, speaker_name: await this.displayName(contribution.prov.author), share_confirmed_at: share.props.recorded_at, content_hash: contribution.props.content_hash });
      }
    }
    return out.sort((a, b) => (a.share_confirmed_at > b.share_confirmed_at ? -1 : a.share_confirmed_at < b.share_confirmed_at ? 1 : a.ref < b.ref ? -1 : 1));
  }

  /** Event topics nobody has given a date for. Names only. */
  async topicsWithoutAYear(): Promise<string[]> {
    return (await this.graph.nodesOfType("Event")).filter((e) => e.props.topic !== undefined && e.props.date === null).map((e) => e.label).sort();
  }

  /** Family members whose account of something differs from hers. Names only: never which accounts, and never who is right. */
  async membersWhoRememberDifferently(): Promise<string[]> {
    const names = new Set<string>();
    for (const claim of await this.graph.nodesOfType("EpisodicClaim")) {
      if (claim.prov.author !== this.personId) continue;
      for (const edge of await this.graph.edgesOf(claim.id)) {
        if (edge.type !== "CONTRADICTS") continue;
        const other = await this.graph.getNode(edge.from === claim.id ? edge.to : edge.from);
        if (other && other.prov.author !== this.personId) names.add(await this.displayName(other.prov.author));
      }
    }
    return [...names].filter(Boolean).sort();
  }

  async notePostedAtsFor(memberId: string): Promise<string[]> {
    return (await this.graph.nodesOfType("WeeklyNote")).filter((n) => n.props.member_id === memberId).map((n) => n.props.posted_at).sort();
  }

  /** Who exported the record, and when. Visible to all approved members (section 6.4.5). */
  async exportsLog(): Promise<Array<{ requester_name: string; at: string }>> {
    const out: Array<{ requester_name: string; at: string }> = [];
    for (const e of await this.graph.nodesOfType("ExportEvent")) out.push({ requester_name: await this.displayName(e.props.requester_id), at: e.props.at });
    return out.sort((a, b) => (a.at < b.at ? -1 : 1));
  }

  /** Is this an existing node a call could be about? A yes/no on an id the caller already holds. */
  async isKnownTopic(topicId: string): Promise<boolean> {
    const node = await this.graph.getNode(topicId);
    return node !== null && (node.type === "Place" || node.type === "Event" || node.type === "Person");
  }

  // --- writes: audit events, a posted note, a family contribution --------------------------------------------

  private prov(at: string, author: string, sourceId: string, sourceClass: SourceClass, asset: { asset_id: string; sha256: string } | null = null): Provenance {
    const status = sourceClass === "family_contribution" ? ("family_confirmed" as const) : ("reference" as const);
    return {
      source_id: sourceId,
      source_class: sourceClass,
      asset_id: asset?.asset_id ?? null,
      media_hash: asset?.sha256 ?? null,
      span: null,
      observed_at: at,
      author,
      extraction_method: sourceClass === "family_contribution" ? "family_form" : "system_event",
      confidence: 1,
      audience_scope: [this.personId],
      expires_at: null,
      supersedes: [],
      contradicts: [],
      status,
      patient_confirmed: patientConfirmed(status),
      confirmations: [],
    };
  }

  private async logArtifact(at: string): Promise<string> {
    if (!(await this.graph.getNode(LOG_ARTIFACT_ID))) {
      await this.graph.putNode({ id: LOG_ARTIFACT_ID, type: "Artifact", label: "Family-side log", props: { kind: "audit_log", text: null, alt: null }, prov: this.prov(at, RELAY_AGENT_ID, LOG_ARTIFACT_ID, "session_audit") });
    }
    return LOG_ARTIFACT_ID;
  }

  private async nextId(type: "FamilyQueryEvent" | "WeeklyNote" | "ExportEvent" | "DashboardAccessGrant", prefix: string): Promise<string> {
    return `${prefix}:${(await this.graph.nodesOfType(type)).length + 1}`;
  }

  private async put(node: Omit<GraphNode, "prov">, at: string): Promise<void> {
    await this.graph.putNode({ ...node, prov: this.prov(at, RELAY_AGENT_ID, await this.logArtifact(at), "session_audit") } as GraphNode);
  }

  /** Rule 8: a topic category and a time. There is no parameter through which the question itself could be stored. */
  async logFamilyQuery(category: string, at: string): Promise<void> {
    await this.put({ id: await this.nextId("FamilyQueryEvent", "family-query"), type: "FamilyQueryEvent", label: "Family query redirected", props: { category, at } }, at);
  }

  async logAccess(memberId: string, action: "viewed" | "refused" | "revoked", surface: string, at: string): Promise<void> {
    await this.put({ id: await this.nextId("DashboardAccessGrant", "access"), type: "DashboardAccessGrant", label: `Family view ${action}`, props: { member_id: memberId, action, surface, at } }, at);
  }

  async logExport(requesterId: string, at: string): Promise<void> {
    await this.put({ id: await this.nextId("ExportEvent", "export"), type: "ExportEvent", label: "Record exported", props: { requester_id: requesterId, at } }, at);
  }

  async postNote(memberId: string, postedAt: string, lines: Array<{ script_id: string; text: string }>, sharedRef: string | null): Promise<void> {
    const id = await this.nextId("WeeklyNote", "weekly-note");
    await this.put({ id, type: "WeeklyNote", label: "Weekly Note", props: { member_id: memberId, posted_at: postedAt, lines, shared_contribution_id: sharedRef } }, postedAt);
    if (sharedRef) {
      const edge: GraphEdge = { id: edgeId("POSTED_IN", sharedRef, id), type: "POSTED_IN", from: sharedRef, to: id, props: {}, prov: this.prov(postedAt, RELAY_AGENT_ID, LOG_ARTIFACT_ID, "session_audit") };
      await this.graph.putEdge(edge);
    }
  }

  /**
   * Rule 13: stored exactly as typed, as its contributor's claim - `family_confirmed`, so `patient_confirmed`
   * is false, and nothing but her own confirmed words can ever change that. Returns an opaque reference only.
   */
  async storeFamilyContribution(input: FamilyContributionInput): Promise<string> {
    const n = (await this.graph.nodesOfType("EpisodicClaim")).filter((c) => c.prov.source_class === "family_contribution").length + 1;
    const artifactId = `artifact:family-contribution:${n}`;
    const claimId = `claim:family-contribution:${n}`;
    const prov = this.prov(input.received_at, input.contributor_id, artifactId, "family_contribution", input.photo_asset);
    const about = [input.who, input.when_where].filter((s): s is string => !!s && s.trim() !== "").join(" - ");
    await this.graph.putNode({ id: artifactId, type: "Artifact", label: "A family memory, as it was told to Relay", props: { kind: input.medium === "photo" ? "photo" : "family_story", text: input.what_happened, alt: about || null }, prov });
    await this.graph.putNode({ id: claimId, type: "EpisodicClaim", label: about || "A family memory", props: { text: input.what_happened }, prov });
    const edges: Array<[GraphEdge["type"], string, string]> = [
      ["EVIDENCE_FOR", artifactId, claimId],
      ["SPOKEN_BY", claimId, input.contributor_id],
      ["CONTRIBUTED_BY", claimId, input.contributor_id],
      ["PERMITTED_IN", artifactId, input.policy_id],
    ];
    if (input.about_topic_id) edges.push(["ABOUT", claimId, input.about_topic_id]);
    for (const [type, from, to] of edges) await this.graph.putEdge({ id: edgeId(type, from, to), type, from, to, props: {}, prov });
    return `family-contribution:${n}`;
  }
}
