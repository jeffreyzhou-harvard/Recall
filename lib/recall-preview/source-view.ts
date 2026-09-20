import type { SampleSetupPhoto, SetupSelections } from "./imports";

/** Only an explicitly selected, fixture-associated photo can accompany a script.
 * A real File has no verified topic association and is never attached implicitly.
 * Once setup is agreed, removals are respected: the standalone fallback stops.
 */
export function photoForSession(setup: SetupSelections, topicId: string, standalone?: SampleSetupPhoto) {
  if (!setup.agreed) return standalone?.topicId === topicId ? standalone : undefined;
  return setup.samplePhotos?.find((photo) => photo.topicId === topicId && photo.src);
}
