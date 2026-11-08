// 効果音を Chromium の OfflineAudioContext で書き出し、聴感の大きさなどを測る。
//
//   node tools/measure-sfx.mjs                 … 一覧を表で出す
//   node tools/measure-sfx.mjs --json          … JSON で出す
//   node tools/measure-sfx.mjs --wav <dir>     … WAV も書き出す（試聴用）
//   node tools/measure-sfx.mjs --png <dir>     … スペクトログラムの画像も書き出す
//
// Playwright と Chromium が必要（アプリの実行やテストには不要）。
// 測るもの：
//   peak      … いちばん大きい瞬間（dBFS）。-1 を超えると割れるおそれ
//   loud      … K特性で重みづけした 100ms ごとの大きさの最大（LUFS 相当）。聴感の大きさ
//   phone     … 同じ測り方で、600Hz 以下を落としたもの（スマホのスピーカーで聞いたときの目安）
//   harsh     … 2.5〜5.5kHz（耳に刺さりやすい帯域）にあるエネルギーの割合
//   centroid  … スペクトルの重心（Hz）。高いほど「鋭く」聞こえる
//   length    … ピークから 60dB 下がるまでの長さ（秒）
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 端末に入っている Playwright を require で探す（package.json の依存には入れない）。
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const wavDir = option("--wav");
const pngDir = option("--png");
const only = option("--only");
const seeds = Number(option("--seeds") ?? 3);

const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><meta charset=utf-8><body style='margin:0;background:#000'></body>");
    return;
  }
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 260 } });
await page.goto(`${origin}/`);

const results = await page.evaluate(async ({ only, seeds, wantWav }) => {
  const sfx = await import("/src/sfx.js");
  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const biquad = (input, [b0, b1, b2, a1, a2]) => {
    const output = new Float32Array(input.length);
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < input.length; i += 1) {
      const x = input[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      output[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return output;
  };
  // ITU-R BS.1770 の K特性（48kHz）
  const kWeight = (data) => biquad(
    biquad(data, [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]),
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  );
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (-2 * Math.PI) / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k += 1) {
          const wr = Math.cos(angle * k); const wi = Math.sin(angle * k);
          const ur = re[i + k]; const ui = im[i + k];
          const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
          const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        }
      }
    }
  };
  const ids = only ? only.split(",") : sfx.SFX_SOUND_IDS;
  const out = [];
  for (const id of ids) {
    const runs = [];
    let firstBuffer = null;
    for (let seed = 1; seed <= seeds; seed += 1) {
      const buffer = await sfx.renderSfx(id, { OfflineContextClass: OfflineAudioContext, random: mulberry32(seed * 7919), seconds: 3.2 });
      if (!firstBuffer) firstBuffer = buffer;
      const rate = buffer.sampleRate;
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      let peak = 0;
      let last = 0;
      for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      for (let i = left.length - 1; i >= 0; i -= 1) {
        if (Math.max(Math.abs(left[i]), Math.abs(right[i])) > peak * 0.001) { last = i; break; }
      }
      const kl = kWeight(left);
      const kr = kWeight(right);
      // スマホのスピーカーは低い音がほとんど出ない。600Hz 以下を急に落として同じように測る。
      const highpass = (data) => {
        const w = (2 * Math.PI * 600) / rate;
        const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
        const a0 = 1 + alpha;
        const c = [(1 + Math.cos(w)) / 2 / a0, -(1 + Math.cos(w)) / a0, (1 + Math.cos(w)) / 2 / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
        return biquad(biquad(data, c), c);
      };
      const pl = highpass(kl);
      const pr = highpass(kr);
      const windowSize = Math.floor(rate * 0.1);
      const hop = Math.floor(rate * 0.01);
      const maxMeanSquare = (a, b) => {
        let best = 0;
        for (let start = 0; start + windowSize <= a.length; start += hop) {
          let sum = 0;
          for (let i = start; i < start + windowSize; i += 1) sum += a[i] * a[i] + b[i] * b[i];
          best = Math.max(best, sum / windowSize);
        }
        return best;
      };
      const maxMs = maxMeanSquare(kl, kr);
      const phoneMs = maxMeanSquare(pl, pr);
      const size = 1 << 17;
      const re = new Float32Array(size);
      const im = new Float32Array(size);
      for (let i = 0; i < Math.min(size, left.length); i += 1) re[i] = (left[i] + right[i]) / 2;
      fft(re, im);
      let total = 0; let harsh = 0; let weighted = 0;
      for (let k = 1; k < size / 2; k += 1) {
        const frequency = (k * rate) / size;
        const power = re[k] * re[k] + im[k] * im[k];
        total += power;
        weighted += power * frequency;
        if (frequency >= 2500 && frequency <= 5500) harsh += power;
      }
      runs.push({
        peak: 20 * Math.log10(peak || 1e-9),
        loud: -0.691 + 10 * Math.log10(maxMs || 1e-12),
        phone: -0.691 + 10 * Math.log10(phoneMs || 1e-12),
        harsh: total ? harsh / total : 0,
        centroid: total ? weighted / total : 0,
        length: last / rate,
        finite: Number.isFinite(peak),
      });
    }
    const mean = (key) => runs.reduce((sum, run) => sum + run[key], 0) / runs.length;
    const entry = {
      id,
      peak: Math.max(...runs.map((run) => run.peak)),
      loud: mean("loud"),
      phone: mean("phone"),
      loudSpread: Math.max(...runs.map((run) => run.loud)) - Math.min(...runs.map((run) => run.loud)),
      harsh: mean("harsh"),
      centroid: mean("centroid"),
      length: mean("length"),
      finite: runs.every((run) => run.finite),
    };
    if (wantWav) {
      const length = Math.min(firstBuffer.length, Math.ceil((entry.length + 0.15) * firstBuffer.sampleRate));
      const pcm = new Int16Array(length * 2);
      const l = firstBuffer.getChannelData(0);
      const r = firstBuffer.getChannelData(1);
      for (let i = 0; i < length; i += 1) {
        pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      }
      let binary = "";
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      entry.pcm = btoa(binary);
      entry.rate = firstBuffer.sampleRate;
      // スペクトログラム（対数の周波数軸 60Hz〜16kHz、上が高い音）
      const canvas = document.createElement("canvas");
      canvas.width = 900; canvas.height = 260;
      const g = canvas.getContext("2d");
      g.fillStyle = "#000"; g.fillRect(0, 0, 900, 260);
      const mono = new Float32Array(length);
      for (let i = 0; i < length; i += 1) mono[i] = (l[i] + r[i]) / 2;
      const n = 2048; const hopSize = Math.max(64, Math.floor(length / 900));
      const columns = Math.min(900, Math.floor((length - n) / hopSize));
      for (let column = 0; column < columns; column += 1) {
        const fr = new Float32Array(n); const fi = new Float32Array(n);
        for (let i = 0; i < n; i += 1) fr[i] = (mono[column * hopSize + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
        fft(fr, fi);
        for (let y = 0; y < 260; y += 1) {
          const frequency = 60 * (16000 / 60) ** ((259 - y) / 259);
          const bin = Math.round((frequency * n) / firstBuffer.sampleRate);
          const magnitude = Math.hypot(fr[bin], fi[bin]);
          const db = 20 * Math.log10(magnitude + 1e-9);
          const v = Math.max(0, Math.min(1, (db + 70) / 70));
          g.fillStyle = `hsl(${(1 - v) * 240},100%,${v * 55}%)`;
          g.fillRect(column, y, 1, 1);
        }
      }
      // 2.5〜5.5kHz の帯に印
      g.strokeStyle = "rgba(255,255,255,.35)";
      for (const frequency of [2500, 5500]) {
        const y = 259 - (259 * Math.log(frequency / 60)) / Math.log(16000 / 60);
        g.beginPath(); g.moveTo(0, y); g.lineTo(900, y); g.stroke();
      }
      entry.png = canvas.toDataURL("image/png").split(",")[1];
    }
    out.push(entry);
  }
  return out;
}, { only, seeds, wantWav: Boolean(wavDir || pngDir) });

await browser.close();
server.close();

function writeWav(file, base64, rate) {
  const data = Buffer.from(base64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

for (const entry of results) {
  if (wavDir && entry.pcm) {
    fs.mkdirSync(wavDir, { recursive: true });
    writeWav(path.join(wavDir, `${entry.id}.wav`), entry.pcm, entry.rate);
  }
  if (pngDir && entry.png) {
    fs.mkdirSync(pngDir, { recursive: true });
    fs.writeFileSync(path.join(pngDir, `${entry.id}.png`), Buffer.from(entry.png, "base64"));
  }
  delete entry.pcm;
  delete entry.png;
  delete entry.rate;
}

if (args.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pad = (value, width) => String(value).padStart(width);
  console.log(`${"id".padEnd(18)}${pad("peak", 8)}${pad("loud", 8)}${pad("±", 6)}${pad("phone", 8)}${pad("harsh", 8)}${pad("centroid", 10)}${pad("length", 8)}`);
  for (const entry of results) {
    console.log(
      `${entry.id.padEnd(18)}${pad(entry.peak.toFixed(1), 8)}${pad(entry.loud.toFixed(1), 8)}${pad(entry.loudSpread.toFixed(1), 6)}${pad(entry.phone.toFixed(1), 8)}`
      + `${pad(`${(entry.harsh * 100).toFixed(1)}%`, 8)}${pad(Math.round(entry.centroid), 10)}${pad(entry.length.toFixed(2), 8)}${entry.finite ? "" : "  NaN!"}`,
    );
  }
}
