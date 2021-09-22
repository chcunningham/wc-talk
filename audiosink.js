registerProcessor("AudioSink", class AudioSink extends AudioWorkletProcessor {
  constructor(options) {
    super();
    let sab = options.processorOptions.sab;
    this.consumerSide = new RingBuffer(sab, Float32Array);
  }
  process(inputs, outputs, params) {
    // Assuming mono for now
    var available_read = this.consumerSide.available_read();
    if (this.consumerSide.pop(outputs[0][0]) != 128)  {
      console.log("Warning: audio underrun");
    }
    return true;
  }
});
