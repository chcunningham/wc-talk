# These samples are stale!

Much better samples (including these with numerous improvements) can be found at https://github.com/w3c/webcodecs/tree/main/samples

The samples in this repro are no longer maintained. I'm leaving it around just as a trail of breadcrumbs since this repo was mentioned in a few presentations.

# Original WebCodecs Presenation Samples

This repo contains 2 samples using [WebCodecs](https://w3c.github.io/webcodecs/). These were presented at the IIT WebRTC 2021 conference ([presentation recording](https://www.youtube.com/watch?v=U8T5U8sN5d4)).

## rapid_video_painter.html ([live demo](https://wc-talk.netlify.app/rapid_video_painter.html))

Demuxes a video mp4, decodes, and renders the `VideoFrames` to a `Canvas` ASAP.

## simple_video_player.html ([live demo](https://wc-talk.netlify.app/simple_video_player.html))

Demxues both audio and video mp4s, decodes them, and renders both with a/v synchrnoization using `Canvas` and `AudioWorklet`.

*NOTE:* The simple video player [requires cross origin isolation](https://web.dev/cross-origin-isolation-guide/) to use `SharedArrayBuffer`. In addition to the live demo link above, you may use `node server.js` to play this sample locally. 
