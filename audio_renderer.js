const DATA_BUFFER_TARGET_DURATION = 0.6;
const DECODER_QUEUE_SIZE_MAX = 5;
const ENABLE_DEBUG_LOGGING = false;

import { MP4PullDemuxer } from "./mp4_pull_demuxer.js";
import { RingBuffer } from "./ringbuf.js";

function debugLog(msg) {
  if (!ENABLE_DEBUG_LOGGING) {
    return;
  }

  console.debug(msg);
}

function URLFromFiles(files) {
  const promises = files.map(file =>
    fetch(file).then(response => response.text())
  );

  return Promise.all(promises).then(texts => {
    const text = texts.join("");
    const blob = new Blob([text], { type: "application/javascript" });

    return URL.createObjectURL(blob);
  });
}

export class AudioRenderer {
  async initialize(fileUri) {
    this.fillInProgress = false;

    this.demuxer = new MP4PullDemuxer(fileUri);

    let trackInfo = await this.demuxer.getAudioTrackInfo();
    this.demuxer.selectAudio();

    this.decoder = new AudioDecoder({
      output: this.bufferAudioData.bind(this),
      error: e => console.error(e)
    });
    const config = {
      codec: trackInfo.codec,
      sampleRate: trackInfo.sampleRate,
      numberOfChannels: trackInfo.numberOfChannels,
      description: trackInfo.extradata
    };
    this.sampleRate = trackInfo.sampleRate;
    this.channelCount = trackInfo.sampleRate;

    debugLog(config);

    console.assert(AudioDecoder.isConfigSupported(config));
    this.decoder.configure(config);

    // Initialize the AudioWorkletProcessor
    this.audioContext = new AudioContext({ sampleRate: trackInfo.sampleRate, latencyHint: "playback" });
    this.audioContext.suspend();
    // Initialize the ring buffer between the decoder and the real-time audio
    // rendering thread. The AudioRenderer has buffer space for approximately
    // 200ms of decoded audio ahead, but targets 100ms.
    let sampleCountIn500ms =
      0.5 * this.audioContext.sampleRate * trackInfo.numberOfChannels;
    let sab = RingBuffer.getStorageForCapacity(
      sampleCountIn500ms,
      Float32Array
    );
    this.ringbuffer = new RingBuffer(sab, Float32Array);

    // Get an instance of the AudioSink worklet, passing it the memory for a
    // ringbuffer, connect it to a GainNode for volume. This GainNode is in
    // turn connected to the destination.
    var workletSource = await URLFromFiles(["ringbuf.js", "audiosink.js"]);
    await this.audioContext.audioWorklet.addModule(workletSource);
    this.audioSink = new AudioWorkletNode(this.audioContext, "AudioSink", {
      processorOptions: { sab: sab },
      channelCount: trackInfo.numberOfChannels
    });
    this.volume = new GainNode(this.audioContext);
    this.audioSink.connect(this.volume).connect(this.audioContext.destination);

    this.init_resolver = null;
    let promise = new Promise(resolver => (this.init_resolver = resolver));

    this.fillDataBuffer();
    return promise;
  }

  setVolume(volume) {
    if (volume < 0.0 && volume > 1.0) {
      return;
    }
    // Smooth exponential volume ramps on change
    this.volume.gain.setTargetAtTime(
      volume,
      this.audioContext.currentTime,
      0.3
    );
  }

  play() {
    // resolves when audio has effectively started: this can take some time if using
    // bluetooth, for example.
    debugLog("playback start");
    return this.audioContext.resume();
  }

  pause() {
    // resolves when audio has effectively stopped, this can take some time if using
    // bluetooth, for example.
    debugLog("playback stop");
    return this.audioContext.suspend();
  }

  getMediaTime() {
    let totalOutputLatency = 0.0;
    if (this.audioContext.outputLatency == undefined) {
      // Put appropriate values for Chromium here, not sure what latencies are
      // used. Likely OS-dependent, certainly hardware dependant. Assume 40ms.
      totalOutputLatency += 0.04;
    } else {
      totalOutputLatency += this.audioContext.outputLatency;
    }
    // This looks supported by Chromium, always 128 / samplerate.
    totalOutputLatency += this.audioContext.baseLatency;
    // The currently rendered audio sample is the current time of the
    // AudioContext, offset by the total output latency, that is composed of
    // the internal buffering of the AudioContext (e.g., double buffering), and
    // the inherent latency of the audio playback system: OS buffering,
    // hardware buffering, etc. This starts out negative, because it takes some
    // time to buffer, and crosses zero as the first audio sample is produced
    // by the audio output device.
    let time = Math.max(
      this.audioContext.currentTime - totalOutputLatency,
      0.0
    );
    return time * 1000 * 1000; // microseconds
  }

  makeChunk(sample) {
    const type = sample.is_sync ? "key" : "delta";
    const pts_us = (sample.cts * 1000000) / sample.timescale;
    const duration_us = (sample.duration * 1000000) / sample.timescale;
    return new EncodedAudioChunk({
      type: type,
      timestamp: pts_us,
      duration: duration_us,
      data: sample.data
    });
  }

  // Returned the duration of audio that can be enqueued in the ring buffer.
  availableWrite() {
    return this.ringbuffer.available_write() / this.sampleRate;
  }

  async fillDataBuffer() {
    let inBuffer = this.availableWrite();
    if (inBuffer < DATA_BUFFER_TARGET_DURATION ||
        this.decoder.decodeQueueSize > DECODER_QUEUE_SIZE_MAX) {
      // Check back later
      window.setTimeout(this.fillDataBuffer.bind(this), 10);
      debugLog(
        `audio buffer full (target : ${DATA_BUFFER_TARGET_DURATION}, current: ${inBuffer}), delaying decode`
      );
      return;
    }
    if (this.init_resolver) {
      this.init_resolver();
      this.init_resolver = null;
    }

    // This method can be called from multiple places and we some may already
    // be awaiting a demuxer read (only one read allowed at a time).
    if (this.fillInProgress) {
      return false;
    }
    this.fillInProgress = true;

    // Decode up to the buffering target
    while (this.availableWrite() > DATA_BUFFER_TARGET_DURATION &&
      this.decoder.decodeQueueSize < DECODER_QUEUE_SIZE_MAX) {
      let sample = await this.demuxer.readSample();
      this.decoder.decode(this.makeChunk(sample));
    }

    this.fillInProgress = false;

    // Give decoder a chance to work, see if we saturated the pipeline.
    window.setTimeout(this.fillDataBuffer.bind(this), 0);
  }

  bufferHealth() {
    return (1 - this.ringbuffer.available_write() / this.ringbuffer.capacity()) * 100;
  }

  bufferAudioData(data) {
    debugLog("bufferAudioData(%d)", data.timestamp);
    // Write the data to the ring buffer. Because it wraps around, there is
    // potentially two copyTo to do.
    this.ringbuffer.writeCallback(data.numberOfFrames, function(first_part, second_part) {
      data.copyTo(first_part, {
        planeIndex:0, frameCount: first_part.length
      });
      if (second_part.byteLength) {
        data.copyTo(second_part, {
          planeIndex:0, frameOffset: first_part.length
        })
      }
    });
  }
}
