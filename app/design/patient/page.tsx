import { redirect } from "next/navigation";

/** Keep the earlier review link useful after the recall product update. */
export default function PatientDesignReview() {
  redirect("/design/recall");
}
