/**
 * Request intake: one forwarded ask becomes a CurrentAsk in the graph, with
 * its message, its (at most one) photo, and provenance on every node and edge.
 *
 * This is the only way an ask enters Relay (hard rule 6: calls happen only
 * because an approved person forwarded a current ask). Intake does not decide
 * whether the asker is approved or the topic is allowed - the identity gate
 * and the access policy do, and they do it on every run. Intake only refuses
 * what it cannot even write down honestly: a malformed payload, a second
 * photo, media that is not in the manifest, or a party nobody set up.
 */
import { edgeId } from "@/lib/graph/seed";
import type { GraphStore } from "@/lib/graph/store";
import type { EdgeType, GraphEdge, GraphNode, Provenance, SourceClass } from "@/lib/graph/types";
import { AssetResolutionError, type AssetIndex } from "@/lib/provenance/assets";
import { IntakeError, parseForwardedAsk, type ForwardedAsk } from "./contract";
import type { AskInterpretation, AskInterpreter } from "./interpret";

export interface IntakeResult {
  ask_id: string;
  forward_id: string;
  thread_id: string;
  /** False when this exact forward was already taken in: redelivery by a bridge is a no-op. */
  created: boolean;
  interpretation: AskInterpretation | null;
}

export interface IntakeDeps {
  graph: GraphStore;
  assets: AssetIndex;
  interpreter: AskInterpreter;
  /** How long a forwarded ask stays usable, from the joint setup. After that it is no longer evidence for anything. */
  ask_ttl_hours: number;
}

export const askIdFor = (forwardId: string): string => `ask:${forwardId}`;

async function requireKnown(graph: GraphStore, id: string, what: string, type: GraphNode["type"]): Promise<void> {
  const node = await graph.getNode(id);
  if (!node || node.type !== type) throw new IntakeError("unknown_party", `${what} "${id}" is not part of the joint setup`);
}

export async function intakeForwardedAsk(raw: unknown, deps: IntakeDeps): Promise<IntakeResult> {
  const ask: ForwardedAsk = parseForwardedAsk(raw);
  const { graph, assets } = deps;
  const askId = askIdFor(ask.forward_id);

  if (await graph.getNode(askId)) {
    return { ask_id: askId, forward_id: ask.forward_id, thread_id: ask.thread_id, created: false, interpretation: null };
  }

  // Check everything before writing anything, so a refused forward leaves no trace in the graph.
  await requireKnown(graph, ask.thread_id, "thread", "Artifact");
  await requireKnown(graph, ask.asker_id, "asker", "Person");
  await requireKnown(graph, ask.addressee_id, "addressee", "Person");
  const photoHashes = new Map<string, string>();
  for (const photo of ask.photos) {
    try {
      photoHashes.set(photo.asset_id, assets.resolveSpan(photo.asset_id, null).sha256);
    } catch (e) {
      if (e instanceof AssetResolutionError) throw new IntakeError("unknown_asset", e.message);
      throw e;
    }
  }
  const interpretation = await deps.interpreter.interpret(ask, graph);

  const expiresAt = new Date(Date.parse(ask.received_at) + deps.ask_ttl_hours * 3_600_000).toISOString();
  const messageId = `artifact:msg:${ask.forward_id}`;
  const photoId = (assetId: string): string => `artifact:photo:${ask.forward_id}:${assetId}`;

  const prov = (sourceId: string, sourceClass: SourceClass, assetId: string | null, matched = false): Provenance => ({
    source_id: sourceId,
    source_class: sourceClass,
    asset_id: assetId,
    media_hash: assetId ? photoHashes.get(assetId)! : null,
    span: null,
    observed_at: ask.received_at,
    author: ask.asker_id,
    extraction_method: matched ? "lexical_match" : "forwarded_message",
    confidence: 1,
    audience_scope: [ask.requested_audience],
    expires_at: expiresAt,
    supersedes: [],
    contradicts: [],
  });
  const fromMessage = prov(messageId, "current_ask", null);
  const matchedInMessage = prov(messageId, "current_ask", null, true);

  const nodes: GraphNode[] = [
    { id: messageId, type: "Artifact", label: "Forwarded message", props: { kind: "message", text: ask.text, alt: null }, prov: fromMessage },
    ...ask.photos.map(
      (p): GraphNode => ({
        id: photoId(p.asset_id),
        type: "Artifact",
        label: p.caption ?? "Forwarded photo",
        props: { kind: "photo", text: null, alt: p.caption },
        prov: prov(photoId(p.asset_id), "ask_artifact", p.asset_id),
      }),
    ),
    {
      id: askId,
      type: "CurrentAsk",
      label: ask.text,
      props: {
        forward_id: ask.forward_id,
        thread_id: ask.thread_id,
        text: ask.text,
        option_topic_ids: interpretation.option_topic_ids,
        requested_audience: ask.requested_audience,
        received_at: ask.received_at,
      },
      prov: fromMessage,
    },
  ];

  const edges: GraphEdge[] = [];
  const link = (type: EdgeType, from: string, to: string, p: Provenance, props: GraphEdge["props"] = {}): void =>
    void edges.push({ id: edgeId(type, from, to), type, from, to, props, prov: p });

  link("ASKED_BY", askId, ask.asker_id, fromMessage);
  link("ADDRESSED_TO", askId, ask.addressee_id, fromMessage);
  link("SPOKEN_BY", messageId, ask.asker_id, fromMessage);
  link("EVIDENCE_FOR", messageId, askId, fromMessage);
  for (const p of ask.photos) {
    const own = prov(photoId(p.asset_id), "ask_artifact", p.asset_id);
    link("SPOKEN_BY", photoId(p.asset_id), ask.asker_id, own);
    link("EVIDENCE_FOR", photoId(p.asset_id), askId, own);
    for (const topicId of interpretation.depicts[p.asset_id] ?? []) {
      link("DEPICTS", photoId(p.asset_id), topicId, prov(photoId(p.asset_id), "ask_artifact", p.asset_id, true));
    }
  }
  for (const topicId of interpretation.option_topic_ids) link("ABOUT", askId, topicId, matchedInMessage, { role: "option" });
  for (const topicId of interpretation.subject_topic_ids) link("ABOUT", askId, topicId, matchedInMessage, { role: "subject" });
  for (const eventId of interpretation.event_ids) link("ABOUT", askId, eventId, matchedInMessage, { role: "occasion" });

  for (const node of nodes) await graph.putNode(node);
  for (const edge of edges) await graph.putEdge(edge);
  return { ask_id: askId, forward_id: ask.forward_id, thread_id: ask.thread_id, created: true, interpretation };
}
