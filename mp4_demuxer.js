const DEMUX_STOP_SECS = 30; // 30 seconds

class MP4Source {
  constructor(uri) {
    this.file = MP4Box.createFile();
    this.file.onError = console.error.bind(console);
    this.file.onReady = this.onReady.bind(this);
    this.file.onSamples = this.onSamples.bind(this);

    console.log('fetching file');
    fetch(uri).then(response => {
      console.log('fetch done');
      const reader = response.body.getReader();
      let offset = 0;
      let mp4File = this.file;

      function appendBuffers({done, value}) {
        if(done) {
          mp4File.flush();
          return;
        }

        let buf = value.buffer;
        buf.fileStart = offset;

        offset += buf.byteLength;

        mp4File.appendBuffer(buf);

        return reader.read().then(appendBuffers);
      }

      return reader.read().then(appendBuffers);
    })

    this.info = null;
    this._info_resolver = null;
  }

  onReady(info) {
    // TODO: Generate configuration changes.
    this.info = info;

    if (this._info_resolver) {
      this._info_resolver(info);
      this._info_resolver = null;
    }
  }

  getInfo() {
    if (this.info)
      return Promise.resolve(this.info);

    return new Promise((resolver) => { this._info_resolver = resolver; });
  }

  getAvccBox() {
    // TODO: make sure this is coming from the right track.
    return this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC
  }

  start(time, track, onChunk) {
    if (!this.stopped)
      this.stop();
    this.stopped = false;

    this._onChunk = onChunk;

    this.file.setExtractionOptions(track.id);
    // seek seems to always go to the key frame before time, so + 1 to ensure we get exactly the frame
    this.file.seek(/* time in sec */ (time + 1) / 1000000, /* useRap */ true);
    this.file.start();
  }

  stop() {
    this.file.stop();
    this.stopped = true;
  }

  onSamples(track_id, ref, samples) {
    for (const sample of samples) {
      const pts_secs = sample.cts / sample.timescale;
      const type = sample.is_sync ? "key" : "delta";

      const chunk = new EncodedVideoChunk({
        type: type,
        timestamp: pts_secs * 1000000,
        duration: sample.duration,
        data: sample.data
      });

      this._onChunk(chunk);

      if (this.stopped)
        return;
    }
  }
}

class Writer {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.idx = 0;
    this.size = size;
  }

  getData() {
    if(this.idx != this.size)
      throw "Mismatch between size reserved and sized used"

    return this.data.slice(0, this.idx);
  }

  writeUint8(value) {
    this.data.set([value], this.idx);
    this.idx++;
  }

  writeUint16(value) {
    // TODO: find a more elegant solution to endianess.
    var arr = new Uint16Array(1);
    arr[0] = value;
    var buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[1], buffer[0]], this.idx);
    this.idx +=2;
  }

  writeUint8Array(value) {
    this.data.set(value, this.idx);
    this.idx += value.length;
  }
}

export class MP4Demuxer {
  constructor(uri) {
    this.source = new MP4Source(uri);
  }

  getAvcDescription(avccBox) {
    var i;
    var size = 7;
    for (i = 0; i < avccBox.SPS.length; i++) {
      // nalu length is encoded as a uint16.
      size+= 2 + avccBox.SPS[i].length;
    }
    for (i = 0; i < avccBox.PPS.length; i++) {
      // nalu length is encoded as a uint16.
      size+= 2 + avccBox.PPS[i].length;
    }

    var writer = new Writer(size);

    writer.writeUint8(avccBox.configurationVersion);
    writer.writeUint8(avccBox.AVCProfileIndication);
    writer.writeUint8(avccBox.profile_compatibility);
    writer.writeUint8(avccBox.AVCLevelIndication);
    writer.writeUint8(avccBox.lengthSizeMinusOne + (63<<2));

    writer.writeUint8(avccBox.nb_SPS_nalus + (7<<5));
    for (i = 0; i < avccBox.SPS.length; i++) {
      writer.writeUint16(avccBox.SPS[i].length);
      writer.writeUint8Array(avccBox.SPS[i].nalu);
      window.temp = avccBox.SPS[i].nalu;
    }

    writer.writeUint8(avccBox.nb_PPS_nalus);
    for (i = 0; i < avccBox.PPS.length; i++) {
      writer.writeUint16(avccBox.PPS[i].length);
      writer.writeUint8Array(avccBox.PPS[i].nalu);
    }

    return writer.getData();
  }

  async ready() {
    let info = await this.source.getInfo();
    this.videoTrack = info.videoTracks[0];
    this.audioTrack = info.audioTracks[0];
  }

  async getVideoTrackInfo() {
    await this.ready();

    let config = {
      codec: this.videoTrack.codec,
      displayWidth: this.videoTrack.track_width,
      displayHeight: this.videoTrack.track_height,
      extradata: this.getAvcDescription(this.source.getAvccBox())
    }

    return Promise.resolve(config);
  }

  demuxVideo(time, onChunk) {
    this.source.start(time, this.videoTrack, onChunk);
  }

  stop() {
    console.log('stopping');
    this.source.stop();
  }
}
