import { redirect } from "next/navigation";

/** Preserve old bookmarks without exposing design preview controls. */
export default function FormerDesignPreview() {
  redirect("/");
}
