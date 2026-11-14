"""Assemble the Italian demo video from recordings, slides, narration and the real call audio."""
import glob, subprocess, sys
V = sys.argv[1]; O = f"{V}/out"; FPS = 30
raw = lambda d: glob.glob(f"{V}/{d}/*.webm")[0]
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]

def run(args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode: print(r.stderr[-3000:]); sys.exit(1)

def still(img, dur, zoom=0.04):
    """Slow centred zoom on a still, as a filter chain fed by -loop 1 input."""
    n = int(dur * FPS)
    return (f"scale=2560:1440,zoompan=z='1+{zoom}*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s=1280x720:fps={FPS},"
            f"trim=duration={dur},setpts=PTS-STARTPTS,format=yuv420p")

def seg(i, a, b, speed=1.0):
    return (f"[{i}:v]trim={a}:{b},setpts=(PTS-STARTPTS)*{speed},fps={FPS},scale=1280:720,setsar=1,format=yuv420p")

def narration(idx, vo, delay, dur):
    return f"[{idx}:a]adelay={int(delay*1000)}:all=1,apad,atrim=0:{dur},aformat=sample_rates=48000:channel_layouts=stereo"

# Scene 1: PDF page, then the copied text (crossfade at 13 s).
D1 = 20.5
run(["-loop", "1", "-i", f"{V}/slides/s1a.png", "-loop", "1", "-i", f"{V}/slides/s1b.png", "-i", f"{V}/audio/vo_s1.mp3",
     "-filter_complex", f"[0:v]{still(0, 13.4)}[a];[1:v]{still(0, 7.5, 0.03)}[b];[a][b]xfade=transition=fade:duration=0.4:offset=13.0[v];"
     f"{narration(2, 'vo_s1', 0.6, D1)}[aout]", "-map", "[v]", "-map", "[aout]", "-t", str(D1), *ENC, f"{O}/s1.mp4"])

# Scene 2: glyph table, then the home page with the numbers highlighted.
D2 = 24.5; h0 = 6.08
box = lambda x, a, b: f"drawbox=x={x}:y=355:w=372:h=106:color=0xb44e2a@0.95:t=4:enable='between(t,{a},{b})'"
run(["-loop", "1", "-i", f"{V}/slides/s2a.png", "-i", raw("raw2"), "-i", f"{V}/audio/vo_s2.mp3",
     "-filter_complex", f"[0:v]{still(0, 5.2, 0.03)}[a];{seg(1, h0, h0 + 19.6)},{box(82, 0.4, 4.6)},{box(454, 6.0, 11.2)}[b];"
     f"[a][b]xfade=transition=fade:duration=0.3:offset=4.9[v];{narration(2, 'vo_s2', 0.4, D2)}[aout]",
     "-map", "[v]", "-map", "[aout]", "-t", str(D2), *ENC, f"{O}/s2.mp4"])

# Scene 3: operator intake (dead time cut, preview slowed slightly), then a pan over the real result screen.
D3 = 32.0; parts = 4.8 + 5.1 * 1.25 + 1.3 + 4.0; pan = round(D3 - parts, 3)
ease = lambda a, b, y0, y1: f"{y0}+({y1}-{y0})*(3*pow(clip((t-{a})/{b-a},0,1),2)-2*pow(clip((t-{a})/{b-a},0,1),3))"
yexpr = f"if(lt(t,4.6),{ease(2.4, 4.6, 440, 840)},{ease(9.4, 11.0, 840, 1160)})"
run(["-i", raw("raw"), "-loop", "1", "-i", f"{V}/frames/s3_full.png", "-i", f"{V}/audio/vo_s3.mp3",
     "-filter_complex",
     f"{seg(0, 5.3, 10.1)}[a];{seg(0, 14.8, 19.9, 1.25)}[b];{seg(0, 19.9, 21.2)}[c];{seg(0, 31.0, 35.0)}[d];"
     f"[1:v]scale=2560:-1,crop=1280:720:1200:'{yexpr}',trim=duration={pan},setpts=PTS-STARTPTS,fps={FPS},setsar=1,format=yuv420p[e];"
     f"[a][b][c][d][e]concat=n=5:v=1:a=0[v];{narration(2, 'vo_s3', 0.3, D3)}[aout]",
     "-map", "[v]", "-map", "[aout]", "-t", str(D3), *ENC, f"{O}/s3.mp4"])

# Scene 4: the real call. Screen replay of the agent's client-tool calls, call audio, Italian subtitles.
D4 = 64.6; s0 = 6.8
call = [  # (input file, start in scene, [segments in source seconds], gain dB, phone EQ)
    (f"{V}/call/agent_0.wav", 5.6, [(0, 4.9)], 3, False),
    (f"{V}/call/caller_1.mp3", 11.0, None, 2, True),
    (f"{V}/call/agent_1.wav", 16.7, [(0, 1.35), (4.8, 11.4)], 3, False),
    (f"{V}/call/caller_2.mp3", 25.1, None, 2, True),
    (f"{V}/call/agent_2.wav", 32.0, [(0, 13.0)], 3, False),
    (f"{V}/call/caller_3.mp3", 45.4, None, 2, True),
    (f"{V}/call/agent_3.wav", 50.2, [(0, 6.8), (16.6, 23.7)], 3, False),
]
inputs = ["-i", raw("raw4"), "-i", f"{V}/slides/hud.png", "-i", f"{V}/audio/vo_s4.mp3",
          "-i", f"{V}/slides/cap_prefix.png", "-i", f"{V}/slides/cap_verified.png"]
fc = [f"{seg(0, s0, s0 + D4)}[sv]",
      f"[sv][1:v]overlay=0:0:enable='gte(t,5.4)'[h];[h][3:v]overlay=0:0:enable='between(t,25.3,33.6)'[h2];"
      f"[h2][4:v]overlay=0:0:enable='between(t,50.4,57.0)',ass={V}/s4_subs.ass[v]",
      narration(2, 'vo_s4', 0.3, D4) + "[n]"]
labels = ["[n]"]
for k, (f, start, segs, gain, phone) in enumerate(call):
    idx = 5 + k; inputs += ["-i", f]
    chain = f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo"
    if segs:
        parts_ = []
        for j, (a, b) in enumerate(segs):
            fc.append(f"{chain},atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={b - a - 0.05}:d=0.05[c{k}_{j}]")
            parts_.append(f"[c{k}_{j}]")
        fc.append(f"{''.join(parts_)}concat=n={len(parts_)}:v=0:a=1[c{k}]")
        src = f"[c{k}]anull"
    else:
        src = chain + (",highpass=f=250,lowpass=f=3600" if phone else "") + f"[c{k}r];[c{k}r]anull"
    fc.append(f"{src},volume={gain}dB,adelay={int(start*1000)}:all=1,apad,atrim=0:{D4}[l{k}]")
    labels.append(f"[l{k}]")
fc.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0[aout]")
run([*inputs, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[aout]", "-t", str(D4), *ENC, f"{O}/s4.mp4"])

# Scene 5: the verify page, then the custody timeline (cut over the queue loading).
D5 = 22.8; t5 = 7.92
run(["-i", raw("raw5b"), "-i", f"{V}/audio/vo_s5.mp3", "-filter_complex",
     f"{seg(0, t5, t5 + 16.8)}[a];{seg(0, t5 + 18.0, t5 + 23.9)},tpad=stop_mode=clone:stop_duration=3[b];"
     f"[a][b]concat=n=2:v=1:a=0[v];{narration(1, 'vo_s5', 0.4, D5)}[aout]",
     "-map", "[v]", "-map", "[aout]", "-t", str(D5), *ENC, f"{O}/s5.mp4"])

# Scene 6: the alert page, then the closing card; fade out.
D6 = 15.2; t6 = 5.32
run(["-i", raw("raw6"), "-loop", "1", "-i", f"{V}/slides/s6b.png", "-i", f"{V}/audio/vo_s6.mp3", "-filter_complex",
     f"{seg(0, t6, t6 + 7.6)}[a];[1:v]{still(0, 8.3, 0.025)}[b];[a][b]xfade=transition=fade:duration=0.4:offset=7.2,"
     f"fade=t=out:st={D6 - 0.8}:d=0.8[v];{narration(2, 'vo_s6', 0.4, D6)},afade=t=out:st={D6 - 0.8}:d=0.8[aout]",
     "-map", "[v]", "-map", "[aout]", "-t", str(D6), *ENC, f"{O}/s6.mp4"])

# Join and normalise loudness.
open(f"{O}/list.txt", "w").write("".join(f"file '{O}/s{i}.mp4'\n" for i in range(1, 7)))
run(["-f", "concat", "-safe", "0", "-i", f"{O}/list.txt", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000", f"{O}/ritrovo_video_it.mp4"])
print("built")
