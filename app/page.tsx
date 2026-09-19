import Link from "next/link";

/** Scaffold only. The real surfaces are designed later with the Impeccable skill. */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Recall</h1>
      <p className="mt-3 text-lg">Access changed. Authorship didn&apos;t.</p>
      <p className="mt-8">
        The interface has not been designed yet. The engine underneath it runs:{" "}
        <Link className="underline" href="/present">
          open the judged-path check
        </Link>
        .
      </p>
    </main>
  );
}
