/** Private, topic-bound visual cues. Shared-album/facial matches never establish call evidence. */
import { createHash } from "node:crypto";
import { contextExclusion, retrieveCandidates } from "@/lib/graph/retrieval";
import type { GraphStore } from "@/lib/graph/store";
import type { GraphNode } from "@/lib/graph/types";
import type { CallPhotoContext } from "@/lib/orchestrator/call-driver";
import type { SetupStore } from "@/lib/tools/policy";
import type { Media, MediaStore } from "./media";

export type CallPhotoMedia = { id: string; media: Media };
export type CallPhotoSource = (context: CallPhotoContext) => Promise<CallPhotoMedia[]>;

export function callPhotoSource(graph: GraphStore, media: MediaStore, setup: SetupStore, now = () => new Date().toISOString()): CallPhotoSource {
  return async ({ topic_id, artifact_ids }) => {
    const policy = setup.current();
    if (policy.calls_paused || !policy.topics.allow.includes(topic_id) || policy.topics.block.includes(topic_id) || !policy.approved_audiences.includes(policy.person_id)) return [];
    const params = { topic_id, policy_id: policy.policy_id, audience: policy.person_id, allowed_sources: policy.allowed_source_classes, approved_authors: [policy.person_id, ...policy.approved_people], max_hops: 2, now_iso: now() };
    const topic = await graph.getNode(topic_id);
    const blocked = (text: string) => policy.blocked_terms.some((term) => text.toLowerCase().includes(term.toLowerCase()));
    const blockedContent = (node: GraphNode) => blocked([node.label, "text" in node.props ? node.props.text : "", "alt" in node.props ? node.props.alt : "", "topic" in node.props ? node.props.topic?.spoken_as : ""].join(" "));
    if (!topic || (topic.type === "Person" && !policy.topics.person_topics_enabled) || blockedContent(topic) || await contextExclusion(graph, params, topic.prov)) return [];
    const reachable = new Map((await retrieveCandidates(graph, params)).candidates.map((candidate) => [candidate.root_id, candidate]));
    const photos: CallPhotoMedia[] = [];
    for (const id of new Set(artifact_ids)) {
      const candidate = reachable.get(id);
      if (!candidate) continue;
      const path = await Promise.all(candidate.path_node_ids.map((nodeId) => graph.getNode(nodeId)));
      const permittedPath = await Promise.all(path.map(async (node) => !!node && !policy.topics.block.includes(node.id) && !blockedContent(node) && await contextExclusion(graph, params, node.prov, node.type === "Artifact" ? node.id : node.prov.source_id) === null && !(await graph.edgesOf(node.id)).some((edge) => edge.type === "CONTRADICTS")));
      if (permittedPath.includes(false)) continue;
      const node = await graph.getNode(id);
      if (node?.type !== "Artifact" || node.props.kind !== "photo" || !node.prov.asset_id || (await graph.edgesOf(id)).some((edge) => edge.type === "CONTRADICTS")) continue;
      const image = media.get(node.prov.asset_id);
      if (!image || image.entry.kind !== "image" || !["image/jpeg", "image/png"].includes(image.mime) || image.owner !== node.prov.author || image.entry.sha256 !== node.prov.media_hash) continue;
      if (createHash("sha256").update(image.bytes).digest("hex") !== node.prov.media_hash) continue;
      photos.push({ id, media: image });
    }
    // A tightening during an async graph read invalidates the entire response.
    return JSON.stringify(setup.current()) === JSON.stringify(policy) ? photos : [];
  };
}
