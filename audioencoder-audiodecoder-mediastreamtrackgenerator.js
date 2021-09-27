async function main() {
  const ac = new AudioContext({
    sampleRate: 22050,
    latencyHint: 0,
  });
  const osc = new OscillatorNode(ac, { 
    frequency: 0, channelCount: 1,
    channelCount: 1, 
    channelCountMode: 'explicit', 
    channelInterpretation: 'discrete'
  });
  const msd = new MediaStreamAudioDestinationNode(ac, {
    channelCount: 1, 
    channelCountMode: 'explicit', 
    channelInterpretation: 'discrete'
  });
  const { stream } = msd;
  const [track] = stream.getAudioTracks();
  const processor = new MediaStreamTrackProcessor({ track });
  const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
  const { writable } = generator;
  const { readable } = processor;
  const audioWriter = writable.getWriter();
  const mediaStream = new MediaStream([generator]);
  const audio = document.querySelector('audio');
  const total = document.getElementById('total');
  const button = document.querySelector('button');
  const config = {
    numberOfChannels: 1,
    sampleRate: 22050,
    codec: 'opus',
    bitrate: 16000,
  };
  const encoder = new AudioEncoder({
    error(e) {
      console.error(e);
    },
    output(chunk, metadata) {
      if (metadata.decoderConfig) {
        decoder.configure(metadata.decoderConfig);
        console.log({ metadata });
      }
      total_encoded_size += chunk.byteLength;
      total.textContent = 'Total encoded size: ' + total_encoded_size;
      decoder.decode(chunk);
    },
  });
  encoder.configure(config);
  const decoder = new AudioDecoder({
    error(e) {
      console.error(e);
    },
    async output(frame) {
      await audioWriter.write(frame);
    },
  });
  audio.onpause = audio.onplay = audio.srcObject = null;
  audio.srcObject = mediaStream;
  let paused = false;
  let paused_timer = 0;
  let paused_time = 0;
  audio.onpause = () => {
    if (paused === false) {
      paused = true;
    }
    if (audio.currentTime > 0) {
      paused_timer = performance.now();
    }
    if (generator.readyState === 'ended') {
      button.disabled = false;
      button.textContent = button.textContent.slice(0, -3);
    }
  };
  audio.onplay = () => {
    if (paused) {
      paused_time += performance.now() - paused_timer;
    }
    if (audio.currentTime === 0) {
      button.disabled = true;
      button.textContent = button.textContent + 'ing';
    }
  };
  osc.connect(msd);
  osc.start();
  let music_buffer;
  let raw_music_wav = await fetch(
    './ImperialMarch60.webm?=' + new Date().getTime()
  );
  if (!music_buffer)
    music_buffer = await ac.decodeAudioData(await raw_music_wav.arrayBuffer());
  let i = 0;
  let total_encoded_size = 0;
  let duration = 0;
  let floats = music_buffer.getChannelData(0);
  try {
    await readable.pipeTo(
      new WritableStream({
        async write(value) {
          const { timestamp } = value;
          if (i < floats.length) {
            let data = new Float32Array(220);
            data.set(floats.subarray(i, i + 220));
            i += 220;
            const ad = new AudioData({
              timestamp,
              data,
              numberOfChannels: 1,
              numberOfFrames: 220,
              sampleRate: 22050,
              format: 'f32-planar',
            });
            duration += ad.duration;
            encoder.encode(ad);
          } else {
            try {
              if (paused === false) {
                // play entire duration, Chromium ends track prematurely
                // when audio is not paused with controls
                // audio.currentTime should not be less than duration
                await new Promise((resolve) =>
                  setTimeout(
                    resolve,
                    (duration / 10 ** 6 - audio.currentTime) * 1000
                  )
                );
              }
              await encoder.flush();
              await decoder.flush();
              await audioWriter.close();
              osc.stop();
              track.stop();
              generator.stop();
              await audioWriter.closed;
              return audioWriter.releaseLock();
            } catch (err) {
              throw err;
            }
          }
        },
        abort(e) {
          console.log(e);
        },
      })
    );
    const { currentTime } = audio;
    console.log(
      'Done encoding, decoding, streaming audio.',
      { duration, currentTime, pausedTime: paused_time / 1000 },
      currentTime + paused_time / 1000
    );
    button.disabled = false;
    button.textContent = button.textContent.slice(0, -3);

    await ac.close();
  } catch (err) {
    console.error(err);
  }
}
