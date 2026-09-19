/**
 * The one way Relay ever reaches out to family (AGENTS.md rules 5 and 15): a
 * fixed-text safety alert to the designated caregivers, through the channel
 * chosen in the joint setup.
 *
 * The interface carries no free text. An alert is a category, a time, and who
 * it is for; the words come from /fixtures/safety-phrases.json. There is no
 * field in which her words, or audio, could travel.
 */
export interface SafetyAlert {
  alert_id: string;
  script_id: string;
  category: string;
  at: string;
  caregiver_id: string;
  channel: string;
  text: string;
}

export interface AlertChannel {
  send(alert: SafetyAlert): Promise<void>;
}

/** Holds alerts for the designated caregiver's dashboard card. The judged path and the tests use this. */
export class MemoryAlertChannel implements AlertChannel {
  private readonly alerts: SafetyAlert[] = [];

  async send(alert: SafetyAlert): Promise<void> {
    this.alerts.push(structuredClone(alert));
  }

  /** What one caregiver's alert card shows. Nobody else can be handed an alert: there is no unfiltered read. */
  sentTo(caregiverId: string): SafetyAlert[] {
    return structuredClone(this.alerts.filter((a) => a.caregiver_id === caregiverId));
  }

  count(): number {
    return this.alerts.length;
  }
}
