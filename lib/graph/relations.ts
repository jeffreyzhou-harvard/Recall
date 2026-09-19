/**
 * What a knowledge edge can mean. "Edges contain the meaning" - but only a
 * meaning from this list. A model proposing facts from someone's answer can
 * pick a relation; it cannot coin one, so biography cannot drift into whatever
 * a model finds plausible.
 *
 * An edge reads source -> target as "target is source's <relation>":
 *
 *     Susan --child--> Maya        Maya is Susan's child
 *     Susan --lived_in--> Boston   Boston is where Susan lived
 *
 * The relation is deliberately plain and ungendered. The word the person
 * actually used ("daughter", "my big sister") is kept beside it as `said_as`
 * and is what gets shown and spoken: her word, not Relay's paraphrase.
 */
import type { EdgeType, GraphEdge, NodeType } from "./types";

interface RelationRule {
  from: readonly NodeType[];
  to: readonly NodeType[];
  /** What the same fact is called from the other end, if it has a name. */
  inverse?: string;
}

const PERSON = ["Person"] as const;

export const RELATIONS = {
  child: { from: PERSON, to: PERSON, inverse: "parent" },
  parent: { from: PERSON, to: PERSON, inverse: "child" },
  grandchild: { from: PERSON, to: PERSON, inverse: "grandparent" },
  grandparent: { from: PERSON, to: PERSON, inverse: "grandchild" },
  sibling: { from: PERSON, to: PERSON, inverse: "sibling" },
  spouse: { from: PERSON, to: PERSON, inverse: "spouse" },
  friend: { from: PERSON, to: PERSON, inverse: "friend" },
  /** Family, where nobody has said how. Better an honest "relative" than a guessed "niece". */
  relative: { from: PERSON, to: PERSON, inverse: "relative" },
  lived_in: { from: PERSON, to: ["Place"] },
  worked_at: { from: PERSON, to: ["Place"] },
  visited: { from: PERSON, to: ["Place"] },
  attended: { from: PERSON, to: ["Event"] },
  enjoys: { from: PERSON, to: ["Activity"] },
  prefers: { from: PERSON, to: ["PreferenceExpertise"] },
  took_place_at: { from: ["Event"], to: ["Place"] },
} as const satisfies Record<string, RelationRule>;

export type Relation = keyof typeof RELATIONS;
export const RELATION_NAMES = Object.keys(RELATIONS) as Relation[];

/** The everyday words people use, and the relation each one means. Matching is on her words, never on a guess. */
export const KIN_WORDS: Readonly<Record<string, Relation>> = {
  daughter: "child", son: "child", child: "child", kid: "child",
  mother: "parent", mom: "parent", mum: "parent", father: "parent", dad: "parent",
  granddaughter: "grandchild", grandson: "grandchild", grandchild: "grandchild",
  grandmother: "grandparent", grandfather: "grandparent", grandma: "grandparent", grandpa: "grandparent",
  sister: "sibling", brother: "sibling",
  husband: "spouse", wife: "spouse", spouse: "spouse", partner: "spouse",
  friend: "friend",
  niece: "relative", nephew: "relative", cousin: "relative", aunt: "relative", uncle: "relative",
};

export const KNOWLEDGE_EDGE: EdgeType = "RELATED_TO";

export class RelationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationError";
  }
}

export const isRelation = (value: unknown): value is Relation => typeof value === "string" && value in RELATIONS;

/** Throws unless the relation is in the vocabulary and may connect these two kinds of node. */
export function assertRelation(relation: unknown, fromType: NodeType, toType: NodeType): asserts relation is Relation {
  if (!isRelation(relation)) throw new RelationError(`"${String(relation)}" is not a relation Relay knows; relations come from a closed list`);
  const rule: RelationRule = RELATIONS[relation];
  if (!rule.from.includes(fromType) || !rule.to.includes(toType)) {
    throw new RelationError(`"${relation}" cannot connect ${fromType} -> ${toType}`);
  }
}

/** The relation an edge carries, or null for the older structural uses of RELATED_TO (setup relationships, topic kinds). */
export const relationOf = (edge: GraphEdge): Relation | null => (edge.type === KNOWLEDGE_EDGE && isRelation(edge.props.relation) ? edge.props.relation : null);
