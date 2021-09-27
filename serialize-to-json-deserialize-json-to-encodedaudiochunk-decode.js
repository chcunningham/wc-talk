// https://github.com/higuma/wav-audio-encoder-js
class WavAudioEncoder {
  constructor({ buffers, sampleRate, numberOfChannels }) {
    Object.assign(this, {
      buffers,
      sampleRate,
      numberOfChannels,
      numberOfSamples: 0,
      dataViews: [],
    });
  }
  setString(view, offset, str) {
    const len = str.length;
    for (let i = 0; i < len; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  async encode() {
    const [{ length }] = this.buffers;
    const data = new DataView(
      new ArrayBuffer(length * this.numberOfChannels * 2)
    );
    let offset = 0;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < this.numberOfChannels; ch++) {
        let x = this.buffers[ch][i] * 0x7fff;
        data.setInt16(
          offset,
          x < 0 ? Math.max(x, -0x8000) : Math.min(x, 0x7fff),
          true
        );
        offset += 2;
      }
    }
    this.dataViews.push(data);
    this.numberOfSamples += length;
    const dataSize = this.numberOfChannels * this.numberOfSamples * 2;
    const view = new DataView(new ArrayBuffer(44));
    this.setString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.setString(view, 8, 'WAVE');
    this.setString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, this.numberOfChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 4, true);
    view.setUint16(32, this.numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    this.setString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    this.dataViews.unshift(view);
    return new Blob(this.dataViews, { type: 'audio/wav' }).arrayBuffer();
  }
}

async function main() {
  const ac = new AudioContext({
    sampleRate: 22050,
    latencyHint: 0,
  });
  await ac.suspend();
  const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
  const { writable } = generator;
  const mediaStream = new MediaStream([generator]);
  generator.onmute = generator.onunmute = (e) => console.log(e.type); // never fired
  const audio = document.querySelector('audio');
  audio.srcObject = mediaStream;
  const encoded = [];
  const TARGET_FRAME_SIZE = 220;
  const TARGET_SAMPLE_RATE = 22050;
  let base_time = 0;
  let output_base_time = 0;
  let channelData = [];
  let encoded_audio_chunk_length = 0;
  let decoded_audio_chunk_length = 0;
  let music_buffer;
  let decoderController = void 0;
  const decoderStream = new ReadableStream({
    start(c) {
      return (decoderController = c);
    },
  });
  const decoderReader = decoderStream.getReader();
  let decoderResolve = void 0;
  let decoderPromise = new Promise((_) => (decoderResolve = _));
  let encoderResolve = void 0;
  let encoderPromise = new Promise((_) => (encoderResolve = _));
  const encoder = new AudioEncoder({
    error(e) {
      console.log(e);
    },
    async output(chunk, metadata) {
      if (metadata.decoderConfig) {
        metadata.decoderConfig.description = bytesArrToBase64(
          new Uint8Array(metadata.decoderConfig.description)
        );
        console.log(metadata, chunk.timestamp);
        encoded.push(metadata);
      }
      const { type, timestamp, byteLength, duration } = chunk;
      const ab = new ArrayBuffer(byteLength);
      chunk.copyTo(ab, { planeIndex: 0 });
      const data = bytesArrToBase64(new Uint8Array(ab));
      const serialized = [
        /* type, */ timestamp,
        /* byteLength, */ duration,
        data,
      ];
      encoded.push(serialized);
      if (
        encoded.length >=
        ~~((~~(floats.length / 220) / ~~music_buffer.duration) * 10) - 1
      ) {
        encoderResolve();
      }
    },
  });
  const config = {
    numberOfChannels: 1,
    sampleRate: 22050, // Chrome hardcodes to 48000
    codec: 'opus',
    bitrate: 16000,
  };
  encoder.configure(config);
  const decoder = new AudioDecoder({
    error(e) {
      console.error(e);
    },
    async output(frame) {
      const { duration, numberOfChannels, numberOfFrames, sampleRate } = frame;
      const size = frame.allocationSize({ planeIndex: 0 });
      const data = new ArrayBuffer(size);
      frame.copyTo(data, { planeIndex: 0 });
      const wav = new WavAudioEncoder({
        sampleRate: 48000,
        numberOfChannels: 1,
        buffers: [new Float32Array(data)],
      });
      const ab = (await ac.decodeAudioData(await wav.encode())).getChannelData(0);
      let i = 0;
      // resample to 22050
      for (; i < ab.length; i++) {
        if (channelData.length === TARGET_FRAME_SIZE) {
          const floats = new Float32Array(
            channelData.splice(0, TARGET_FRAME_SIZE)
          );
          decoderController.enqueue(floats);
          desiredSize = decoderController.desiredSize;
        }
        channelData.push(ab[i]);
      }
      decoded_audio_chunk_length++;
      if (decoded_audio_chunk_length === encoded_audio_chunk_length) {
        if (channelData.length) {
          const floats = new Float32Array(channelData.length);
          floats.set(channelData.splice(0, channelData.length));
          decoderController.enqueue(floats);
          decoderController.close();
          decoderResolve();
        }
      }
    },
  });
  let raw_music_wav = await fetch('./ImperialMarch60.webm');
  if (!music_buffer) {
    music_buffer = await ac.decodeAudioData(await raw_music_wav.arrayBuffer());
  }
  let floats = music_buffer.getChannelData(0);
  console.log(~~((~~(floats.length / 220) / ~~music_buffer.duration) * 10));
  for (let i = 0; i < floats.length; i += 220) {
    // avoid filling with 0's which impacts duration accuracy
    const len = i + 220 > floats.length ? floats.length - i : 0;
    const data = new Float32Array(len || 220);
    data.set(floats.subarray(i, i + (len || 220)));
    const ad = new AudioData({
      timestamp: base_time * 10 ** 6,
      data,
      numberOfChannels: 1,
      numberOfFrames: data.length,
      sampleRate: 22050,
      format: 'f32',
    });
    base_time += ad.duration;
    encoder.encode(ad);
  }
  await encoder.flush();
  await encoderPromise;
  console.assert(encoded.length > 0, encoded.length);
  console.log(JSON.stringify(encoded, null, 2), encoded.length);
  const metadata = encoded.shift();
  metadata.decoderConfig.description = new Uint8Array(
    base64ToBytesArr(metadata.decoderConfig.description)
  ).buffer;
  console.log(await AudioEncoder.isConfigSupported(metadata.decoderConfig));
  decoder.configure(metadata.decoderConfig);
  encoded_audio_chunk_length = encoded.length;
  while (encoded.length) {
    const chunk = encoded.shift();
    let [/* type, */ timestamp, /* byteLength, */ duration, data] = chunk;
    data = new Uint8Array(base64ToBytesArr(data)).buffer;
    const eac = new EncodedAudioChunk({
      type: 'key',
      timestamp,
      duration,
      data,
    });
    decoder.decode(eac);
  }
  await decoder.flush();
  await decoderPromise;
  const osc = new OscillatorNode(ac, { frequency: 0 });
  const msd = new MediaStreamAudioDestinationNode(ac, {
    channelCount: 1,
  });
  const [track] = msd.stream.getAudioTracks();
  osc.connect(msd);
  osc.start();
  const processor = new MediaStreamTrackProcessor({
    track,
  });
  const { readable } = processor;
  await ac.resume();
  await readable
    .pipeThrough(
      new TransformStream({
        async transform(chunk, controller) {
          const { timestamp } = chunk;
          const { value: floats, done } = await decoderReader.read();
          if (done) {
            console.log({ done });
            osc.stop();
            track.stop();
            if (generator.readyState !== 'ended') {
              generator.stop();
            }
            await ac.close();
            controller.terminate();
          }
          const ad = new AudioData({
            timestamp,
            data: floats,
            numberOfChannels: 1,
            numberOfFrames: floats.length,
            sampleRate: 22050,
            format: 'f32',
          });
          output_base_time += ad.duration;
          controller.enqueue(ad);
        },
        flush() {
          console.log('flush');
        },
      })
    )
    .pipeTo(writable);
  console.log('Done, encoding, decoding, resampling, streaming media.');
  console.log(
    `audio.currentTime: ${audio.currentTime}, music_buffer.duration: ${
      music_buffer.duration
    }, base_time / 10**6: ${base_time / 10 ** 6}`
  );
}
