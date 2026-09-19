/**
 * Relay context graph - compact, private, and not a clinical record
 * (AGENTS.md section 7). Twelve node types, sixteen edge types, and one
 * provenance shape that every claim and every edge must carry.
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
  "CurrentAsk",
  "Artifact",
  "Topic",
  "EpisodicClaim",
  "PreferenceExpertise",
  "Event",
  "AccessPolicy",
  "Session",
  "Contribution",
  "Assent",
  // Discovery loop: what the photo library and conversation add to a person's context.
  "Place",
  "Activity",
  "Story",
  /** A recurring face, place, time, or theme across photos. An observation, never an identity. */
  "Cluster",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  "ASKED_BY",
  "ADDRESSED_TO",
  "MEMBER_OF_THREAD",
  "DEPICTS",
  "ABOUT",
  "EVIDENCE_FOR",
  "SPOKEN_BY",
  "RELATED_TO",
  "OCCURRED_AT",
  "PERMITTED_IN",
  "RELEVANT_TO",
  "CONTRADICTS",
  "DERIVED_FROM",
  "INCLUDED_SPAN",
  "APPROVED_BY",
  "DELIVERED_TO",
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
  4: "contribution, assent, and delivery audit",
};
export const NODE_LAYER: Record<NodeType, Layer> = {
  Artifact: 1,
  Person: 2,
  Relationship: 2,
  Topic: 2,
  EpisodicClaim: 2,
  PreferenceExpertise: 2,
  Event: 2,
  AccessPolicy: 2,
  CurrentAsk: 3,
  Session: 3,
  Contribution: 4,
  Assent: 4,
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
  "current_ask", // the forwarded ask itself: text, asker, requested audience
  "ask_artifact", // the photo(s) forwarded with the ask
  "prior_claim_with_source", // an earlier claim backed by an original clip
  "joint_setup", // the one-time setup the family did together
  "public_reference", // general entities: dishes, holidays, ingredients
  "session_audit", // layers 3-4, written by Relay during a call
  "photo_library", // photos the family gave access to, and what was observed across them
  "discovery_answer", // what she, or an approved relative, said when Relay asked about a gap
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export const EXTRACTION_METHODS = [
  "forwarded_message", // taken verbatim from the forwarded ask
  "lexical_match", // an exact match of the asker's own words against a known topic or event name
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
  /** Every person who has confirmed or disputed this, with their source. Grows; never shrinks. */
  confirmations: Confirmation[];
}

/** How a fact starts out, from where it came from. Anything from the photo library starts as an observation. */
export function initialStatus(sourceClass: SourceClass, authoredByParticipant = false): EpistemicStatus {
  switch (sourceClass) {
    case "public_reference":
    case "session_audit":
      return "reference";
    case "photo_library":
      return "observed";
    case "prior_claim_with_source":
      return "participant_confirmed";
    case "discovery_answer":
      return authoredByParticipant ? "participant_confirmed" : "family_confirmed";
    case "current_ask":
    case "ask_artifact":
    case "joint_setup":
      return "family_confirmed";
  }
}

export type ArtifactKind = "photo" | "audio" | "message" | "thread" | "setup_record" | "answer";

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
    /** `known` is someone who came up in discovery. Being known grants nothing: only the policy approves an asker. */
    role: "participant" | "asker" | "known";
    /** As the person stated it in the joint setup. Absent means use their name; never guessed from a name. */
    subject_pronoun?: string;
  }
>;
export type RelationshipNode = NodeBase<"Relationship", { kind: string; verified: boolean }>;
export type CurrentAskNode = NodeBase<
  "CurrentAsk",
  {
    /** The bridge's id for the forwarded message. Every outbound message is a reply to one of these. */
    forward_id: string;
    thread_id: string;
    text: string;
    option_topic_ids: string[];
    requested_audience: string;
    received_at: string;
  }
>;
export type ArtifactNode = NodeBase<
  "Artifact",
  { kind: ArtifactKind; text: string | null; alt: string | null }
>;
export type TopicNode = NodeBase<"Topic", { wikidata_id: string | null; aliases: string[] }>;
export type EpisodicClaimNode = NodeBase<"EpisodicClaim", { text: string }>;
export type PreferenceExpertiseNode = NodeBase<"PreferenceExpertise", { text: string }>;
export type EventNode = NodeBase<"Event", { wikidata_id: string | null; date: string | null }>;
export type AccessPolicyNode = NodeBase<"AccessPolicy", { policy_ref: string }>;
export type SessionNode = NodeBase<"Session", { ask_id: string; started_at: string; ended_at: string | null }>;
export type ContributionNode = NodeBase<
  "Contribution",
  { content_hash: string; literal_transcript: string; generated_first_person_words: 0 }
>;
export type AssentNode = NodeBase<
  "Assent",
  { decision: "yes" | "no" | "unclear"; contribution_hash: string; audience: string }
>;

export type PlaceNode = NodeBase<"Place", { aliases: string[] }>;
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
  | CurrentAskNode
  | ArtifactNode
  | TopicNode
  | EpisodicClaimNode
  | PreferenceExpertiseNode
  | EventNode
  | AccessPolicyNode
  | SessionNode
  | ContributionNode
  | AssentNode;

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
  ASKED_BY: [["CurrentAsk", "Person"]],
  ADDRESSED_TO: [["CurrentAsk", "Person"]],
  MEMBER_OF_THREAD: [["Person", "Artifact"]],
  DEPICTS: [
    ["Artifact", "Topic"],
    ["Artifact", "Cluster"],
  ],
  ABOUT: [
    ["CurrentAsk", "Topic"],
    ["CurrentAsk", "Event"],
    ["EpisodicClaim", "Topic"],
    ["PreferenceExpertise", "Topic"],
    // A forwarded ask can be about anything she or the family has already told Relay about.
    ["CurrentAsk", "Person"],
    ["CurrentAsk", "Place"],
    ["CurrentAsk", "Activity"],
    ["CurrentAsk", "PreferenceExpertise"],
    ["Story", "Person"],
    ["Story", "Place"],
    ["Story", "Event"],
    ["Story", "Activity"],
  ],
  EVIDENCE_FOR: [
    ["Artifact", "CurrentAsk"],
    ["Artifact", "EpisodicClaim"],
    ["Artifact", "PreferenceExpertise"],
    ["Artifact", "Relationship"],
  ],
  SPOKEN_BY: [
    ["Artifact", "Person"],
    ["EpisodicClaim", "Person"],
    ["PreferenceExpertise", "Person"],
    ["Contribution", "Person"],
    ["Assent", "Person"],
    ["Story", "Person"],
  ],
  RELATED_TO: [
    ["Relationship", "Person"],
    ["Topic", "Topic"],
    // Knowledge relations. The meaning is `props.relation`, from the closed vocabulary in relations.ts.
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
    ["Topic", "AccessPolicy"],
  ],
  RELEVANT_TO: [
    ["EpisodicClaim", "CurrentAsk"],
    ["Artifact", "CurrentAsk"],
  ],
  CONTRADICTS: [["EpisodicClaim", "EpisodicClaim"]],
  DERIVED_FROM: [
    ["EpisodicClaim", "Artifact"],
    ["Contribution", "Artifact"],
    ["Contribution", "Session"],
  ],
  INCLUDED_SPAN: [["Contribution", "Artifact"]],
  APPROVED_BY: [["Contribution", "Assent"]],
  DELIVERED_TO: [["Contribution", "Artifact"]],
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
