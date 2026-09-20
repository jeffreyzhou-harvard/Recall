export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
    const state = globalThis as unknown as {
      circleReminderTimer?: ReturnType<typeof setInterval>;
      circleReminderBusy?: boolean;
    };
    if (!state.circleReminderTimer) {
      const { tickCircleReminders } = await import("./server/circle/messages");
      state.circleReminderTimer = setInterval(() => {
        if (state.circleReminderBusy) return;
        state.circleReminderBusy = true;
        void tickCircleReminders()
          .catch(() => {})
          .finally(() => {
            state.circleReminderBusy = false;
          });
      }, 60_000);
      state.circleReminderTimer.unref();
    }
  }
}
