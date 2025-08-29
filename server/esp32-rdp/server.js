import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import http from 'http';
import url from 'url';
import sharp from 'sharp';
import xxhash from 'xxhash-wasm';

const URL              = process.env.TARGET_URL    || 'http://homeassistant:8123/lovelace';
const WS_PORT          = +process.env.WS_PORT      || 8081;
const DEBUG_PORT       = +process.env.DEBUG_PORT   || 9222;
const HEALTH_PORT      = +process.env.HEALTH_PORT  || 18080;
const USER_DATA_DIR    = process.env.USER_DATA_DIR || '/pw-data';

const VIEWPORT_W       = +process.env.VIEWPORT_W   || 480;
const VIEWPORT_H       = +process.env.VIEWPORT_H   || 480;
const TILE             = +process.env.TILE         || 24;
const EVERY_NTH_FRAME  = +process.env.EVERY_NTH_FRAME || 5;
const FULLFRAME_EVERY  = +process.env.FULLFRAME_EVERY || 50;

const wss = new WebSocketServer({ port: WS_PORT, perMessageDeflate: false });

let page, cdp;
http.createServer(async (req, res) => {
  try {
    const u = url.parse(req.url, true);
    if (u.pathname === '/tap') {
      const k = Math.max(0, Math.min(+u.query.k || 3, 3)); // 0/1/2/3
      const x = Math.max(0, Math.min(+u.query.x || 240, VIEWPORT_W - 1));
      const y = Math.max(0, Math.min(+u.query.y || 240, VIEWPORT_H - 1));
      const { xCss, yCss } = await toCssCoords(x, y);
      await clickCDP(k, xCss, yCss);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`tap(${k},${x},${y}) -> cdp(${xCss},${yCss})\n`);
      return;
    }
    res.writeHead(200); res.end('ok');
  } catch (e) {
    res.writeHead(500); res.end('err');
  }
}).listen(HEALTH_PORT);

let metricsCache = { ts: 0, visual: null };
async function refreshMetrics() {
  try {
    const m = await cdp.send('Page.getLayoutMetrics');
    metricsCache = { ts: Date.now(), visual: m.visualViewport };
  } catch {}
}
async function toCssCoords(espX, espY) {
  const now = Date.now();
  if (!metricsCache.visual || now - metricsCache.ts > 200) {
    await refreshMetrics();
  }
  const v = metricsCache.visual || { pageX: 0, pageY: 0, clientWidth: VIEWPORT_W, clientHeight: VIEWPORT_H, scale: 1 };
  const scaleX = v.clientWidth  / VIEWPORT_W;
  const scaleY = v.clientHeight / VIEWPORT_H;
  const xCss = Math.round(espX * scaleX + v.pageX);
  const yCss = Math.round(espY * scaleY + v.pageY);
  return { xCss, yCss };
}

async function clickCDP(kind, xCss, yCss) {
  // kind: 0=down,1=move,2=up,3=tap
  try {
    if (kind === 0) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xCss, y: yCss, buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xCss, y: yCss, button: 'left', buttons: 1, clickCount: 1 });
    } else if (kind === 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xCss, y: yCss, buttons: 1 });
    } else if (kind === 2) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xCss, y: yCss, button: 'left', buttons: 0, clickCount: 1 });
    } else if (kind === 3) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xCss, y: yCss, buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xCss, y: yCss, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xCss, y: yCss, button: 'left', buttons: 0, clickCount: 1 });
    }
  } catch (e) {
  }
}

let lastMoveAt = 0;
wss.on('connection', (ws) => {
  ws.on('message', async (data, isBinary) => {
    if (!isBinary) return;
    if (!Buffer.isBuffer(data) || data.length < 9) return;
    if (data.slice(0, 4).toString('ascii') !== 'TOUC') return;

    const kind = data.readUInt8(4);       // 0/1/2/3
    const x = data.readUInt16LE(5);
    const y = data.readUInt16LE(7);

    if (kind === 1) {
      const now = Date.now();
      if (now - lastMoveAt < 12) return;
      lastMoveAt = now;
    }

    const { xCss, yCss } = await toCssCoords(x, y);
    clickCDP(kind, xCss, yCss);
  });
});

(async () => {
  console.log('[rdp] starting. target:', URL);

  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    hasTouch: false,
    isMobile: true,
    args: [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1',
      '--headless=new'
    ]
  });

  const antiAnimCSS = `
    * { animation: none !important; transition: none !important; }
    html, body { overscroll-behavior: none; }
  `;
  await ctx.addInitScript(({ css }) => {
    try {
      const s = document.createElement('style'); s.setAttribute('data-rdp','anti-anim');
      s.textContent = css; (document.head || document.documentElement).appendChild(s);
    } catch {}
  }, { css: antiAnimCSS });

  page = await ctx.newPage();
  cdp  = await page.context().newCDPSession(page);
  try { await cdp.send('Page.enable'); } catch {}
  try { await cdp.send('Page.setWebLifecycleState', { state: 'active' }); } catch {}
  try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); } catch {}

  page.on('framenavigated', fr => { if (fr === page.mainFrame()) console.log('[nav]', fr.url().slice(0,120)); });
  page.on('console', m => console.log('[page.console]', m.type(), m.text()));
  page.on('requestfailed', r => { const f = r.failure(); console.log('[net.fail]', r.method(), r.url(), f && f.errorText); });

  await withTimeout(page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }), 32000, 'goto');

  const { h32Raw } = await xxhash();
  let cols = Math.ceil(VIEWPORT_W / TILE);
  let rows = Math.ceil(VIEWPORT_H / TILE);
  let prevHashes = new Uint32Array(cols * rows);
  let frameIdx = 0;

  function ensureGrid(w, h) {
    const newCols = Math.ceil(w / TILE);
    const newRows = Math.ceil(h / TILE);
    if (newCols !== cols || newRows !== rows) {
      cols = newCols; rows = newRows;
      prevHashes = new Uint32Array(cols * rows);
    }
  }

  cdp.on('Page.screencastFrame', async (evt) => {
    try {
      // evt: { data (base64 png/jpg), metadata:{ deviceScaleFactor, pageScaleFactor, offsetTop/Left, ...}, sessionId }
      const b = Buffer.from(evt.data, 'base64');
      const meta = evt.metadata || {};

      cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(()=>{});

      const { data: rgba, info } = await sharp(b).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      const w = info.width, h = info.height;
      ensureGrid(w, h);

      const fullFrame = (frameIdx % FULLFRAME_EVERY === 0);
      const rects = [];

      for (let ty=0; ty<rows; ty++) {
        for (let tx=0; tx<cols; tx++) {
          const x = tx * TILE, y = ty * TILE;
          const ww = Math.min(TILE, w - x);
          const hh = Math.min(TILE, h - y);
          if (ww <= 0 || hh <= 0) continue;

          const tile = Buffer.allocUnsafe(ww * hh * 4);
          for (let yy=0; yy<hh; yy++) {
            const src = ((y + yy) * w + x) * 4;
            rgba.copy(tile, yy * ww * 4, src, src + ww * 4);
          }

          const idx = ty * cols + tx;
          const hash = h32Raw(tile, 0xC0FFEE);

          if (fullFrame || prevHashes[idx] !== hash) {
            const tilePng = await sharp(tile, { raw: { width: ww, height: hh, channels: 4 } })
              .png({ compressionLevel: 9 })
              .toBuffer();
            rects.push({ x, y, w: ww, h: hh, data: tilePng });
            prevHashes[idx] = hash;
          }
        }
      }

      if (rects.length && wss.clients.size) {
        const MAX_BYTES_PER_TICK = 1024 * 1024;
        let sent = 0;
        for (const r of rects) {
          const header = Buffer.alloc(17);
          header.write('TILE', 0);
          header.writeUInt8(0, 4); // 0 = PNG
          header.writeUInt16LE(r.x, 5);
          header.writeUInt16LE(r.y, 7);
          header.writeUInt16LE(r.w, 9);
          header.writeUInt16LE(r.h, 11);
          header.writeUInt32LE(r.data.length, 13);
          const frame = Buffer.concat([header, r.data]);
          if (sent + frame.length > MAX_BYTES_PER_TICK) break;
          sent += frame.length;
          for (const c of wss.clients) { try { c.send(frame, { binary: true }); } catch {} }
        }
      }

      frameIdx++;
    } catch (e) {
    }
  });

  await cdp.send('Page.startScreencast', {
    format: 'png',
    quality: 100,
    maxWidth: VIEWPORT_W,
    maxHeight: VIEWPORT_H,
    everyNthFrame: EVERY_NTH_FRAME
  });

  console.log(`[rdp] ready. URL ${URL} | WS :${WS_PORT} | DevTools :${DEBUG_PORT} | health :${HEALTH_PORT}`);
})().catch((e) => {
  console.error('[rdp] fatal:', e);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`[rdp] ${sig}`); process.exit(0); });
}
