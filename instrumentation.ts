/** The live web call requires a long-lived Node process; the judged presentation never starts this worker. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
