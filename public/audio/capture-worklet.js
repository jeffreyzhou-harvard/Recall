/* Audio never reaches the speakers. The page decides when a listening turn may collect samples. */
class RecallCapture extends AudioWorkletProcessor {
  process(inputs) {
    const mono = inputs[0]?.[0];
    if (mono) this.port.postMessage(new Float32Array(mono));
    return true;
  }
}
registerProcessor("recall-capture", RecallCapture);
