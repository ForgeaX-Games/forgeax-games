/**
 * Built-in voice track — independent from state DataChannel.
 * Stub: tracks mute flag only; real path = WebRTC audio transceiver.
 */
export class VoiceChannel {
  enabled = true;
  muted = false;

  async start(): Promise<void> {
    this.enabled = true;
  }

  async stop(): Promise<void> {
    this.enabled = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}
