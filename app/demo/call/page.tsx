import { notFound } from "next/navigation";
import { PatientDemo } from "@/components/live/PatientDemo";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PatientDemo />;
}
