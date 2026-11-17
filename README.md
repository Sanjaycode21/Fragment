# Fragment

Fragment trims, captions, and exports local video in the browser.

```sh
npm ci
npm run dev
```

Import a video or use **Auto clip** to paste a link. Fragment scans the audio for standout moments, selects a suggested range, and generates captions for that range. Suggestions are based on audio cues. Short videos without a standout peak can be captioned in full. The first caption job downloads the Whisper model, which can be reused from the browser cache. Edit the range or cues, then select **Export MP4** to render the captioned clip. Downloadable SRT and VTT cues use clip-relative timing.

Link import uses yt-dlp and FFmpeg on the local computer. Install both before using the link workflow.

```sh
python -m pip install --user -U "yt-dlp[default]" imageio-ffmpeg
```

Use `python3` on systems where that is the Python executable. `FRAGMENT_PYTHON` can override the executable used by Fragment. The link workflow requires the local Vite server. For accessible YouTube, Instagram, and TikTok video URLs, Fragment prefers an audio-only stream for highlight detection and requests only the selected video range. The local size limit applies to the audio and the resulting segment individually. Use links you have permission to process. Platform access can vary by video and network. The optional YouTube preview can still play transcript-based suggestions.

Automatic captions use English speech recognition and phrase-level timestamps. The app runs the [ONNX conversion of Whisper Tiny](https://huggingface.co/onnx-community/whisper-tiny) in a worker using Transformers.js and ONNX Runtime Web. [Whisper's original weights are MIT-licensed](https://github.com/openai/whisper#license). The worker uses WebGPU on supported devices and falls back to CPU with WebAssembly. Audio and video stay on the device.

Run on localhost or HTTPS. MP4 export requires a browser with compatible WebCodecs decoders and H.264 and AAC encoders. The app uses system fonts and browser glyph fallback in both preview and export.

`npm test` checks clip-relative timing, subtitle formatting, and output dimensions. `npm run build` produces static assets in `dist/`. Use `npm run preview` locally to include the link import service with those assets.
