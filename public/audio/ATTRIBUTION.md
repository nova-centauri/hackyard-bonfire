# Campfire audio

`campfire-soft.mp3` is an adapted version of **campfire.wav** by **aerror**,
published July 25, 2016 on Freesound:

- Source: https://freesound.org/people/aerror/sounds/350757/
- Creator: https://freesound.org/people/aerror/
- License: **Creative Commons Zero 1.0 (CC0)** — https://creativecommons.org/publicdomain/zero/1.0/
- Download: the source page's public high-quality MP3 preview, https://cdn.freesound.org/previews/350/350757_2472895-hq.mp3
- Retrieved: September 12, 2026.

The creator describes a campfire recorded with a Zoom H4N and its internal XY
microphones, with leveling and cutting. The app bundles the 39.6-second stereo
recording locally; enabling audio does not contact Freesound or another service.

Changes: high-pass at 115 Hz to reduce rumble; low-pass at 4.6 kHz to soften hiss
and sharp edges; fast compression to tame isolated loud pops; gain adjustment;
short boundary fades; re-encoding to stereo MP3 at 128 kb/s. The adapted asset
measures approximately -34.1 dBFS average and -11.1 dBFS sample peak before the
app's volume control. Those are digital measurements, not a playback loudness
guarantee for a particular device.

The app overlaps several-second exponential fades between different 12–19
second passages, high-passes the remaining rumble, preserves pitch, and adds
infrequent quiet procedural cracks. Wood-settling
sounds are procedural layers of softly filtered scraping noise and damped wood
resonance, triggered by physical impacts. They are not claimed to be recordings
of the simulated logs. A much quieter synthetic noise bed is used if the bundled
recording cannot be loaded or decoded.

Processing command (FFmpeg 8):

```sh
ffmpeg -i source.mp3 -af 'highpass=f=115,lowpass=f=4600,acompressor=threshold=0.008:ratio=6:attack=0.1:release=130:makeup=8,volume=2,alimiter=limit=0.52:level=false,afade=t=in:d=0.04,afade=t=out:st=39.2:d=0.36' -map_metadata -1 -c:a libmp3lame -b:a 128k campfire-soft.mp3
```
