import { useState, useRef, useEffect, useCallback } from "react";

// Frame Lab — motion analysis math (pure functions, unit-testable)

function nelderMead(f, x0, iters = 300) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += p[i] !== 0 ? Math.abs(p[i]) * 0.15 + 0.01 : 0.1;
    simplex.push(p);
  }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const refl = centroid.map((c, j) => 2 * c - worst[j]);
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = centroid.map((c, j) => 3 * c - 2 * worst[j]);
      const fe = f(exp);
      if (fe < fr) { simplex[n] = exp; vals[n] = fe; } else { simplex[n] = refl; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = refl; vals[n] = fr;
    } else {
      const con = centroid.map((c, j) => 0.5 * (c + worst[j]));
      const fc = f(con);
      if (fc < vals[n]) { simplex[n] = con; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((x, j) => 0.5 * (x + simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
  }
  const bi = vals.indexOf(Math.min(...vals));
  return { x: simplex[bi], fval: vals[bi] };
}

function bezierProgress(x1, y1, x2, y2, xs) {
  const N = 240;
  const bx = new Float64Array(N), by = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1), v = 1 - u;
    bx[i] = 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
    by[i] = 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
  }
  return xs.map((x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bx[m] < x) lo = m; else hi = m; }
    const fr = (x - bx[lo]) / (bx[hi] - bx[lo] || 1e-9);
    return by[lo] + fr * (by[hi] - by[lo]);
  });
}

// y = distance to final position; spring model with free phase (C1, C2 solved exactly)
function fitSpring(t, y) {
  let best = null;
  const evalZW = (z, w) => {
    let f1, f2;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      f1 = t.map((tt) => Math.exp(-z * w * tt) * Math.cos(wd * tt));
      f2 = t.map((tt) => Math.exp(-z * w * tt) * Math.sin(wd * tt));
    } else {
      const s = w * Math.sqrt(z * z - 1 + 1e-12);
      f1 = t.map((tt) => Math.exp((-z * w + s) * tt));
      f2 = t.map((tt) => Math.exp((-z * w - s) * tt));
    }
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < t.length; i++) {
      a11 += f1[i] * f1[i]; a12 += f1[i] * f2[i]; a22 += f2[i] * f2[i];
      b1 += f1[i] * y[i]; b2 += f2[i] * y[i];
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12) return null;
    const C1 = (b1 * a22 - b2 * a12) / det, C2 = (a11 * b2 - a12 * b1) / det;
    let se = 0;
    for (let i = 0; i < t.length; i++) { const m = C1 * f1[i] + C2 * f2[i]; se += (m - y[i]) ** 2; }
    return { zeta: z, omega: w, C1, C2, rms: Math.sqrt(se / t.length) };
  };
  for (let z = 0.15; z <= 2.05; z *= 1.09)
    for (let w = 2; w <= 75; w *= 1.07) {
      const r = evalZW(z, w);
      if (r && (!best || r.rms < best.rms)) best = r;
    }
  for (let k = 0; k < 3; k++) {
    const zs = [0.94, 0.97, 1, 1.03, 1.06].map((m) => best.zeta * m);
    const ws = [0.94, 0.97, 1, 1.03, 1.06].map((m) => best.omega * m);
    for (const z of zs) for (const w of ws) {
      const r = evalZW(z, w);
      if (r && r.rms < best.rms) best = r;
    }
  }
  best.model = (tq) => {
    const { zeta: z, omega: w, C1, C2 } = best;
    return tq.map((tt) => {
      if (z < 1) {
        const wd = w * Math.sqrt(1 - z * z);
        return Math.exp(-z * w * tt) * (C1 * Math.cos(wd * tt) + C2 * Math.sin(wd * tt));
      }
      const s = w * Math.sqrt(z * z - 1 + 1e-12);
      return C1 * Math.exp((-z * w + s) * tt) + C2 * Math.exp((-z * w - s) * tt);
    });
  };
  return best;
}

// y = distance to final; duration T fixed from data; fits cubic-bezier control points
function fitBezier(t, y, T) {
  const travel = y[0] || 1;
  const pm = y.map((v) => 1 - v / travel); // measured progress 0..1
  const xq = t.map((tt) => tt / T);
  const loss = (p) => {
    const x1 = Math.min(1, Math.max(0, p[0])), y1 = Math.min(1.8, Math.max(-0.5, p[1]));
    const x2 = Math.min(1, Math.max(0, p[2])), y2 = Math.min(1.8, Math.max(-0.5, p[3]));
    const mp = bezierProgress(x1, y1, x2, y2, xq);
    let se = 0;
    for (let i = 0; i < pm.length; i++) se += (mp[i] - pm[i]) ** 2;
    return se / pm.length;
  };
  let best = null;
  for (const s of [[0.25, 0.1, 0.25, 1], [0.42, 0, 0.58, 1], [0.3, 0.3, 0.6, 1], [0, 0, 0.58, 1], [0.2, 0.8, 0.4, 1]]) {
    const r = nelderMead(loss, s, 260);
    if (!best || r.fval < best.fval) best = r;
  }
  const [x1, y1, x2, y2] = [
    Math.min(1, Math.max(0, best.x[0])), Math.min(1.8, Math.max(-0.5, best.x[1])),
    Math.min(1, Math.max(0, best.x[2])), Math.min(1.8, Math.max(-0.5, best.x[3])),
  ];
  const rms = Math.sqrt(best.fval) * travel;
  const model = (tq) => {
    const prog = bezierProgress(x1, y1, x2, y2, tq.map((tt) => tt / T));
    return prog.map((p) => travel * (1 - p));
  };
  return { x1, y1, x2, y2, T, rms, model };
}

const round = (v, d = 2) => Number(v.toFixed(d));

// samples: [{t seconds, x px, y px}] at full resolution; fps for velocity thresholds
function classifyMotion(samples, opts = {}) {
  const X = samples.map((s) => s.x), Y = samples.map((s) => s.y);
  const rx = Math.max(...X) - Math.min(...X), ry = Math.max(...Y) - Math.min(...Y);
  const d = ry >= rx ? Y.slice() : X.slice();
  const t0all = samples[0].t;
  const T = samples.map((s) => s.t - t0all);

  const final = (d[d.length - 1] + d[d.length - 2] + d[d.length - 3]) / 3;
  const rel = d.map((v) => v - final);
  const travelEst = Math.max(...rel.map(Math.abs));
  if (travelEst < 6) return { label: "none", message: "No significant motion of the selected element between the marks." };

  // velocity (smoothed)
  const v = [];
  for (let i = 1; i < d.length; i++) v.push((d[i] - d[i - 1]) / (T[i] - T[i - 1] || 1e-3));
  const vs = v.map((_, i) => (v[Math.max(0, i - 1)] + v[i] + v[Math.min(v.length - 1, i + 1)]) / 3);
  const vmax = Math.max(...vs.map(Math.abs));
  const movingIdx = vs.map((vv, i) => [Math.abs(vv), i]).filter(([a]) => a > Math.max(60, 0.06 * vmax)).map(([, i]) => i);
  if (movingIdx.length < 3) return { label: "none", message: "Too little motion to analyze — try different marks." };
  const iStart = movingIdx[0], iEnd = movingIdx[movingIdx.length - 1];
  const settled = iEnd < vs.length - 2;

  // gesture: |v| correlates positively with time across the moving span
  const mi = movingIdx;
  const mt = mi.map((i) => T[i + 1]), mv = mi.map((i) => Math.abs(vs[i]));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mmt = mean(mt), mmv = mean(mv);
  let num = 0, dt2 = 0, dv2 = 0;
  for (let i = 0; i < mt.length; i++) { num += (mt[i] - mmt) * (mv[i] - mmv); dt2 += (mt[i] - mmt) ** 2; dv2 += (mv[i] - mmv) ** 2; }
  const corr = num / Math.sqrt(dt2 * dv2 + 1e-9);
  if (corr > 0.55 || (!settled && corr > 0.25)) {
    return {
      label: "gesture",
      corr: round(corr),
      durationMs: Math.round((T[iEnd + 1] - T[iStart]) * 1000),
      travel: Math.round(travelEst),
      peakVel: Math.round(vmax),
      settled,
    };
  }

  // fit window: motion start .. a few samples past settle
  const wEnd = Math.min(d.length - 1, iEnd + 4);
  const wt = [], wy0 = [];
  for (let i = iStart; i <= wEnd; i++) { wt.push(T[i] - T[iStart]); wy0.push(rel[i]); }
  const sgn = Math.sign(wy0[0]) || 1;
  const wy = wy0.map((v2) => v2 * sgn); // motion always starts positive, decays to 0
  const travel = Math.abs(wy[0]) || 1;

  // overshoot: crossings below zero beyond 2.5% of travel
  const overshoot = wy.some((v2) => v2 < -0.025 * travel);

  const sFit = fitSpring(wt, wy);
  const durT = T[Math.min(iEnd + 1, d.length - 1)] - T[iStart];
  const bFit = fitBezier(wt, wy, Math.max(durT, wt[1] || 0.05));

  if (travel < 10 || Math.min(sFit.rms, bFit.rms) > 0.3 * travel) {
    return {
      label: "unreliable",
      message: "Tracking couldn't follow the element confidently between these marks — the fit error is too large to trust. Try marks tightly around one clean transition, or a recording where the moving element has a distinctive pattern.",
      travel: Math.round(travel), rmsSpring: round(sFit.rms, 1), rmsBezier: round(bFit.rms, 1),
    };
  }
  let label;
  if (overshoot && sFit.rms <= bFit.rms * 1.15) label = "spring";
  else label = sFit.rms <= bFit.rms ? "spring" : "timed";
  const closeCall = Math.abs(sFit.rms - bFit.rms) / Math.max(sFit.rms, bFit.rms) < 0.2;
  const trust = Math.min(sFit.rms, bFit.rms) / travel < 0.04 && !closeCall;

  const out = {
    label, closeCall, trust, overshoot,
    travel: Math.round(travel),
    durationMs: Math.round(durT * 1000),
    rmsSpring: round(sFit.rms, 1), rmsBezier: round(bFit.rms, 1),
    samplesT: wt.map((x) => Math.round(x * 1000)),
    samplesPct: wy.map((v2) => round((v2 / travel) * 100, 1)),
  };
  const win = label === "spring" ? sFit : bFit;
  const chartEnd = label === "spring" ? Math.max(wt[wt.length - 1], Math.log(1000) / (sFit.zeta * sFit.omega)) : bFit.T * 1.12;
  const tq = Array.from({ length: 180 }, (_, i) => (i / 179) * chartEnd);
  const yq = win.model(tq);
  out.curve = tq.map((tt, i) => [Math.round(tt * 1000), round((yq[i] / travel) * 100, 2)]);

  if (label === "spring") {
    const zeta = round(sFit.zeta), omega = round(sFit.omega, 1);
    const response = 2 * Math.PI / sFit.omega;
    const stiffness = Math.round((2 * Math.PI / response) ** 2);
    const damping = round(2 * sFit.zeta * Math.sqrt(stiffness), 1);
    const bounce = round(1 - sFit.zeta);
    const settleMs = Math.round((Math.log(1000) / (sFit.zeta * sFit.omega)) * 1000);
    out.params = { zeta, omega, response: round(response), stiffness, damping, bounce, settleMs };
    out.rows = [
      `.spring(response: ${round(response)}, dampingFraction: ${zeta})`,
      `.spring(duration: ${round(response)}, bounce: ${bounce})`,
      `UISpringTimingParameters(mass: 1, stiffness: ${stiffness}, damping: ${damping})`,
      `Figma spring \u00b7 stiffness ${stiffness} \u00b7 damping ${damping} \u00b7 mass 1`,
    ];
  } else {
    const ms = Math.round(bFit.T * 1000);
    const cb = `cubic-bezier(${round(bFit.x1)}, ${round(bFit.y1)}, ${round(bFit.x2)}, ${round(bFit.y2)})`;
    out.params = { x1: round(bFit.x1), y1: round(bFit.y1), x2: round(bFit.x2), y2: round(bFit.y2), ms };
    out.rows = [
      `${ms}ms ${cb}`,
      `.timingCurve(${round(bFit.x1)}, ${round(bFit.y1)}, ${round(bFit.x2)}, ${round(bFit.y2)}, duration: ${round(bFit.T)})`,
    ];
  }
  return out;
}

const AMBER = "#008FF0";
const AMBER_BG = "rgba(0,143,240,0.12)";
const BG = "#FFFFFF";
const TXT = "#1B1D22";
const MUT = "#6B7078";
const LINE = "#E5E7EB";
const TRACK = "#EEF0F3";
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
  const debugRef = useRef(null);

  const [attempt, setAttempt] = useState(-1);
  const [sourceName, setSourceName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [meta, setMeta] = useState(null);
  const [fps, setFps] = useState(60);
  const [frame, setFrame] = useState(0);
  const [markA, setMarkA] = useState(null);
  const [markB, setMarkB] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed] = useState(1);
  const [onion, setOnion] = useState(false);
  const [thumbs, setThumbs] = useState([]);
  const [prep, setPrep] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hasRvfc, setHasRvfc] = useState(true);
  const [loadStatus, setLoadStatus] = useState(null);
  const [corsLimited, setCorsLimited] = useState(false);
  const [ana, setAna] = useState({ stage: "idle" });
  const anaRef = useRef(ana);
  useEffect(() => { anaRef.current = ana; }, [ana]);
  const anaABRef = useRef([0, 0]);

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

  const drawCurrent = useCallback(async (idx, withOnion) => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !metaRef.current) return;
    const m0 = metaRef.current;
    if (c.width !== m0.w || c.height !== m0.h) { c.width = m0.w; c.height = m0.h; }
    let bmp = cacheRef.current.get(idx);
    if (!bmp && typeof createImageBitmap === "function") {
      try {
        bmp = await createImageBitmap(v);
        cacheRef.current.set(idx, bmp);
        for (const k of cacheRef.current.keys()) {
          if (Math.abs(k - idx) > 6) {
            cacheRef.current.get(k)?.close?.();
            cacheRef.current.delete(k);
          }
        }
      } catch (e) {}
    }
    const ctx = c.getContext("2d");
    ctx.globalAlpha = 1;
    if (bmp) ctx.drawImage(bmp, 0, 0, c.width, c.height);
    else ctx.drawImage(v, 0, 0, c.width, c.height);
    if (withOnion) {
      [[1, 0.32], [2, 0.16]].forEach(([d, a]) => {
        const g = cacheRef.current.get(idx - d);
        if (g) { ctx.globalAlpha = a; ctx.drawImage(g, 0, 0, c.width, c.height); }
      });
      ctx.globalAlpha = 1;
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
      await drawCurrent(t, onionRef.current);
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

  const beginAnalysis = (A, B) => {
    stopPlayback();
    anaABRef.current = [A, B];
    setAna({ stage: "tracking", p: 0 });
    runFullAnalysis();
  };

  const trackElementAuto = async (A, B) => {
    const v = videoRef.current, m = metaRef.current, fpsV = fpsRef.current;
    const total = Math.max(1, Math.round(m.duration * fpsV));
    const f0 = Math.max(0, A - 2);
    const f1e = Math.min(total - 1, B + Math.max(4, Math.round(fpsV * 0.25)));
    const sw = 300, sf = sw / m.w, sh = Math.max(40, Math.round(m.h * sf));
    const off = document.createElement("canvas"); off.width = sw; off.height = sh;
    const octx = off.getContext("2d", { willReadFrequently: true });
    const grab = async (fi) => {
      await seekTo(Math.min(m.duration - 0.001, (fi + 0.5) / fpsV));
      try { const bmp = await createImageBitmap(v); octx.drawImage(bmp, 0, 0, sw, sh); bmp.close(); }
      catch (e) { octx.drawImage(v, 0, 0, sw, sh); }
      const id = octx.getImageData(0, 0, sw, sh).data;
      const g = new Float32Array(sw * sh);
      for (let i2 = 0, j2 = 0; j2 < g.length; i2 += 4, j2++) g[j2] = id[i2] * 0.299 + id[i2 + 1] * 0.587 + id[i2 + 2] * 0.114;
      return g;
    };
    const frameCache = new Map();
    const getFrame = async (fi) => {
      if (frameCache.has(fi)) return frameCache.get(fi);
      const g = await grab(fi); frameCache.set(fi, g); return g;
    };
    const imgStart = await getFrame(f0);
    const imgEnd = await getFrame(f1e);

    let minX = sw, minY = sh, maxX = 0, maxY = 0, maxD = 0;
    const diff = new Float32Array(sw * sh);
    for (let i2 = 0; i2 < diff.length; i2++) { const d = Math.abs(imgEnd[i2] - imgStart[i2]); diff[i2] = d; if (d > maxD) maxD = d; }
    const thr = Math.max(14, maxD * 0.25);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (diff[y * sw + x] > thr) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX - minX < 8 || maxY - minY < 8) throw new Error("no visible motion between the marks");

    const bw = Math.max(16, Math.min(84, Math.round((maxX - minX) * 0.5)));
    const bh = Math.max(12, Math.min(56, Math.round((maxY - minY) * 0.35)));
    const st = Math.max(1, Math.round(Math.sqrt((bw * bh) / 2000)));

    const nccAt = (img, tvals, tnorm, coords, xx, yy) => {
      let sum = 0, sum2 = 0, dot = 0;
      for (let k = 0; k < coords.length; k++) {
        const p = img[(yy + coords[k][0]) * sw + xx + coords[k][1]];
        sum += p; sum2 += p * p; dot += p * tvals[k];
      }
      const n = coords.length, mu = sum / n;
      const sd = Math.sqrt(Math.max(sum2 - n * mu * mu, 1e-6));
      return dot / (sd * tnorm);
    };
    const makeTpl = (bx, by2) => {
      const coords = [];
      for (let j2 = 0; j2 < bh; j2 += st) for (let i2 = 0; i2 < bw; i2 += st) coords.push([j2, i2]);
      let tmean = 0;
      const tvals = coords.map(([j2, i2]) => { const p = imgEnd[(by2 + j2) * sw + bx + i2]; tmean += p; return p; });
      tmean /= tvals.length;
      let tnorm = 0;
      for (let i2 = 0; i2 < tvals.length; i2++) { tvals[i2] -= tmean; tnorm += tvals[i2] * tvals[i2]; }
      tnorm = Math.sqrt(tnorm) || 1e-6;
      return { coords, tvals, tnorm };
    };
    const isUnique = (bx, by2) => {
      const T = makeTpl(bx, by2);
      for (let yy = 0; yy <= sh - bh - 1; yy += 4) for (let xx = 0; xx <= sw - bw - 1; xx += 4) {
        if (Math.abs(xx - bx) <= bw * 0.8 && Math.abs(yy - by2) <= bh * 0.8) continue;
        if (nccAt(imgEnd, T.tvals, T.tnorm, T.coords, xx, yy) > 0.8) return false;
      }
      return true;
    };

    const cands = [];
    for (let y = minY; y <= Math.min(maxY - bh, sh - bh - 1); y += 3)
      for (let x = minX; x <= Math.min(maxX - bw, sw - bw - 1); x += 3) {
        let s = 0, s2 = 0, dsum = 0, n = 0;
        for (let j2 = 0; j2 < bh; j2 += 2) for (let i2 = 0; i2 < bw; i2 += 2) {
          const idx = (y + j2) * sw + x + i2;
          const p = imgEnd[idx]; s += p; s2 += p * p; dsum += diff[idx]; n++;
        }
        const varr = s2 / n - (s / n) ** 2;
        const meanDiff = dsum / n;
        if (meanDiff < thr * 0.6 || varr < 40) continue;
        cands.push({ score: meanDiff * Math.sqrt(varr), x, y });
      }
    if (!cands.length) throw new Error("couldn't find a trackable pattern in the moving area");
    cands.sort((p, q) => q.score - p.score);
    const picked = [];
    for (const c of cands) {
      if (picked.length >= 4) break;
      if (!picked.every((p) => Math.abs(p.x - c.x) > bw * 0.7 || Math.abs(p.y - c.y) > bh * 0.7)) continue;
      if (!isUnique(c.x, c.y)) continue; // repeating patterns (list rows) are disqualified
      picked.push(c);
    }
    if (!picked.length) throw new Error("every distinctive pattern in the moving area repeats elsewhere — tracking would be ambiguous");

    const totalN = f1e - f0 + 1;
    const Rstep = Math.round(Math.max(sw, sh) * 0.15); // physics-bounded per-frame search

    const trackWith = async (cand, ci, nCand) => {
      const T = makeTpl(cand.x, cand.y);
      const match = (img, cx, cy, R, step) => {
        let best = -2, bxx = cx, byy = cy;
        const x0 = Math.max(0, cx - R), x1 = Math.min(sw - bw - 1, cx + R);
        const y0 = Math.max(0, cy - R), y1 = Math.min(sh - bh - 1, cy + R);
        for (let yy = y0; yy <= y1; yy += step) for (let xx = x0; xx <= x1; xx += step) {
          const c = nccAt(img, T.tvals, T.tnorm, T.coords, xx, yy);
          if (c > best) { best = c; bxx = xx; byy = yy; }
        }
        return [bxx, byy, best];
      };
      const raw = [];
      let px2 = cand.x, py2 = cand.y, count = 0;
      for (let fi = f1e; fi >= f0; fi--) {
        const img = await getFrame(fi);
        let [nx, ny] = match(img, px2, py2, Rstep, 3);
        let conf;
        [nx, ny, conf] = match(img, nx, ny, 4, 1);
        if (conf < 0.35) { nx = px2; ny = py2; }
        px2 = nx; py2 = ny;
        raw.push({ t: fi / fpsV, x: nx / sf, y: ny / sf, conf });
        count++;
        setAna({ stage: "tracking", p: (ci + count / totalN) / nCand });
      }
      raw.reverse();
      let bestS = 0, bestE = -1, curS = 0;
      for (let i2 = 0; i2 <= raw.length; i2++) {
        const ok = i2 < raw.length && raw[i2].conf >= 0.4;
        if (!ok) {
          if (i2 - curS > bestE - bestS) { bestS = curS; bestE = i2; }
          curS = i2 + 1;
        }
      }
      const kept = raw.slice(bestS, bestE);
      const keptFrac = kept.length / raw.length;
      let travel = 0, revs = 0;
      if (kept.length > 2) {
        const xs2 = kept.map((s3) => s3.x), ys2 = kept.map((s3) => s3.y);
        const rx = Math.max(...xs2) - Math.min(...xs2), ry = Math.max(...ys2) - Math.min(...ys2);
        travel = Math.max(rx, ry);
        const dvals = ry >= rx ? ys2 : xs2;
        for (let i2 = 2; i2 < dvals.length; i2++) {
          const d1 = dvals[i2 - 1] - dvals[i2 - 2], d2 = dvals[i2] - dvals[i2 - 1];
          if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > 0.1 * Math.max(travel, 1)) revs++;
        }
      }
      const quality = (revs === 0 ? 2 : 1) * keptFrac * Math.min(travel, 2400);
      return { kept, keptFrac, travel, revs, quality };
    };

    let bestAttempt = null;
    for (let ci = 0; ci < picked.length; ci++) {
      const attempt = await trackWith(picked[ci], ci, picked.length);
      if (!bestAttempt || attempt.quality > bestAttempt.quality) bestAttempt = attempt;
      if (attempt.keptFrac >= 0.7 && attempt.revs === 0 && attempt.travel >= 150) { bestAttempt = attempt; break; }
    }
    if (!bestAttempt || bestAttempt.kept.length < 8)
      throw new Error("the moving element was only briefly trackable — try marks that start when it is already on screen");
    return bestAttempt.kept;
  };

  const runFullAnalysis = async () => {
    const [A, B] = anaABRef.current;
    try {
      const samples = await trackElementAuto(A, B);
      const result = classifyMotion(samples);
      setAna({ stage: "done", result });
    } catch (e) {
      setAna({ stage: "error", msg: String((e && e.message) || e) });
    }
    goToFrame(anaABRef.current[0]);
  };

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
    let fw = v.videoWidth, fh = v.videoHeight;
    await seekTo(Math.min(dur - 0.001, 0.001));
    const dbg = { vw: v.videoWidth, vh: v.videoHeight, bw: 0, bh: 0 };
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(v);
        dbg.bw = bmp.width; dbg.bh = bmp.height;
        if (bmp.width && bmp.height) { fw = bmp.width; fh = bmp.height; }
        bmp.close();
      } catch (e) {}
    }
    debugRef.current = dbg;
    const m = { w: fw, h: fh, duration: dur };
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
          if (typeof createImageBitmap === "function") {
            try { const tb = await createImageBitmap(v); octx.drawImage(tb, 0, 0, tw, th); tb.close(); }
            catch (e) { octx.drawImage(v, 0, 0, tw, th); }
          } else {
            octx.drawImage(v, 0, 0, tw, th);
          }
          list.push({ src: off.toDataURL("image/jpeg", 0.65), frac: (k + 0.5) / N });
          setPrep((k + 1) / N);
        }
        setThumbs(list);
      } catch (e) {
        setCorsLimited(true);
      }
      setPrep(null);
    }
    if (v.requestVideoFrameCallback) {
      await seekTo(0.001);
      await detectFps();
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
      else if (e.code === "KeyA" || e.key === "a" || e.key === "A") setMarkA(targetRef.current);
      else if (e.code === "KeyB" || e.key === "b" || e.key === "B") setMarkB(targetRef.current);
      else if (e.code === "KeyC" || e.key === "c" || e.key === "C") { setMarkA(null); setMarkB(null); }
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
            <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>Phase 2 · v12</span>
          </div>
          {meta && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
                {sourceName} · {fps} fps
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
              <div style={{ position: "relative" }}>
                <canvas ref={canvasRef}
                  style={{
                    maxWidth: "100%", maxHeight: "52vh", width: "auto", height: "auto",
                    borderRadius: 10, background: "#000", boxShadow: "0 2px 14px rgba(27,29,34,0.10)",
                  }} />
                {ana.stage === "tracking" && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", background: "rgba(255,255,255,0.55)", borderRadius: 10,
                  }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, color: TXT, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 16px" }}>
                      tracking… {Math.round((ana.p || 0) * 100)}%
                    </div>
                  </div>
                )}
              </div>
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
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {a != null && b != null && b > a && ana.stage !== "select" && ana.stage !== "tracking" && (
                  <Btn active onClick={() => beginAnalysis(a, b)} title="Track an element between the marks and identify the animation">Analyze</Btn>
                )}
                <Btn onClick={() => setMarkA(frame)} title="Mark the first frame of movement (key A)">Start</Btn>
                <Btn onClick={() => setMarkB(frame)} title="Mark the frame where motion settles (key B)">End</Btn>
                {(a != null || b != null) && (
                  <Btn onClick={() => { setMarkA(null); setMarkB(null); }} title="Clear marks (key C)">clear</Btn>
                )}
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
              gap: 14, marginTop: 26,
            }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: "0.03em", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(frame / fps)}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 4 }}>
                  frame {pad(frame, 4)} / {pad(totalFrames - 1, 4)} @ {fps} fps
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                {deltaMs != null ? (
                  <>
                    <div style={{ fontFamily: MONO, fontSize: 30, color: AMBER, fontVariantNumeric: "tabular-nums" }}>
                      Δ {deltaMs} ms
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: MUT, marginTop: 4 }}>
                      {deltaFrames} frames · start {pad(a, 4)} → end {pad(b, 4)}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {ana.stage === "error" && (
              <div style={{ fontFamily: MONO, fontSize: 12, color: "#C4453B", marginTop: 18 }}>
                analysis failed: {ana.msg}
              </div>
            )}
            {ana.stage === "done" && ana.result && (() => {
              const r = ana.result;
              const badge = r.label === "spring" ? "Spring" : r.label === "timed" ? "Timed" : r.label === "gesture" ? "Gesture" : r.label === "unreliable" ? "Unreliable" : "No motion";
              const winRms = r.label === "spring" ? r.rmsSpring : r.rmsBezier;
              const loseRms = r.label === "spring" ? r.rmsBezier : r.rmsSpring;
              let chart = null;
              if (r.curve && r.curve.length) {
                const maxMs = r.curve[r.curve.length - 1][0] || 1;
                const pcts = r.curve.map((p) => p[1]);
                const yMin = Math.min(0, Math.min(...pcts)) - 6, yMax = 102;
                const PX = (ms) => 42 + (ms / maxMs) * 578;
                const PY = (pct) => 16 + ((yMax - pct) / (yMax - yMin)) * 196;
                const pline = r.curve.map((p) => `${PX(p[0]).toFixed(1)},${PY(p[1]).toFixed(1)}`).join(" ");
                chart = (
                  <svg viewBox="0 0 640 240" style={{ width: "100%", maxWidth: 640, marginTop: 14 }}>
                    <line x1="42" y1={PY(0)} x2="620" y2={PY(0)} stroke={LINE} strokeWidth="1" />
                    <line x1="42" y1="16" x2="42" y2={PY(0)} stroke={LINE} strokeWidth="1" />
                    <polyline points={pline} fill="none" stroke={AMBER} strokeWidth="2.5" strokeLinecap="round" />
                    <text x="38" y={PY(100) + 4} textAnchor="end" fontSize="10" fill={MUT} fontFamily="monospace">100%</text>
                    <text x="38" y={PY(0) + 4} textAnchor="end" fontSize="10" fill={MUT} fontFamily="monospace">0</text>
                    <text x="620" y={PY(0) + 16} textAnchor="end" fontSize="10" fill={MUT} fontFamily="monospace">{maxMs} ms</text>
                  </svg>
                );
              }
              return (
                <div style={{ marginTop: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ background: AMBER, color: "#fff", borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: 500 }}>{badge}</span>
                    {r.durationMs != null && (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
                        {r.durationMs} ms · travel {r.travel}px
                      </span>
                    )}
                    {r.rows && (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: r.trust ? "#1D9E75" : "#C4453B" }}>
                        {r.trust ? "trustworthy" : "low confidence — treat as approximate"}
                      </span>
                    )}
                    {r.rows && typeof window !== "undefined" && window.location.search.includes("debug") && (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: MUT }}>
                        fit ±{winRms}px · alt ±{loseRms}px
                      </span>
                    )}
                    <Btn onClick={() => setAna({ stage: "idle" })}>clear</Btn>
                  </div>
                  {r.label === "gesture" && (
                    <div style={{ fontSize: 13, color: TXT, marginTop: 12, maxWidth: 560, lineHeight: 1.6 }}>
                      Motion keeps accelerating without settling — this looks finger-driven rather than a coded animation.
                      Peak velocity ~{r.peakVel}px/s. To measure the app's own animation, use a tap-triggered version,
                      or move the Start mark to the moment the finger releases.
                    </div>
                  )}
                  {(r.label === "none" || r.label === "unreliable") && (
                    <div style={{ fontSize: 13, color: TXT, marginTop: 12, maxWidth: 560, lineHeight: 1.6 }}>{r.message}</div>
                  )}
                  {chart}
                  {r.rows && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {r.rows.map((row, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <code style={{ fontFamily: MONO, fontSize: 12, color: TXT, background: "#F5F6F8", border: `1px solid ${LINE}`, borderRadius: 8, padding: "8px 12px" }}>{row}</code>
                          <Btn onClick={() => navigator.clipboard && navigator.clipboard.writeText(row)}>copy</Btn>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {typeof window !== "undefined" && window.location.search.includes("debug") && debugRef.current && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: AMBER, marginTop: 14 }}>
                debug · video reports {debugRef.current.vw}×{debugRef.current.vh} · bitmap reports {debugRef.current.bw}×{debugRef.current.bh} · canvas is {meta.w}×{meta.h}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
