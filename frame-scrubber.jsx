import { useState, useRef, useEffect, useCallback } from "react";

const AMBER = "#E8940A";
const AMBER_BG = "rgba(232,148,10,0.14)";
const BG = "#FAFAF8";
const TXT = "#1B1D22";
const MUT = "#6B7078";
const LINE = "#E4E4E0";
const TRACK = "#ECECE8";
const ERR = "#C4453B";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'Instrument Sans', system-ui, sans-serif";

const FPS_OPTIONS = [24, 25, 30, 50, 60, 90, 120];
const SPEEDS = [1, 0.5, 0.25, 0.1];

const pad = (n, w) => String(n).padStart(w, "0");
const fmtTime = (s) => {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
};

export default function FrameLab() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const timelineRef = useRef(null);
  const fileInputRef = useRef(null);

  const cacheRef = useRef(new Map());
  const targetRef = useRef(0);
  const seekingRef = useRef(false);
  const fpsRef = useRef(60);
  const metaRef = useRef(null);
  const onionRef = useRef(false);
  const rvfcRef = useRef(null);
  const playingRef = useRef(false);
  const loadTimerRef = useRef(null);
  const queueRef = useRef([]);

  const [attempt, setAttempt] = useState(-1);
  const [sourceName, setSourceName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [meta, setMeta] = useState(null);
  const [fps, setFps] = useState(60);
  const [frame, setFrame] = useState(0);
  const [markA, setMarkA] = useState(null);
  const [markB, setMarkB] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const [onion, setOnion] = useState(false);
  const [thumbs, setThumbs] = useState([]);
  const [prep, setPrep] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hasRvfc, setHasRvfc] = useState(true);
  const [loadStatus, setLoadStatus] = useState(null);
  const [corsLimited, setCorsLimited] = useState(false);

  const current = attempt >= 0 ? queueRef.current[attempt] : null;
  const totalFrames = meta ? Math.max(1, Math.round(meta.duration * fps)) : 0;

  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { metaRef.current = meta; }, [meta]);
  useEffect(() => { onionRef.current = onion; }, [onion]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const seekTo = (t) =>
    new Promise((res) => {
      const v = videoRef.current;
      if (!v) return res();
      if (Math.abs(v.currentTime - t) < 1e-4) return res();
      const h = () => { v.removeEventListener("seeked", h); res(); };
      v.addEventListener("seeked", h);
      v.currentTime = t;
    });

  const drawCurrent = useCallback((idx, withOnion) => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !metaRef.current) return;
    const ctx = c.getContext("2d");
    ctx.globalAlpha = 1;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    if (withOnion) {
      [[1, 0.32], [2, 0.16]].forEach(([d, a]) => {
        const bmp = cacheRef.current.get(idx - d);
        if (bmp) { ctx.globalAlpha = a; ctx.drawImage(bmp, 0, 0, c.width, c.height); }
      });
      ctx.globalAlpha = 1;
    }
    if (typeof createImageBitmap === "function" && !cacheRef.current.has(idx)) {
      createImageBitmap(v).then((bmp) => {
        cacheRef.current.set(idx, bmp);
        for (const k of cacheRef.current.keys()) {
          if (Math.abs(k - idx) > 6) {
            cacheRef.current.get(k)?.close?.();
            cacheRef.current.delete(k);
          }
        }
      }).catch(() => {});
    }
  }, []);

  const runSeekLoop = useCallback(async () => {
    if (seekingRef.current) return;
    seekingRef.current = true;
    const v = videoRef.current;
    while (v && metaRef.current) {
      const t = targetRef.current;
      const time = Math.min(metaRef.current.duration - 0.001, Math.max(0, (t + 0.5) / fpsRef.current));
      await seekTo(time);
      drawCurrent(t, onionRef.current);
      if (targetRef.current === t) break;
    }
    seekingRef.current = false;
  }, [drawCurrent]);

  const goToFrame = useCallback((i) => {
    const total = metaRef.current ? Math.max(1, Math.round(metaRef.current.duration * fpsRef.current)) : 1;
    const idx = Math.max(0, Math.min(total - 1, i));
    setFrame(idx);
    targetRef.current = idx;
    runSeekLoop();
  }, [runSeekLoop]);

  const stopPlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    if (rvfcRef.current && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(rvfcRef.current);
    rvfcRef.current = null;
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v || !metaRef.current) return;
    v.playbackRate = speed;
    setPlaying(true);
    const total = Math.max(1, Math.round(metaRef.current.duration * fpsRef.current));
    if (v.requestVideoFrameCallback) {
      const cb = (now, md) => {
        const idx = Math.min(total - 1, Math.floor(md.mediaTime * fpsRef.current + 1e-3));
        setFrame(idx);
        const c = canvasRef.current;
        if (c) c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        if (playingRef.current) rvfcRef.current = v.requestVideoFrameCallback(cb);
      };
      rvfcRef.current = v.requestVideoFrameCallback(cb);
    } else {
      const onTime = () => {
        const idx = Math.min(total - 1, Math.floor(v.currentTime * fpsRef.current));
        setFrame(idx);
        const c = canvasRef.current;
        if (c) c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        if (!playingRef.current) v.removeEventListener("timeupdate", onTime);
      };
      v.addEventListener("timeupdate", onTime);
    }
    v.play();
  }, [speed]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      stopPlayback();
      const v = videoRef.current;
      if (v) goToFrame(Math.floor(v.currentTime * fpsRef.current));
    } else startPlayback();
  }, [startPlayback, stopPlayback, goToFrame]);

  const resetForLoad = () => {
    stopPlayback();
    cacheRef.current.forEach((b) => b?.close?.());
    cacheRef.current.clear();
    setMeta(null); metaRef.current = null;
    setThumbs([]); setFrame(0);
    setMarkA(null); setMarkB(null);
    setCorsLimited(false);
    setLoadStatus("loading");
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      setLoadStatus((s) => (s === "loading" ? "Still loading — large videos take a moment. If nothing happens, the source may be blocking access." : s));
    }, 8000);
  };

  const startQueue = (queue, name) => {
    resetForLoad();
    setSourceName(name);
    queueRef.current = queue;
    setAttempt(0);
  };

  const loadFile = (file) => {
    if (!file) return;
    const blob = URL.createObjectURL(file);
    const q = [{ src: blob, cors: undefined, kind: "file" }];
    startQueue(q, file.name);
    const r = new FileReader();
    r.onload = () => { queueRef.current.push({ src: r.result, cors: undefined, kind: "file" }); };
    r.readAsDataURL(file);
  };

  const loadUrl = (raw) => {
    const url = raw.trim();
    if (!url) return;
    const loom = url.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{16,})/i);
    if (loom) {
      const worker = (typeof window !== "undefined" && window.LOOM_WORKER) || "";
      if (!worker) {
        setLoadStatus("Loom links need the companion resolver. Deploy loom-worker.js to Cloudflare (see README) and put its URL into index.html as window.LOOM_WORKER.");
        return;
      }
      const src = `${worker.replace(/\/$/, "")}/video?id=${loom[1]}`;
      startQueue(
        [{ src, cors: "anonymous", kind: "loom" }, { src, cors: undefined, kind: "loom" }],
        "Loom video"
      );
      return;
    }
    startQueue(
      [{ src: url, cors: "anonymous", kind: "url" }, { src: url, cors: undefined, kind: "url" }],
      url.split("/").pop()?.split("?")[0] || "video"
    );
  };

  const onVideoError = () => {
    if (attempt + 1 < queueRef.current.length) {
      setAttempt((a) => a + 1);
      return;
    }
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    const kind = queueRef.current[attempt]?.kind;
    setLoadStatus(
      kind === "loom"
        ? "The resolver couldn't fetch this Loom video — it may be private, or Loom changed its API. Fallback: use Download on the Loom page, then drop the file here."
        : "Couldn't load this video. Inside the claude.ai preview, most video sources are blocked by the sandbox — publish this artifact and open the published link, where loading works normally."
    );
    setAttempt(-1);
  };

  const onMetadata = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    setLoadStatus(null);
    setHasRvfc(!!v.requestVideoFrameCallback);
    let dur = v.duration;
    if (!isFinite(dur) || dur <= 0) {
      dur = await new Promise((res) => {
        const h = () => { v.removeEventListener("durationchange", h); res(v.duration); };
        v.addEventListener("durationchange", h);
        v.currentTime = 1e7;
      });
      v.currentTime = 0;
    }
    if (!isFinite(dur) || dur <= 0 || !v.videoWidth) {
      setLoadStatus("The source loaded, but no video could be decoded from it.");
      return;
    }
    const cur = queueRef.current[attempt];
    const remoteNoCors = cur && cur.kind !== "file" && cur.cors !== "anonymous";
    setCorsLimited(!!remoteNoCors);
    const m = { w: v.videoWidth, h: v.videoHeight, duration: dur };
    metaRef.current = m;
    setMeta(m);
    const c = canvasRef.current;
    if (c) { c.width = m.w; c.height = m.h; }
    if (!remoteNoCors) {
      const N = 14;
      const list = [];
      setPrep(0);
      const th = 54, tw = Math.max(24, Math.round(th * (m.w / m.h)));
      const off = document.createElement("canvas");
      off.width = tw; off.height = th;
      const octx = off.getContext("2d");
      try {
        for (let k = 0; k < N; k++) {
          const t = m.duration * ((k + 0.5) / N);
          await seekTo(Math.min(m.duration - 0.001, t));
          octx.drawImage(v, 0, 0, tw, th);
          list.push({ src: off.toDataURL("image/jpeg", 0.65), frac: (k + 0.5) / N });
          setPrep((k + 1) / N);
        }
        setThumbs(list);
      } catch (e) {
        setCorsLimited(true);
      }
      setPrep(null);
    }
    goToFrame(0);
  };

  const changeFps = (n) => {
    const old = fpsRef.current;
    const conv = (x) => (x == null ? null : Math.round((x * n) / old));
    setMarkA((a) => conv(a));
    setMarkB((b) => conv(b));
    setFps(n);
    fpsRef.current = n;
    setFrame((f) => conv(f) ?? 0);
  };

  const detectFps = async () => {
    const v = videoRef.current;
    if (!v || !v.requestVideoFrameCallback || !metaRef.current) return;
    setDetecting(true);
    const t0 = v.currentTime;
    const times = [];
    await new Promise((res) => {
      const cb = (now, md) => {
        times.push(md.mediaTime);
        if (times.length >= 26 || md.mediaTime >= metaRef.current.duration - 0.05) res();
        else v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
      v.playbackRate = 1;
      v.play();
    });
    v.pause();
    const diffs = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0.0005);
    if (diffs.length > 4) {
      diffs.sort((a, b) => a - b);
      const med = diffs[Math.floor(diffs.length / 2)];
      const raw = 1 / med;
      const snap = FPS_OPTIONS.find((f) => Math.abs(f - raw) / f < 0.12);
      changeFps(snap || Math.round(raw));
    }
    await seekTo(t0);
    drawCurrent(Math.floor(t0 * fpsRef.current), onionRef.current);
    setPlaying(false);
    setDetecting(false);
  };

  const exportFrame = () => {
    const c = canvasRef.current;
    if (!c || corsLimited) return;
    try {
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `frame-${pad(frame, 4)}-${Math.round((frame / fps) * 1000)}ms.png`;
      a.click();
    } catch (e) {
      setCorsLimited(true);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (!metaRef.current) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") { e.preventDefault(); stopPlayback(); goToFrame(targetRef.current + step); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stopPlayback(); goToFrame(targetRef.current - step); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "i" || e.key === "I") setMarkA(targetRef.current);
      else if (e.key === "o" || e.key === "O") setMarkB(targetRef.current);
      else if (e.key === "Home") { stopPlayback(); goToFrame(0); }
      else if (e.key === "End") { stopPlayback(); goToFrame(1e9); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToFrame, togglePlay, stopPlayback]);

  useEffect(() => {
    if (!onion || !meta) return;
    goToFrame(targetRef.current);
  }, [onion]);

  const scrubFromPointer = useCallback((clientX) => {
    const el = timelineRef.current;
    if (!el || !metaRef.current) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const total = Math.max(1, Math.round(metaRef.current.duration * fpsRef.current));
    stopPlayback();
    goToFrame(Math.round(frac * (total - 1)));
  }, [goToFrame, stopPlayback]);

  const onTimelineDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromPointer(e.clientX);
  };
  const onTimelineMove = (e) => {
    if (e.buttons & 1) scrubFromPointer(e.clientX);
  };

  const a = markA != null && markB != null ? Math.min(markA, markB) : markA;
  const b = markA != null && markB != null ? Math.max(markA, markB) : markB;
  const deltaFrames = a != null && b != null ? b - a : null;
  const deltaMs = deltaFrames != null ? Math.round((deltaFrames / fps) * 1000) : null;

  const Btn = ({ children, onClick, active, disabled, title, wide }) => (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        fontFamily: MONO, fontSize: 12, letterSpacing: "0.02em",
        color: active ? "#FFF" : disabled ? "#B9BCC1" : TXT,
        background: active ? AMBER : "#FFFFFF",
        border: `1px solid ${active ? AMBER : LINE}`,
        borderRadius: 8, padding: wide ? "7px 14px" : "7px 10px",
        cursor: disabled ? "default" : "pointer", lineHeight: 1,
      }}
    >{children}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TXT, fontFamily: SANS, padding: "24px 24px 40px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');
        ::selection { background: ${AMBER}; color: #fff; }
        button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid ${AMBER}; outline-offset: 2px; }
      `}</style>

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}>Frame Lab</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>Phase 1</span>
          </div>
          {meta && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
                {sourceName} · {meta.w}×{meta.h}
              </span>
              <Btn onClick={() => { setMeta(null); metaRef.current = null; setAttempt(-1); setLoadStatus(null); setUrlValue(""); }}>
                new video
              </Btn>
            </div>
          )}
        </header>

        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }}
          onChange={(e) => loadFile(e.target.files?.[0])} />
        <video ref={videoRef} key={attempt} src={current?.src} crossOrigin={current?.cors}
          muted playsInline preload="auto"
          onLoadedMetadata={onMetadata} onEnded={() => setPlaying(false)} onError={onVideoError}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />

        {!meta ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]); }}
            style={{ paddingTop: "18vh", textAlign: "center" }}
          >
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: 54, padding: "0 32px", fontFamily: SANS, fontSize: 15, fontWeight: 500,
                color: "#FFF", background: TXT, border: "none", borderRadius: 12, cursor: "pointer",
              }}
            >Choose a video file</button>

            {loadStatus && (
              <div style={{
                marginTop: 24, fontFamily: MONO, fontSize: 12, lineHeight: 1.7,
                color: loadStatus === "loading" ? AMBER : ERR,
                maxWidth: 520, marginLeft: "auto", marginRight: "auto",
              }}>
                {loadStatus === "loading" ? `loading ${sourceName}…` : loadStatus}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
              <canvas ref={canvasRef}
                style={{
                  maxWidth: "100%", maxHeight: "52vh", width: "auto", height: "auto",
                  borderRadius: 10, background: "#000", boxShadow: "0 2px 14px rgba(27,29,34,0.10)",
                }} />
              {prep != null && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
                  background: "rgba(250,250,248,0.7)", borderRadius: 10,
                }}>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: MUT }}>reading frames…</span>
                  <div style={{ width: 180, height: 3, background: TRACK, borderRadius: 2 }}>
                    <div style={{ width: `${Math.round(prep * 100)}%`, height: "100%", background: AMBER, borderRadius: 2 }} />
                  </div>
                </div>
              )}
            </div>

            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 10, marginTop: 18,
            }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Btn title="Back 10 (Shift+←)" onClick={() => { stopPlayback(); goToFrame(frame - 10); }}>«10</Btn>
                <Btn title="Back 1 (←)" onClick={() => { stopPlayback(); goToFrame(frame - 1); }}>‹ 1</Btn>
                <Btn wide title="Play / pause (Space)" onClick={togglePlay} active={playing}>
                  {playing ? "pause" : "play"}
                </Btn>
                <Btn title="Forward 1 (→)" onClick={() => { stopPlayback(); goToFrame(frame + 1); }}>1 ›</Btn>
                <Btn title="Forward 10 (Shift+→)" onClick={() => { stopPlayback(); goToFrame(frame + 10); }}>10»</Btn>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
                  style={{ fontFamily: MONO, fontSize: 12, background: "#FFF", color: TXT, border: `1px solid ${LINE}`, borderRadius: 8, padding: "7px 8px" }}>
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Btn onClick={() => setOnion((o) => !o)} active={onion} title="Overlay ghosts of the previous 2 visited frames">
                  onion skin
                </Btn>
                <Btn onClick={exportFrame} disabled={corsLimited}
                  title={corsLimited ? "Unavailable for this video: the source doesn't allow pixel access from other sites" : "Save current frame as PNG"}>
                  export frame
                </Btn>
                <select value={fps} onChange={(e) => changeFps(Number(e.target.value))}
                  style={{ fontFamily: MONO, fontSize: 12, background: "#FFF", color: TXT, border: `1px solid ${LINE}`, borderRadius: 8, padding: "7px 8px" }}>
                  {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
                </select>
                <Btn onClick={detectFps} disabled={detecting || !hasRvfc}
                  title="Estimates fps from playback. Capped by your display's refresh rate — a 120 fps clip may read as 60 on a 60 Hz screen.">
                  {detecting ? "…" : "detect"}
                </Btn>
              </div>
            </div>

            <div ref={timelineRef} onPointerDown={onTimelineDown} onPointerMove={onTimelineMove}
              style={{ position: "relative", height: 36, marginTop: 16, cursor: "ew-resize", touchAction: "none" }}>
              <div style={{ position: "absolute", top: 14, left: 0, right: 0, height: 8, background: TRACK, borderRadius: 4 }} />
              {a != null && b != null && (
                <div style={{
                  position: "absolute", top: 14, height: 8, background: AMBER_BG,
                  borderTop: `1px solid ${AMBER}`, borderBottom: `1px solid ${AMBER}`,
                  left: `${(a / Math.max(1, totalFrames - 1)) * 100}%`,
                  width: `${((b - a) / Math.max(1, totalFrames - 1)) * 100}%`,
                }} />
              )}
              {[["A", a], ["B", b]].map(([label, m]) => m != null && (
                <div key={label} style={{ position: "absolute", left: `${(m / Math.max(1, totalFrames - 1)) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: AMBER, textAlign: "center" }}>{label}</div>
                  <div style={{ width: 1, height: 26, background: AMBER, margin: "0 auto" }} />
                </div>
              ))}
              <div style={{
                position: "absolute", top: 10, width: 2, height: 16, background: TXT, borderRadius: 1,
                left: `calc(${(frame / Math.max(1, totalFrames - 1)) * 100}% - 1px)`,
              }} />
            </div>

            {thumbs.length > 0 && (
              <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
                {thumbs.map((t, i) => (
                  <img key={i} src={t.src} alt={`preview ${i + 1}`}
                    onClick={() => { stopPlayback(); goToFrame(Math.round(t.frac * (totalFrames - 1))); }}
                    style={{
                      flex: 1, minWidth: 0, height: 44, objectFit: "cover", borderRadius: 4, cursor: "pointer",
                      border: `1px solid ${Math.abs(frame - t.frac * (totalFrames - 1)) < totalFrames / thumbs.length / 2 ? AMBER : LINE}`,
                    }} />
                ))}
              </div>
            )}
            {corsLimited && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 10 }}>
                This source allows playback only — filmstrip and frame export are off. Download the video and load it as a file for full features.
              </div>
            )}

            <div style={{
              display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
              gap: 14, marginTop: 26, paddingTop: 20, borderTop: `1px solid ${LINE}`,
            }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: "0.03em", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(frame / fps)}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 4 }}>
                  frame {pad(frame, 4)} / {pad(totalFrames - 1, 4)} @ {fps} fps
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Btn onClick={() => setMarkA(frame)} title="Mark transition start (I)">
                  A {a != null ? `· ${pad(a, 4)}` : "(I)"}
                </Btn>
                <Btn onClick={() => setMarkB(frame)} title="Mark transition end (O)">
                  B {b != null ? `· ${pad(b, 4)}` : "(O)"}
                </Btn>
                {(a != null || b != null) && (
                  <Btn onClick={() => { setMarkA(null); setMarkB(null); }} title="Clear marks">clear</Btn>
                )}
              </div>

              <div style={{ textAlign: "right" }}>
                {deltaMs != null ? (
                  <>
                    <div style={{ fontFamily: MONO, fontSize: 30, color: AMBER, fontVariantNumeric: "tabular-nums" }}>
                      Δ {deltaMs} ms
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 4 }}>
                      {deltaFrames} frames between A and B
                    </div>
                  </>
                ) : (
                  <div style={{ fontFamily: MONO, fontSize: 12, color: MUT, maxWidth: 230, lineHeight: 1.6, textAlign: "right" }}>
                    Mark the first frame of movement (A) and the frame it settles (B) to measure duration
                  </div>
                )}
              </div>
            </div>

            <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 14, lineHeight: 1.8 }}>
              ← → step 1 · shift steps 10 · space plays · I / O set marks · duration math assumes the fps above matches the recording
            </div>
          </>
        )}
      </div>
    </div>
  );
}
