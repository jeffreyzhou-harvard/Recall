import { notFound } from "next/navigation";
import { PhotoRemember } from "@/components/circle/PhotoRemember";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PhotoRemember sample />;
}
