const DATA_BUFFER_TARGET_SIZE = 10;
const ENABLE_DEBUG_LOGGING = false;

import {MP4PullDemuxer} from "./mp4_pull_demuxer.js";

function debugLog(msg) {
  if (!ENABLE_DEBUG_LOGGING)
    return;

  console.debug(msg);
}

export class AudioRenderer {
  async initialize(fileUri) {
    this.dataBuffer = [];
    this.fillInProgress = false;
    this.lastRenderedMediaTimestamp = 0;

    this.demuxer = new MP4PullDemuxer(fileUri);

    let trackInfo = await this.demuxer.getAudioTrackInfo();
    this.demuxer.selectAudio();

    this.decoder = new AudioDecoder({
      output: this.bufferAudioData.bind(this),
      error: e => console.error(e),
    });
    const config = {
      codec: trackInfo.codec,
      sampleRate: trackInfo.sampleRate,
      numberOfChannels: trackInfo.numberOfChannels,
      description: trackInfo.extradata
    };
    console.assert(AudioDecoder.isConfigSupported(config))
    this.decoder.configure(config);

    this.init_resolver = null;
    let promise = new Promise((resolver) => this.init_resolver = resolver);

    this.fillDataBuffer();
    return promise;
  }

  startPlaying() {
    this.fakeRendering();
  }

  // TODO(padenot): Replace this with calls to render() timed as needed to keep
  // the AudioWorklet well fed.
  fakeRendering() {
    if (this.dataBuffer.length == 0) {
      console.warn('audio data underflow');
      window.setTimeout(this.fakeRendering.bind(this), 10);
      return;
    }

    let renderDurationMs = this.dataBuffer[0].duration / 1000;
    this.render();
    window.setTimeout(this.fakeRendering.bind(this), renderDurationMs);
  }

  render(timestamp) {
    if (this.dataBuffer.length == 0) {
      console.warn('audio render(): no data ');
      return;
    }

    // TODO(padenot): copy the AudioData samples to AudioWorklet and play out.
    let data = this.dataBuffer.shift();
    this.lastRenderedMediaTimestamp = data.timestamp;

    debugLog('audio render()ing %d', data.timestamp);

    this.fillDataBuffer();
  }

  getMediaTime() {
    return this.lastRenderedMediaTimestamp;
  }

  makeChunk(sample) {
    const type = sample.is_sync ? "key" : "delta";
    const pts_us = sample.cts * 1000000 / sample.timescale;
    const duration_us = sample.duration * 1000000 / sample.timescale;
    return new EncodedAudioChunk({
      type: type,
      timestamp: pts_us,
      duration: duration_us,
      data: sample.data
    });
  }

  async fillDataBuffer() {
    if (this.dataBuffer.length >= DATA_BUFFER_TARGET_SIZE) {
      debugLog('AudioData buffer full');

      if (this.init_resolver) {
        this.init_resolver();
        this.init_resolver = null;
      }

      return;
    }

    // This method can be called from multiple places and we some may already
    // be awaiting a demuxer read (only one read allowed at a time).
    if (this.fillInProgress) {
      return false;
    }
    this.fillInProgress = true;

    while (this.dataBuffer.length < DATA_BUFFER_TARGET_SIZE &&
            this.decoder.decodeQueueSize < DATA_BUFFER_TARGET_SIZE) {
      let sample = await this.demuxer.readSample();
      this.decoder.decode(this.makeChunk(sample));
    }

    this.fillInProgress = false;

    // Give decoder a chance to work, see if we saturated the pipeline.
    window.setTimeout(this.fillDataBuffer.bind(this), 0);
  }

  bufferAudioData(data) {
    debugLog('bufferAudioData(%d)', data.timestamp);
    this.dataBuffer.push(data);
  }
}
