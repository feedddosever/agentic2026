"""Real call with the Ritrovo agent over its WebSocket: text in (caller lines), audio out. Saves each agent turn's
PCM audio, transcript and client-tool calls with their offset (seconds of agent audio before the call)."""
import asyncio, json, sys, time, base64
import websockets

AGENT, OUT = sys.argv[1], sys.argv[2]
TURNS = json.load(open(sys.argv[3]))

async def main():
    url = f"wss://api.elevenlabs.io/v1/convai/conversation?agent_id={AGENT}"
    turns = [{"user": None, "audio": bytearray(), "text": [], "tools": [], "webhooks": []}]
    async with websockets.connect(url, max_size=None, open_timeout=30) as ws:
        await ws.send(json.dumps({"type": "conversation_initiation_client_data"}))
        pending = list(TURNS); last = time.time(); fmt = None; t0 = time.time()
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                cur = turns[-1]
                if time.time() - last > 6 and cur["audio"]:
                    if pending:
                        msg = pending.pop(0); print(f"{time.time()-t0:6.1f} USER: {msg}", flush=True)
                        turns.append({"user": msg, "audio": bytearray(), "text": [], "tools": [], "webhooks": []})
                        await ws.send(json.dumps({"type": "user_message", "text": msg})); last = time.time()
                    else:
                        break
                if time.time() - last > 40: break
                continue
            ev = json.loads(raw); t = ev.get("type"); cur = turns[-1]
            if t == "ping":
                await ws.send(json.dumps({"type": "pong", "event_id": ev["ping_event"]["event_id"]})); continue
            last = time.time()
            if t == "conversation_initiation_metadata":
                m = ev["conversation_initiation_metadata_event"]; fmt = m.get("agent_output_audio_format")
                print("conversation:", m.get("conversation_id"), fmt, flush=True)
            elif t == "audio":
                cur["audio"] += base64.b64decode(ev["audio_event"]["audio_base_64"])
            elif t == "agent_response":
                txt = ev["agent_response_event"]["agent_response"]; cur["text"].append(txt)
                print(f"{time.time()-t0:6.1f} AGENT: {txt}", flush=True)
            elif t == "client_tool_call":
                c = ev["client_tool_call"]; off = len(cur["audio"]) / 32000
                cur["tools"].append({"name": c["tool_name"], "params": c.get("parameters"), "offset": off})
                print(f"{time.time()-t0:6.1f} CLIENT TOOL @{off:.1f}s: {c['tool_name']} {json.dumps(c.get('parameters'))}", flush=True)
            elif t in ("agent_tool_request", "agent_tool_response"):
                cur["webhooks"].append(ev); print(f"{time.time()-t0:6.1f} {t}: {json.dumps(ev)[:250]}", flush=True)
            elif t == "agent_response_correction":
                print("CORRECTION", json.dumps(ev)[:300], flush=True)
    for i, tr in enumerate(turns):
        open(f"{OUT}/agent_{i}.pcm", "wb").write(bytes(tr["audio"]))
        tr["audio_s"] = len(tr["audio"]) / 32000; del tr["audio"]
    json.dump({"format": fmt, "turns": turns}, open(f"{OUT}/call.json", "w"), indent=1, ensure_ascii=False)

asyncio.run(main())
