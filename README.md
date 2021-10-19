# WebCodecs Samples

This repo contains 2 samples using [WebCodecs](https://w3c.github.io/webcodecs/). 
These were presented at the IIT WebRTC 2021 conference (TODO: track down the recording). 

**rapid_video_painter.html** 

Demuxes a video mp4, decodes, and renders the `VideoFrames` to a `Canvas` ASAP.

**simple_video_player.html** 

Demxues both audio and video mp4s, decodes them, and renders both with a/v synchrnoization using `Canvas` and `AudioWorklet`.

*NOTE:* The simple video player [requires cross origin isolation](https://web.dev/cross-origin-isolation-guide/) to use `SharedArrayBuffer`. Regrettably, I haven't found time yet to setup a server with the appropritate headers. Please use `node server.js` to play this sample locally. 
