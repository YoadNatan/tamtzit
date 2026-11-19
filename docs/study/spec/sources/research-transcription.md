# Research: transcribing 2-hour Hebrew medical lectures

This covers how a recording becomes text, and how that text becomes "מההקלטה" notes in each summary part. Sources are in §3. **Unverified** marks what I could not check. Claude takes no audio, so speech-to-text must come first.

## 1. Recommendation

### Build now, with no new paid provider

1. **Transcript import, first.** It is the smallest piece and works on every phone.
   - "הוספת הקלטה" on the lecture page accepts `.vtt` (Zoom, YouTube), `.srt`, `.sbv` (YouTube), `.txt` with or without times, or pasted text.
   - A tested prototype parser is in `spec/transcription-proto/` (`node transcript.test.ts` passes).
2. **In-browser transcription on a computer.** The audio never leaves the device.
   - **Library:** `@huggingface/transformers` **4.3.2**, pinned exactly. It is the latest release (2026-10-27) and pulls `onnxruntime-web` 1.31.0-dev.20260914-8d85527a0.
   - **Model:** `ivrit-ai/whisper-large-v3-turbo-onnx` at revision `edb17b6b65f60a299d4b620d043e15b60321e5ff`. It is ivrit.ai's ONNX export of its Hebrew turbo fine-tune, in transformers.js layout. It has no model card (§4).
   - **Loading:** `device: "webgpu"`, `dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }`, as the webml-community turbo WebGPU demo does.
   - **Each call:** `language: "hebrew"`, `task: "transcribe"`, `return_timestamps: true`, `chunk_length_s: 30`, `stride_length_s: 5`.
   - **Download:** 1.61 GB once, then cached. If the `q4f16` files (563 MB) match its accuracy on a real clip, they become the default.
   - **Where:** with WebGPU (Chrome or Edge 144+, Safari 26 on macOS); "ניסיוני" on iOS 26 and Android Chrome (§4). Otherwise, import or the upgrade.
3. **Store text only.** It is saved block by block, so a closed tab resumes where it stopped (§2.3).
4. **"מההקלטה" notes.** A new edge function, `api/study/recording.ts`, writes one summary part's notes.
   - It follows `section.ts`, and its usage is counted by `assertBudget`.
   - It costs about $0.6-0.9 a lecture (§2.4) and runs only for lectures that have a recording.

### Optional upgrade, if Yoad adds a key (for phones and speed)

- **How it works:** the same browser pipeline posts 90-second WAV blocks (16 kHz, 16-bit mono, 2.9 MB, under Vercel's body limit) to a new `api/study/transcribe.ts`. That function forwards each block to the provider. Nothing is stored.
- **Which provider:**
  - **Soniox async:** best Hebrew in ivrit.ai's benchmark (4.8% WER on eval-d1). About $0.10 an hour, so about $0.20 a lecture.
  - **Groq `whisper-large-v3-turbo`:** $0.04 an hour, so $0.08 a lecture. But stock turbo scored 8.4% in the benchmark, against 5.3% for the fine-tune.
- **Not recommended:**
  - OpenAI: `gpt-4o-transcribe` has no timestamps, weaker Hebrew, and costs $0.006 a minute.
  - Google: 21.1% WER.
  - A self-hosted ivrit.ai model on RunPod: cheap, but a Docker endpoint to maintain.
- **Budget:** the provider's charge is stored in USD and counted against the same `STUDY_MONTHLY_USD`.

### Before shipping

- **University policy:** Yoad checks BGU's policy on recording and transcribing lectures. The sheet asks the uploader to confirm that the group may use the recording.
- **Privacy text (decision 13):** the audio stays on the device. The browser downloads the model from huggingface.co and the runtime from cdn.jsdelivr.net, sending them no lecture content. The transcript is kept in Supabase and sent to Anthropic for the notes. With the upgrade, the audio also passes through Vercel to the provider.

## 2. Pipeline

### 2.1 Import

- **Decoding:** UTF-8, with any BOM removed. If U+FFFD appears, retry with `TextDecoder("windows-1255")`, for older Hebrew SRT files (test this).
- **Format:** a `WEBVTT` header is VTT; `-->` lines are SRT; `h:mm:ss.mmm,h:mm:ss.mmm` is SBV; three or more lines starting with a time are timed text; anything else is plain text, with no time tags.
- **Clean-up:** drop cue numbers, NOTE and STYLE blocks, cue settings, tags (`<v>`, `<c>`, `<00:00:01.234>`), entities, direction marks, and lines repeating the previous line (YouTube's rolling captions).
- **Output:** segments `{s, e, t}`. The prompt gets lines of about 30 s: `[41:10] …`.

### 2.2 In-browser transcription

1. **Check:** `navigator.gpu`, `shader-f16` (transformers.js's own check), `navigator.storage.estimate()`, then `navigator.storage.persist()`.
2. **Decode:** `new AudioContext({sampleRate: 16000})` with `decodeAudioData`, as transformers.js's `load_audio` does. Downmix to mono and free the buffer.
   - Two hours take 16,000 × 7,200 × 4 B ≈ 461 MB per channel.
3. **Skip long silences** (RMS per second). This saves time and may prevent invented text (**unverified**).
4. **Five-minute blocks,** cut at the quietest second near each mark. Never pass two hours at once: with `chunk_length_s`, the pipeline computes every 30 s window's features (128 × 3,000 floats ≈ 1.5 MB) before decoding, about 550 MB for two hours.
5. **A module Web Worker,** loaded only when needed (like pdf.js). Segments come back offset by the block's start. `WhisperTextStreamer`'s callbacks (`on_chunk_end` gives each segment's end time) drive the progress bar and the live text.
6. **Save each block,** and update `done_s`. Through realtime, the group sees "תמלול: 40 מתוך 120 דקות".
7. **UI:** a download bar; audio minutes done of the total, with an estimate after the first block; the latest lines; "יש להשאיר את המסך פתוח" with a Screen Wake Lock; pause and cancel. Picking the same file again (name, size, length) resumes after the last saved block.
8. **No COOP/COEP headers:** COEP could break the cross-origin Storage images (**unverified**). Without it, the WASM runtime uses one thread; WebGPU does the work.

### 2.3 Storage (in `study-schema.sql`)

- **`study_recordings`:** one row per lecture (cascade delete), in the realtime publication: `source` (`file`, `browser`, `api`), `engine`, `source_name`, `duration_s`, `done_s`, `has_times`, `status` (`transcribing`, `ready`, `failed`), `usage` (provider USD), `created_by`, `updated_at`.
- **`study_transcript_blocks`:** `lecture_id`, `idx`, `start_s`, `end_s`, `segments jsonb`. Not in the publication, because the rows are large.
- **`study_recording_notes`:** `lecture_id`, part `idx`, `items jsonb`, `status`, `model`, `usage`, `error`, `updated_at`. It mirrors `study_sections` and is in the publication.
- **Access:** RLS through `study_is_member(study_lecture_group(lecture_id))`, with explicit column grants. Storage is unchanged.
- **Budget:** `assertBudget` also sums this month's usage in both new usage columns.

### 2.4 From transcript to "מההקלטה" notes

- **Calls:** `POST /api/study/recording {lectureId, idx}`, driven like `generate.ts` (first part alone to write the cache, then two at a time; server-side later, per decision 10). The call follows `section.ts`:

  ```ts
  anthropic().beta.messages.stream({
    model: MODEL, max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: RECORDING_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [deckBlock, { ...transcriptLines, cache_control: { type: "ephemeral" } }, partRequest] }],
  });
  ```

  The deck and transcript blocks are identical for every part, so parts 2 to n read them from the cache.
- **Each part's request:** its heading and slides; the other parts' ranges (remarks about their slides go to them, whole-lecture remarks such as exam scope to the last part); and its summary, with paragraphs numbered ¶n by a helper shared with `SummaryView`, so ¶n equals `data-blk`.
- **`RECORDING_SYSTEM` rules** (the summary's style sheet, plus):
  - Only what the lecturer added: explanations, examples, clinical stories, emphasis and exam remarks, scope ("לא למבחן"), slide corrections, mnemonics, answers to questions.
  - Nothing the summary says, nothing absent from the transcript; skip garbled passages; numbers only when clearly recognized.
  - Terms are spelled as on the slides. This repairs English terms written in Hebrew letters.
  - If the transcript and a slide conflict, state both and don't decide.
  - Gender-neutral passive voice ("בהרצאה הודגש"); no students' names; no small talk.
  - Output lines `¶n | טקסט | 41:10` (n = 0 means the end of the part), or `אין`.
- **Display:** the server checks each line (the paragraph exists; the time is inside the transcript). `SummaryView` renders each note as a "מההקלטה" box after its paragraph, as a sibling and never inside the `<p>`, so `data-blk` numbering and comment anchors stay put. A `[הקלטה 41:10]` tag lets a student jump there in the university's player. Add `[/^מההקלטה/, "callout callout-lecturer"]` to `CALLOUTS`.
- **Cost:** (S+D+T)·$5/M + (P−1)(S+D+T)·$0.20/M + P·U·$4/M + P·O·$20/M, at the Opus 5.5 prices of `usageCostUsd`.
  - With S = 1.5k, D = 12k, T = 40k, P = 8, U = 2.5k and O = 2.5k tokens: $0.27 + $0.07 + $0.08 + $0.40 ≈ **$0.82**.
  - Output dominates. Measure T with `messages.countTokens`.
- **Later:** a recording that arrives before the summary is written can join the summary's cached prefix (about +$0.3, after a quality round on the summary prompt). The same lines can feed "chat with the material".

### 2.5 Tests, with today's tools

- **SQL:** the schema runs twice; `study.sql` checks that a member reads and writes the new rows, the outsider (user 4) sees none and cannot insert, deleting a lecture cascades, and the budget counts the new usage.
- **Parser:** `node src/study/lib/transcript.test.ts`. Node 22.23 strips the types.
  - Fixtures: Zoom VTT, YouTube automatic VTT, SRT with BOM and CRLF, SBV, timed text, plain text, and a windows-1255 SRT.
- **Build:** `npm run build`.
- **E2E** (Playwright, mocked Supabase and Realtime):
  - Import a VTT.
  - Run the browser path with a fake recognizer swapped in by a test-build flag (huggingface.co and cdn.jsdelivr.net return 403 from this sandbox's proxy). Check progress, the wake lock and reload-and-resume.
  - Check that notes land under the right paragraphs and that comments keep their anchors.
- **Devices (Yoad):** a real 10-minute clip on a Chrome laptop, Safari 26 on a Mac, an iOS 26 iPhone and an Android phone. Record download time, audio minutes per minute, peak memory and 30 English terms; compare fp16/q4 with q4f16.
- **Quality of the notes:** Claude agents follow the exact prompt on the antiparasitics deck, its summary and a transcript. The transcript is a real one if available; otherwise a synthetic one with recognition errors, an exam remark, a slide contradiction and small talk. The rubric checks that every note is traceable to its time, nothing repeats the summary, terms follow the slides, no number is invented, conflicts are shown rather than settled, and the style rules are kept.

## 3. Evidence

### Hebrew accuracy

These are word error rates in %, lower is better, from ivrit.ai's [benchmark.csv](https://huggingface.co/spaces/ivrit-ai/hebrew-transcription-leaderboard/resolve/main/benchmark.csv). It is scored with jiwer; the datasets are listed in `src/about.py` of the same Space. The audio is general Hebrew (podcasts, WhatsApp, FLEURS). **None of it is medical, and none of it mixes in English.**

| Engine | eval-d1 | WhatsApp | SASpeech | FLEURS |
|---|---|---|---|---|
| ivrit-ai turbo (2025-05-13) | 5.3 | 7.1 | 6.6 | 18.1 |
| ivrit-ai large-v3 (2025-05-13) | 5.1 | 7.2 | 6.4 | 17.4 |
| stock large-v3-turbo | 8.4 | 12.8 | 10.4 | 28.9 |
| Soniox | 4.8 | 9.0 | 6.5 | 17.7 |
| Amazon batch | 6.6 | 10.4 | 8.5 | 23.0 |
| Deepgram nova-3 | 6.7 | 12.0 | 10.2 | 23.3 |
| OpenAI gpt-4o-transcribe | 7.3 | 12.6 | 10.9 | 21.0 |
| ElevenLabs scribe v1 | 20.0 | 26.4 | 6.8 | 18.1 |
| Google | 21.1 | 35.2 | 18.9 | 38.5 |
| zipformer2 66M | 5.3 | 8.8 | 6.4 | 23.4 |

There are no Hebrew figures for whisper tiny, base or small. I don't recommend them: stock turbo already makes about 60% more errors than the fine-tune (an inference, not a measurement).

### Models

Read through the Hugging Face API with WebFetch.

- **`ivrit-ai/whisper-large-v3-turbo-onnx`** ([files](https://huggingface.co/api/models/ivrit-ai/whisper-large-v3-turbo-onnx/tree/main?recursive=true)): encoder fp16 1,274,316,309 B and decoder-merged q4 334,046,098 B; the q4f16 pair is 369,947,784 B and 193,401,635 B. Created 2025-02-23, changed 2025-12-20, **no model card**. It has `<|he|>` = 50279 and 6 `alignment_heads`, and sits in ivrit.ai's "Start here: Hebrew speech-to-text" collection.
- **The [model card](https://huggingface.co/ivrit-ai/whisper-large-v3-turbo):** Apache-2.0; about 5,050 h of training audio, 4,700 h of it Knesset plenums. Language detection is degraded, so Hebrew must be set.
- **The `webml-community/whisper-large-v3-turbo-webgpu` worker** uses encoder fp16, decoder q4 and WebGPU.
- **The [dtypes guide](https://huggingface.co/docs/transformers.js/guides/dtypes):** Whisper is "extremely sensitive to quantization settings: especially of the encoder".
- **Stock models** (fp32 encoder with q4 decoder): whisper-small is about 586 MB and whisper-base about 206 MB.
- **[`ivrit-ai/zipformer2-66m-streaming-he`](https://huggingface.co/ivrit-ai/zipformer2-66m-streaming-he):** 72 MB in int8, and it runs on-device at live-transcribe.ivrit.ai. But its card says "English is weak (spelled letter by letter)", and it is not a transformers.js model. **Unsuitable** here.

### transformers.js 4.3.2

Read in the npm tarball (registry.npmjs.org is reachable from the sandbox):

- Without a language, `modeling_whisper.js` warns and uses English.
- `prompt_ids` is declared but not implemented, so slide terms can't prime the model.
- The ASR pipeline computes all window features before decoding; `utils/audio.js` decodes the whole file.
- `backends/onnx.js` fetches the 26.9 MB WASM runtime from cdn.jsdelivr.net unless `wasmPaths` is set. WebGPU defaults to fp32; the Cache API holds models; `revision` pins a commit.
- onnxruntime-web's `backend-wasm.ts` uses one thread without `crossOriginIsolated`.
- `onnxruntime-node` 1.30.0 comes along (113.5 MB, 301 MB unpacked), and its postinstall download is disabled by `ONNXRUNTIME_NODE_INSTALL=skip`.

### Browsers

From `@mdn/browser-compat-data` 8.1.9 (2026-11-12), via npm. caniuse.com and webkit.org were outside this session's network.

- **WebGPU:** Chrome and Edge 144, Chrome Android 121, Safari and iOS Safari 26, Samsung Internet 25; Firefox 141 partial (Windows, and Apple-silicon Macs from 145/147).
- **Others:** Screen Wake Lock in Chrome 84 and iOS 18.4; `AudioDecoder` in Chrome 94 and Safari 26; `StorageManager.persist` in Safari 15.2.

The [WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu) puts global WebGPU support at about 85%.

### Providers

These come from search excerpts of official pages; I did not open the pages themselves.

- **OpenAI:** files up to 25 MB ([guide](https://developers.openai.com/api/docs/guides/speech-to-text)). `gpt-transcribe` costs $0.0045 a minute; `gpt-4o-transcribe` costs $0.006 and is marked deprecated ([pricing](https://developers.openai.com/api/docs/pricing)). The SDK types (openai 7.57.0) say it returns json only. A forum reports a 1,500 s cap (**unverified**).
- **Groq:** $0.04 an hour; 25 MB on the free tier, 100 MB on the dev tier ([docs](https://console.groq.com/docs/speech-to-text)).
- **Soniox:** $0.10 an hour async, and Hebrew is listed ([pricing](https://soniox.com/pricing), [Hebrew](https://soniox.com/speech-to-text/hebrew)). File limits not found.
- **Deepgram:** $0.0043 a minute ([post](https://deepgram.com/blog/speech-to-text-api-pricing-breakdown-2025)). Hebrew is shown only by ivrit.ai's benchmark.
- **Google:** Chirp 3 Hebrew is in Preview, in the us and eu regions ([docs](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)).
- **RunPod:** ivrit.ai publishes a [template](https://github.com/ivrit-ai/runpod-serverless). Turbo runs at 31× real time on an L4 (`timing.csv`); the 24 GB flex tier costs $0.69-1.34 an hour ([pricing](https://www.runpod.io/pricing)).

### Transcript sources

- **Zoom:** cloud recordings can include a VTT transcript ([docs](https://developers.zoom.us/docs/build/cloud-recording/)). The host enables it. Hebrew is **not confirmed**.
- **Panopto:** Hebrew is **not confirmed**. Viewer downloads need an admin setting and come without timestamps ([community](https://community.panopto.com/discussion/1541/how-to-download-the-auto-generated-transcript-on-any-video)).
- **YouTube:** automatic captions include Hebrew ([help](https://support.google.com/youtube/answer/6373554)). Caption files (SRT, SBV, VTT) need YouTube Studio access ([formats](https://support.google.com/youtube/answer/2734698)).
- **WebVTT:** the [W3C spec](https://www.w3.org/TR/webvtt1/).

### Platform

- **Vercel:** 4.5 MB request bodies (the deprecated Edge page says 4 MB), and 300 s edge streams. Edge is deprecated for new projects ([limits](https://vercel.com/docs/functions/limitations)).
- **Supabase:** 50 MB per file on the free plan ([limits](https://supabase.com/docs/guides/storage/uploads/file-limits)). Not needed now.
- **Anthropic** (skill, `shared/prompt-caching.md`): on Opus 5.5, cache reads cost $0.20/M, and 5-minute writes cost 1.25×.

## 4. Risks and open questions

1. **English terms in Hebrew speech.** No benchmark covers them; they may come out in Hebrew letters or garbled. The slides-based repair is the safeguard. Measure this first, on a real clip.
2. **Phones.** The download is 1.6 GB. Tab memory limits and Safari evicting the cached model are **unverified**. The only speed figure found is informal (about 10× real time on an M3 Max), and a locked screen stops the work. Computers stay the default until device tests are in.
3. **The ONNX repository has no card.** Compare its output with ivrit.ai's reference turbo, or export and host the model ourselves.
4. **A pre-release runtime** (the onnxruntime-web dev build). Pin exact versions and retest on every upgrade.
5. **Codecs per browser** (M4A, MP3, WhatsApp Ogg Opus, MP4 video) are **unverified**; test them. For long files on phones, the later fix is streaming decode with WebCodecs.
6. **Recordings behind the university login** can't be fetched; members bring the files they have. Policy is Yoad's check.
7. **Budget.** Notes on every lecture, plus summaries, could pass $33-40 a month. Run notes only where there is a recording, show the estimate and the remaining budget, and count everything in `assertBudget`.
8. **Hebrew transcript token counts are unknown.** Measure them before relying on $0.82.
9. **Install weight.** Choose between `ONNXRUNTIME_NODE_INSTALL=skip` on Vercel, npm overrides, or a pinned CDN web build loaded in the worker.
10. **Open:** Does Zoom give the group Hebrew transcripts? How often are there audio files, not just links? Who in the group has a computer with WebGPU?
