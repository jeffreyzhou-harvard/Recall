import { AccessGate } from "@/components/live/AccessGate";
import { ContinueToAccount, WelcomeLayout } from "@/components/live/Welcome";

export default function SignInPage() {
  return <WelcomeLayout wide><AccessGate anyRole><ContinueToAccount /></AccessGate></WelcomeLayout>;
}
