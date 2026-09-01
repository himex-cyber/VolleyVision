# Match video sources — why YouTube is primary, and what that costs

**Status:** decided. YouTube is the primary source; upload remains as the
private-storage alternative.
**Scope:** where match footage lives and what can be done to it. The storage
adapter, its vendor comparison, and the constraints that shaped it are in
`video-storage-decision.md`; this document does not restate them, it explains
which of them stopped applying and what replaced them.

---

## 1. Why the source changed

The workflow is now: a coach uploads the match to their own YouTube channel as
**unlisted**, and pastes the link into VolleyVision. We store an eleven-character
video id and embed the player. No bytes of ours move.

That is not a small optimisation. YouTube supplies storage, transcoding, an
adaptive-bitrate ladder, a global CDN and segment-level seeking, at no cost to
us and none to the coach. The sibling document spent its length on four
constraints; **linking rather than storing dissolves all four in one move**,
because each of them was a consequence of us being in the data path.

| Constraint from `video-storage-decision.md` | What happens to it |
| --- | --- |
| Storage ceiling — Supabase Free gives 1 GB total, and one 90-minute match exceeds that on its own | Gone. We store an id, not a file. |
| Egress — 5 GB/month, and every playback re-downloads the whole raw MP4 because there is no adaptive ladder | Gone. Playback never touches our infrastructure. |
| The 6 MB collision — a TUS chunk is exactly 6 MiB and a Netlify Function request caps at ~6 MB, so every chunk fails | Gone. There is no upload to chunk. |
| The credential problem — TUS needs the service-role key, which cannot be given to a browser, which forced the proxy that Netlify then capped | Gone. There is no credential to protect. |
| Seeking on a raw 90-minute MP4 is slow, and jump-to-moment is *made of seeks* | Solved, not merely avoided. YouTube's player already does segmented adaptive delivery — the thing the sibling doc recommended paying Mux or Cloudflare Stream for. |

The vendor decision that document defers is therefore no longer on the critical
path. It still matters for clubs that take the upload route (§3), but video can
ship on the current hosting today, which it previously could not.

Linking is deliberately cheap and forgiving. `linkYouTubeVideo` parses the id
out of any common URL form, checks it against an exact host allow-list rather
than a regex over the raw string, and asks YouTube's oEmbed endpoint whether the
video exists and is embeddable. A definite refusal — 401, 403 or 404, meaning
private, deleted or embedding disabled — blocks the link with a message the
coach can act on in seconds. A network failure does not: we learned nothing, so
the link is allowed with a null title rather than a coach being blocked by our
own connectivity. The row is created `READY` immediately; `PENDING` and `FAILED`
describe an upload lifecycle that has nothing to attach to here.

---

## 2. The constraint that replaces them

**A YouTube embed is a cross-origin iframe. JavaScript cannot read its pixels.
Ever.**

This is not a limitation to be worked around with a clever library or a
same-origin trick. The browser blocks it as a security boundary, and YouTube's
terms prohibit the attempt independently of what the browser allows. Anything
built on top of match video from here has to be designed around it, so it is
worth stating exactly what it forbids:

- **No frame capture.** `canvas.drawImage(iframe)` does not work and will not
  start working.
- **No screenshots, no thumbnail extraction.** A poster frame cannot be pulled
  out of the footage.
- **No export, no download, no re-encode.** We cannot produce a file from a
  YouTube video, and should not try.

Two design consequences follow, and both are already in the schema.

**A clip is a time range, never a file.** `VideoClip` stores `startSeconds`,
`endSeconds` and a label. Nothing is cut, nothing is stored, nothing is served —
the player seeks between two numbers. Generated clips take a 10-second pre-roll
and a 4-second post-roll around the event, because a statistician taps the
button *after* seeing the action, so the rally sits before the recorded instant.
This is a better model than cutting files even where cutting is possible: a clip
costs two integers, re-labelling is free, and adjusting a boundary does not
re-encode anything.

**Anything visual sits on top of the iframe.** It is drawn over the player's
box and can never be flattened into it. That is not a compromise — an overlay
replayed from stored coordinates is editable, resolution-independent and
diffable, where a burned-in image is none of those things. §7 covers what this
means for the annotation slice.

---

## 3. Why upload remains

The presigned upload path is built, tested and dormant behind the same
`features.video` flag. It is not dead code and it is not a fallback for YouTube
being down; it is the answer for a club whose policy will not permit match
footage on YouTube at all, on any privacy setting. For those clubs, private
object storage with signed URLs is the only shape that works, and the sibling
document's vendor decision becomes live again for them.

The two paths share a `Video` row and almost nothing else. `VideoSource`
distinguishes them, fields that belong to one source are nullable, and the
storage adapter now serves **only** `source: UPLOAD` — a YouTube row has no
storage key to presign, head or delete.

---

## 4. Calibration: one anchor, taken from a real event

Every `Event` carries an absolute `recordedAt`. A video carries a single
`recordingStartedAt` — the real-world instant that video time 0:00 corresponds
to. Those two facts are enough to place every tracked event in the footage:

```
videoSeconds = (event.recordedAt - recordingStartedAt) / 1000
```

There is no per-event offset table, no drift correction, no second anchor at the
end. One timestamp per video does the whole job.

**Deriving it.** The coach scrubs to the first rally and marks it. The client
sends the playhead position; the server looks up the match's earliest tracked
event and subtracts:

```
recordingStartedAt = firstEvent.recordedAt − playheadSeconds
```

**Why it anchors on an event rather than on wall-clock.** The obvious
alternative is to ask the coach when recording started, or to read a timestamp
off the file. Both bake in whatever the tracking device's clock was doing.
Tablets and phones drift, and a statistician's device that is two minutes fast
would put every generated clip two minutes out — consistently, invisibly, and in
a way no one would diagnose from the symptom.

Anchoring on a real event makes that impossible. The offset appears in *both*
operands: it is inside `firstEvent.recordedAt`, from which the anchor is
derived, and inside every later `event.recordedAt` measured against it. The
subtraction is between two readings of the same clock, so the skew cancels
exactly. The device can be an hour wrong and the clips still land on the rally.

**Each video calibrates independently.** The anchor lives on the video row, not
the match. A match filmed as three set-videos has three anchors, set separately,
and the coach never has to reason about how they relate. Events that fall
outside a given video's footage are **skipped and counted, never errored** — for
three set-videos, most of a match's events are outside any one of them, and that
is the normal case rather than a failure. `setRecordingStart` reports back how
many events matched and how many fell outside, so a mis-calibration is visible
immediately instead of surfacing later as a list of clips pointing at the wrong
rallies.

Duration is the one value we cannot compute. It arrives from the client once the
IFrame API knows it — the API reports 0 until metadata loads — and it is what
lets clip generation clamp at the end of the footage. Until it arrives, clips
generate without an upper clamp.

Generation is idempotent: an event that already has a `GENERATED` clip on a
video is skipped, so pressing the button twice does not double the list.
Recalibration clears `GENERATED` clips, because their ranges were computed from
the old anchor, and keeps `MANUAL` ones, because a range a coach dragged by eye
is still correct.

---

## 5. The unlisted tradeoff

This is the real cost of the decision and it should be read as one.

**Unlisted is not access control.** It means the video does not appear in search
or on the channel page. Anyone holding the link can watch it: no login, no
expiry, no revocation short of changing the video's privacy setting, and no
per-viewer accounting. A signed storage URL is a genuinely different thing — it
is scoped, short-lived, and issued to a request we authorised. Swapping one for
the other is a downgrade in access control, and no amount of care in our own
code changes that, because the link is a YouTube artefact and YouTube honours it
for whoever presents it.

Three mitigations, in the order they matter.

1. **Consent before linking.** Publishing footage of a team, especially one that
   includes minors, is a decision for the club, not a side effect of pasting a
   URL. The link form states plainly what unlisted means and requires an
   explicit tick before the Link button becomes available
   (`components/video/LinkYouTubeForm.tsx`). The acknowledgement is remembered
   per user in `localStorage`, which is the right weight for it: this is a nudge
   at the moment of the decision, not a legal record, and nothing in the system
   depends on it being durable or auditable.
2. **Never render the raw URL as a link.** The embed is the only surface the app
   offers. `youtubeWatchUrl` exists for display and debugging and is documented
   as never being rendered as an anchor — the app should not be a place the link
   leaks from more easily than YouTube itself.
3. **Defer to the club's own filming policy.** Most clubs already have one,
   covering consent for filming and for publishing. VolleyVision's job is to
   make the setting legible at the moment of the decision, not to substitute its
   own rule for the club's.

A club that cannot accept any of this has the upload path, which is precisely
why §3 keeps it.

---

## 6. The comparison

| | YouTube (unlisted embed) | Presigned upload (`source: UPLOAD`) |
| --- | --- | --- |
| **Cost to us** | Zero — no storage, no egress, no transcoding bill | Storage plus egress, and egress dominates at any real usage |
| **Storage ceiling** | Effectively none | The vendor's, and Supabase Free's 1 GB is roughly one match |
| **Transcoding / adaptive bitrate** | Included. Multiple renditions, chosen per viewer | None on a raw-file provider. Present only if the vendor decision lands on Stream or Mux |
| **Seek performance** | Fast — segmented delivery, one segment fetched per seek | Poor on a raw MP4. A seek is a range request into a large file, and jump-to-moment is made of seeks |
| **Privacy / access control** | Weak. Anyone with the link, no expiry, not tied to a session | Strong. Private bucket, short-lived signed URLs, every endpoint team-scoped |
| **Offline availability** | None inside our app. Playback needs the network and YouTube | Also online in practice, but the bytes are a plain file we control and could cache |
| **Annotation ceiling** | Overlays only. Pixels unreadable, permanently | Full control. A same-origin `<video>` can be drawn to a canvas, so frame capture and burned-in export are possible |
| **Operational burden** | Almost none. One outbound oEmbed call at link time | Bucket configuration, orphan sweep, size and MIME limits kept in step across two independent settings, and `npm run check:video` before a deploy |

The annotation row is the only one where upload wins outright, and it is worth
being clear about the trade: we are giving up a capability we have not built in
exchange for one that works today at zero cost. §7 is where that bill comes due.

---

## 7. Future slices, and the constraint each must respect

**Annotations.** A vector overlay positioned above the iframe: shapes stored as
coordinates plus a timestamp, replayed on top of the player at the right moment.
Never flattened into an image, because there is no image to flatten into.
Coordinates should be stored normalised to the player box so they survive a
resize.

> ⚠️ **The recorded hazard: iOS Safari fullscreen.** iOS can hand playback to the
> native fullscreen player rather than keeping it inline. When it does, the video
> is no longer painted inside our iframe's box, and anything drawn over that box
> is left behind on a page the user cannot see. `playsinline: 1` reduces how
> often this happens; **it does not eliminate it** — iOS still promotes to
> fullscreen on some versions, in low-power mode, and whenever the user taps the
> fullscreen control. This must be tested on a real iOS device before overlay
> work starts. The simulator and desktop Safari do not reproduce it. The warning
> is recorded in full at the top of `frontend/src/components/video/YouTubePlayer.tsx`.

**Share to chat.** A link to a moment — video id plus start second, rendered as
a timestamped mini-player in the message — never an exported file. This falls
out of the same constraint and is the better feature regardless: it costs
nothing to send, stays in sync if the coach re-labels the clip, and does not
scatter copies of match footage through a chat history.

Both slices are additive. Neither requires the storage adapter, and neither
should be designed in a way that would.

---

**Resolved in v** *(left blank)*
