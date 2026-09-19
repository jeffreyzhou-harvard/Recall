/**
 * Relay context graph - compact, private, and not a clinical record
 * (AGENTS.md section 7). The brief's eighteen node types, plus the three the
 * discovery loop adds (Activity, Story, Cluster), and one provenance shape that
 * every claim and every edge must carry.
 *
 * Vocabulary attribution: provenance concepts follow W3C PROV-O; general
 * entity naming follows Schema.org where useful (CC BY-SA 3.0). Relay-specific
 * extensions live in the `relay:` namespace. Wikidata (CC0) is used only for
 * public entity IDs (dishes, holidays, ingredients) - never for anything
 * personal.
 */

export const NODE_TYPES = [
  "Person",
  "Relationship",
  "Place",
  "Event",
  "EpisodicClaim",
  "PreferenceExpertise",
  "Artifact",
  "AccessPolicy",
  "Session",
  "Contribution",
  /** One use of one cue on one topic, and whether she reached the memory after it (section 6.3). Never shown to anyone. */
  "RetrievalRecord",
  /** A family question arrived. Topic category and time only - never the question (rule 8). */
  "FamilyQueryEvent",
  "WeeklyNote",
  "ShareConfirmation",
  /** What happened on one topic in one call: observable, per topic, never aggregated (section 6.4.3). */
  "TopicOutcome",
  "ExportEvent",
  /** A dashboard access event: granted, revoked, viewed, refused (rule 14: access is logged). */
  "DashboardAccessGrant",
  /** Category, time, and who was alerted. Never her words (rules 8 and 15). */
  "SafetyEvent",
  // Discovery loop: what conversation adds to a person's context.
  "Activity",
  "Story",
  /** A recurring face, place, time, or theme across photos. An observation, never an identity. */
  "Cluster",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  "DEPICTS",
  "ABOUT",
  "EVIDENCE_FOR",
  "SPOKEN_BY",
  "RELATED_TO",
  "OCCURRED_AT",
  "PERMITTED_IN",
  "CONTRADICTS",
  "DERIVED_FROM",
  "INCLUDED_SPAN",
  /** A family member told Relay this. It stays their claim on every read (rule 13). */
  "CONTRIBUTED_BY",
  "RECALLED_IN",
  "CUE_EFFECTIVE_FOR",
  "CUE_INEFFECTIVE_FOR",
  "SHARE_CONFIRMED_BY",
  "POSTED_IN",
  "OUTCOME_OF",
  /** A person said what a cluster is. The cluster stays an observation; the identity is a claim with a source. */
  "IDENTIFIED_AS",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * The four storage layers. A node's layer is fixed by its type, so nothing
 * ephemeral can be mistaken for evidence and nothing inferred can sit in the
 * evidence layer.
 */
export type Layer = 1 | 2 | 3 | 4;
export const LAYER_NAMES: Record<Layer, string> = {
  1: "immutable raw evidence",
  2: "extracted claims with citations",
  3: "ephemeral session state",
  4: "contribution, confirmation, and retrieval-outcome audit",
};
export const NODE_LAYER: Record<NodeType, Layer> = {
  Artifact: 1,
  Person: 2,
  Relationship: 2,
  EpisodicClaim: 2,
  PreferenceExpertise: 2,
  Event: 2,
  AccessPolicy: 2,
  Session: 3,
  Contribution: 4,
  RetrievalRecord: 4,
  FamilyQueryEvent: 4,
  WeeklyNote: 4,
  ShareConfirmation: 4,
  TopicOutcome: 4,
  ExportEvent: 4,
  DashboardAccessGrant: 4,
  SafetyEvent: 4,
  Place: 2,
  Activity: 2,
  Story: 2,
  Cluster: 2,
};

/**
 * Which source class a piece of evidence belongs to. `get_access_policy`
 * returns the classes a call may draw on; retrieval drops everything else.
 */
export const SOURCE_CLASSES = [
  "prior_claim_with_source", // something she said earlier, backed by the original recording
  "recall_call", // something she said on a Relay call, played back to her and confirmed (rule 3)
  "family_contribution", // something a family member told Relay. Theirs, not hers (rule 13)
  "joint_setup", // the one-time setup the family did together
  "public_reference", // general entities: dishes, holidays, ingredients
  "session_audit", // layers 3-4, written by Relay during a call
  "photo_library", // photos the family gave access to, and what was observed across them
  "discovery_answer", // what she, or an approved relative, said when Relay asked about a gap
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export const EXTRACTION_METHODS = [
  "family_form", // typed by a family member into the contribution form, kept exactly as typed
  "literal_transcript", // exact words from a recording, no paraphrase
  "manual_curation", // hand-entered by the family during setup or seeding
  "joint_setup", // agreed in the one-time joint setup
  "public_reference", // public entity data (Wikidata)
  "system_event", // Relay recording its own action
  "photo_analysis", // observed across photos: a recurring face, place, or time. No identity, no meaning
  "answer_interpretation", // read out of a person's answer; grounded in their literal words
  "rule_deduction", // follows by a fixed rule from reference facts and what was stated
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/**
 * How a fact is known. Inference must never silently become fact, so this is carried on every
 * node and edge, and only a person saying so - recorded as a Confirmation with its source - can
 * raise it. There is no code path that turns `observed` or `inferred` into fact on its own.
 *
 *   observed               seen in the evidence (a face recurs in 184 photos). Says nothing about who or why.
 *   inferred               a hypothesis drawn from observations or other facts. Never spoken as fact.
 *   family_confirmed       an approved relative said so.
 *   participant_confirmed  she said so herself.
 *   disputed               someone said it is wrong. Used nowhere until a person resolves it.
 *   reference              not a claim about her life: public entities, Relay's own audit records.
 */
export const EPISTEMIC_STATUSES = ["observed", "inferred", "family_confirmed", "participant_confirmed", "disputed", "reference"] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

/** Only these may be spoken as fact or retrieved as context. */
export const SPEAKABLE_AS_FACT: ReadonlySet<EpistemicStatus> = new Set(["family_confirmed", "participant_confirmed", "reference"]);

/** "Confirmed by Maya - Sept 19". Appended, never edited or removed. */
export interface Confirmation {
  by: string;
  role: "participant" | "family";
  stance: "confirms" | "disputes";
  /** The Artifact holding their literal words. A confirmation with no source cannot be recorded. */
  source_id: string;
  at: string;
}

/** Status after a new confirmation. Monotonic toward her own word; a dispute wins until a person resolves it. */
export function statusAfter(current: EpistemicStatus, c: Confirmation): EpistemicStatus {
  if (current === "reference") throw new Error("reference facts are not claims about her life and cannot be confirmed or disputed");
  if (c.stance === "disputes" || current === "disputed") return "disputed";
  if (c.role === "participant" || current === "participant_confirmed") return "participant_confirmed";
  return "family_confirmed";
}

/** A time span inside an audio or video asset. */
export interface MediaSpan {
  start_ms: number;
  end_ms: number;
}

/**
 * Carried by every claim and every edge. There is deliberately no field here
 * for diagnosis, mood, competence, or cognition: `confidence` describes how
 * sure the *extraction* is (was this word really said), never the person.
 */
export interface Provenance {
  /** The Artifact node (layer 1) this was observed in. */
  source_id: string;
  source_class: SourceClass;
  /** Asset in /assets/manifest.json backing `source_id`, when it is media. */
  asset_id: string | null;
  /** sha256 of that asset. Stamped from the manifest at load, never typed by hand. */
  media_hash: string | null;
  /** Exact span within the asset, when the evidence is a stretch of audio. */
  span: MediaSpan | null;
  observed_at: string;
  /** Person id of the speaker or author. `system:relay` for Relay's own records. */
  author: string;
  extraction_method: ExtractionMethod;
  confidence: number;
  /** Node ids (people or threads) this may be used with. Empty means nobody. */
  audience_scope: string[];
  expires_at: string | null;
  supersedes: string[];
  contradicts: string[];
  status: EpistemicStatus;
  /**
   * Has SHE said so herself? Never set by hand: it is `patientConfirmed(status)` wherever provenance is
   * built or changed, so it cannot drift from how the fact is actually known. A family contribution is
   * `false` until her own words, played back and confirmed, say otherwise (rules 3 and 13).
   */
  patient_confirmed: boolean;
  /** Every person who has confirmed or disputed this, with their source. Grows; never shrinks. */
  confirmations: Confirmation[];
}

export const patientConfirmed = (status: EpistemicStatus): boolean => status === "participant_confirmed";

/** How a fact starts out, from where it came from. Anything from the photo library starts as an observation. */
export function initialStatus(sourceClass: SourceClass, authoredByParticipant = false): EpistemicStatus {
  switch (sourceClass) {
    case "public_reference":
    case "session_audit":
      return "reference";
    case "photo_library":
      return "observed";
    case "prior_claim_with_source":
    case "recall_call":
      return "participant_confirmed";
    case "discovery_answer":
      return authoredByParticipant ? "participant_confirmed" : "family_confirmed";
    case "family_contribution":
    case "joint_setup":
      return "family_confirmed";
  }
}

export type ArtifactKind = "photo" | "audio" | "setup_record" | "answer" | "family_story" | "call" | "audit_log";

/**
 * What makes a node something Relay can invite her to talk about (section 6.1). Written by a person at
 * setup, never generated: how to name it aloud, and which set of ladder lines in the call script fits it.
 */
export interface TopicFacet {
  /** As it is said in the invitation: "the summers at Cape May". */
  spoken_as: string;
  /** Key into the call script's ladder lines: "family_summers", "workplace"... */
  category: string;
  /**
   * When in her life it is from, if a person has said. Used only to break ties when choosing a topic:
   * memories from roughly ages 6-30 are the most retrievable, then very recent ones, then the years
   * between (EVIDENCE.md, section A). Never guessed from a date.
   */
  life_period?: LifePeriod;
}

export const LIFE_PERIODS = ["ages_6_to_30", "recent", "after_30"] as const;
export type LifePeriod = (typeof LIFE_PERIODS)[number];

interface NodeBase<T extends NodeType, P> {
  id: string;
  type: T;
  label: string;
  props: P;
  prov: Provenance;
}

export type PersonNode = NodeBase<
  "Person",
  {
    display_name: string;
    /** `known` is someone who came up in conversation. Being known grants nothing: only the joint setup approves a contributor. */
    role: "participant" | "family" | "known";
    /** As the person stated it in the joint setup. Absent means use their name; never guessed from a name. */
    subject_pronoun?: string;
  }
>;
export type RelationshipNode = NodeBase<"Relationship", { kind: string; verified: boolean }>;
export type ArtifactNode = NodeBase<
  "Artifact",
  { kind: ArtifactKind; text: string | null; alt: string | null }
>;
export type EpisodicClaimNode = NodeBase<"EpisodicClaim", { text: string; topic?: TopicFacet }>;
export type PreferenceExpertiseNode = NodeBase<"PreferenceExpertise", { text: string }>;
export type EventNode = NodeBase<"Event", { wikidata_id: string | null; date: string | null; topic?: TopicFacet }>;
export type AccessPolicyNode = NodeBase<"AccessPolicy", { policy_ref: string }>;
export type SessionNode = NodeBase<"Session", { topic_id: string; started_at: string; ended_at: string | null; outcome: string }>;
export type ContributionNode = NodeBase<
  "Contribution",
  { content_hash: string; literal_transcript: string; generated_first_person_words: 0; shared: boolean }
>;
export type RetrievalRecordNode = NodeBase<"RetrievalRecord", { topic_id: string; cue_id: string; rung: number; effective: boolean; used_at: string }>;
export type FamilyQueryEventNode = NodeBase<"FamilyQueryEvent", { category: string; at: string }>;
export type WeeklyNoteNode = NodeBase<
  "WeeklyNote",
  { member_id: string; posted_at: string; lines: Array<{ script_id: string; text: string }>; shared_contribution_id: string | null }
>;
export type ShareConfirmationNode = NodeBase<"ShareConfirmation", { decision: "yes" | "no" | "unclear" | "timeout"; contribution_hash: string; recorded_at: string }>;
export type TopicOutcomeNode = NodeBase<
  "TopicOutcome",
  {
    session_id: string;
    topic_id: string;
    /** The rung at which she reached the memory - 1 is free recall, unaided - or null if she did not reach it in this call. */
    first_rung_reached_unaided: number | null;
    highest_rung_used: number;
    timestamp: string;
  }
>;
export type ExportEventNode = NodeBase<"ExportEvent", { requester_id: string; at: string }>;
export type DashboardAccessGrantNode = NodeBase<"DashboardAccessGrant", { member_id: string; action: "viewed" | "refused" | "revoked"; surface: string; at: string }>;
export type SafetyEventNode = NodeBase<"SafetyEvent", { category: string; at: string; recipients: string[] }>;

export type PlaceNode = NodeBase<"Place", { aliases: string[]; topic?: TopicFacet }>;
export type ActivityNode = NodeBase<"Activity", { aliases: string[] }>;
/** Her own telling, verbatim. Relay never writes, polishes, or summarizes a story (rule 1). */
export type StoryNode = NodeBase<"Story", { text: string }>;
export type ClusterNode = NodeBase<
  "Cluster",
  {
    kind: "face" | "place" | "time" | "theme";
    /** The analyzer's own key for this cluster. Opaque. Never a name, and never a face embedding. */
    cluster_key: string;
    photo_count: number;
  }
>;

export type GraphNode =
  | PlaceNode
  | ActivityNode
  | StoryNode
  | ClusterNode
  | PersonNode
  | RelationshipNode
  | ArtifactNode
  | EpisodicClaimNode
  | PreferenceExpertiseNode
  | EventNode
  | AccessPolicyNode
  | SessionNode
  | ContributionNode
  | RetrievalRecordNode
  | FamilyQueryEventNode
  | WeeklyNoteNode
  | ShareConfirmationNode
  | TopicOutcomeNode
  | ExportEventNode
  | DashboardAccessGrantNode
  | SafetyEventNode;

/** The kinds of node a recall call can be about. A Person only when the joint setup turns that on (section 6.1). */
export const TOPIC_NODE_TYPES = ["Place", "Event", "EpisodicClaim", "Person"] as const;
export type TopicNodeType = (typeof TOPIC_NODE_TYPES)[number];
/** The two record layers a caregiver may delete, each on its own (section 6.3). Nothing else in the graph can be removed. */
export const ERASABLE_NODE_TYPES = ["RetrievalRecord", "TopicOutcome"] as const;
export type ErasableNodeType = (typeof ERASABLE_NODE_TYPES)[number];

export type NodeOf<T extends NodeType> = Extract<GraphNode, { type: T }>;

export interface GraphEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  props: Record<string, string | number | boolean | null>;
  prov: Provenance;
}

/**
 * Which node types each edge may connect. The seed validator rejects anything
 * outside this table, and the LadybugDB DDL is generated from it, so the two graph
 * stores can never disagree about the shape of the graph.
 */
export const EDGE_SIGNATURES: Record<EdgeType, ReadonlyArray<readonly [NodeType, NodeType]>> = {
  DEPICTS: [
    ["Artifact", "Person"],
    ["Artifact", "Place"],
    ["Artifact", "Event"],
    ["Artifact", "Cluster"],
  ],
  ABOUT: [
    ["EpisodicClaim", "Person"],
    ["EpisodicClaim", "Place"],
    ["EpisodicClaim", "Event"],
    ["PreferenceExpertise", "Place"],
    ["PreferenceExpertise", "Event"],
    ["Story", "Person"],
    ["Story", "Place"],
    ["Story", "Event"],
    ["Story", "Activity"],
  ],
  EVIDENCE_FOR: [
    ["Artifact", "EpisodicClaim"],
    ["Artifact", "PreferenceExpertise"],
    ["Artifact", "Relationship"],
  ],
  SPOKEN_BY: [
    ["Artifact", "Person"],
    ["EpisodicClaim", "Person"],
    ["PreferenceExpertise", "Person"],
    ["Contribution", "Person"],
    ["ShareConfirmation", "Person"],
    ["Story", "Person"],
  ],
  RELATED_TO: [
    ["Relationship", "Person"],
    // Knowledge relations. The meaning is `props.relation`, from the closed vocabulary in relations.ts
    // (the brief's WORKED_AT and LOCATED_AT are `worked_at` and `took_place_at` here).
    ["Person", "Person"],
    ["Person", "Place"],
    ["Person", "Event"],
    ["Person", "Activity"],
    ["Person", "PreferenceExpertise"],
    ["Event", "Place"],
  ],
  OCCURRED_AT: [
    ["EpisodicClaim", "Event"],
    ["Session", "Event"],
  ],
  PERMITTED_IN: [
    ["Person", "AccessPolicy"],
    ["Artifact", "AccessPolicy"],
  ],
  CONTRADICTS: [["EpisodicClaim", "EpisodicClaim"]],
  DERIVED_FROM: [
    ["EpisodicClaim", "Artifact"],
    ["EpisodicClaim", "Contribution"],
    ["Contribution", "Artifact"],
    ["Contribution", "Session"],
  ],
  INCLUDED_SPAN: [["Contribution", "Artifact"]],
  CONTRIBUTED_BY: [
    ["EpisodicClaim", "Person"],
    ["Artifact", "Person"],
  ],
  RECALLED_IN: [
    ["Place", "Session"],
    ["Event", "Session"],
    ["EpisodicClaim", "Session"],
    ["Person", "Session"],
  ],
  CUE_EFFECTIVE_FOR: [
    ["RetrievalRecord", "Place"],
    ["RetrievalRecord", "Event"],
    ["RetrievalRecord", "EpisodicClaim"],
    ["RetrievalRecord", "Person"],
  ],
  CUE_INEFFECTIVE_FOR: [
    ["RetrievalRecord", "Place"],
    ["RetrievalRecord", "Event"],
    ["RetrievalRecord", "EpisodicClaim"],
    ["RetrievalRecord", "Person"],
  ],
  SHARE_CONFIRMED_BY: [["Contribution", "ShareConfirmation"]],
  POSTED_IN: [["Contribution", "WeeklyNote"]],
  OUTCOME_OF: [["TopicOutcome", "Session"]],
  IDENTIFIED_AS: [
    ["Cluster", "Person"],
    ["Cluster", "Place"],
    ["Cluster", "Event"],
    ["Cluster", "Activity"],
  ],
};

export const RELAY_AGENT_ID = "system:relay";

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
