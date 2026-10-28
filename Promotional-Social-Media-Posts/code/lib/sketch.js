// Hand-drawn drawing helpers for canvas 2D.
// Every stroke is resampled and nudged along its normal with seeded noise. The seed
// combines the shape's local geometry with the current "boil" step, so lines stay put
// between boil steps and redraw slightly differently on each step (hand-animated look).
(function () {
  const TAU = Math.PI * 2;

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const ease = {
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    back: (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  // 0 -> 1 -> 0 pulse inside [a, b] with soft edges of width e
  const pulse = (t, a, b, e = 0.03) => Math.min(seg(t, a, a + e), 1 - seg(t, b - e, b));

  // ---------- geometry (all return arrays of [x, y]) ----------
  const G = {
    rect(x, y, w, h, r = 0) {
      if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      r = Math.min(r, w / 2, h / 2);
      const pts = [];
      const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
      corner(x + w - r, y + r, -Math.PI / 2);
      corner(x + w - r, y + h - r, 0);
      corner(x + r, y + h - r, Math.PI / 2);
      corner(x + r, y + r, Math.PI);
      return pts;
    },
    ellipse(cx, cy, rx, ry, n = 40) {
      const pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
      return pts;
    },
    circle(cx, cy, r, n) { return G.ellipse(cx, cy, r, r, n || Math.max(16, Math.round(r * 0.9))); },
    arc(cx, cy, rx, ry, a0, a1, n = 24) {
      const pts = [];
      for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
      return pts;
    },
    line(x1, y1, x2, y2) { return [[x1, y1], [x2, y2]]; },
    hex(cx, cy, r, rot = Math.PI / 2) {
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = rot + (i / 6) * TAU; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      return pts;
    },
    bezier(p0, p1, p2, p3, n = 30) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([
          u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
      return pts;
    },
    translate(pts, dx, dy) { return pts.map(([x, y]) => [x + dx, y + dy]); },
  };

  function bezierAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  }

  // ---------- the sketch pen ----------
  class Sketch {
    constructor(ctx, pal) {
      this.ctx = ctx;
      this.pal = pal;
      this.boil = 0;
      this.lw = 3.4;
      this.amp = 1.5;
    }

    rngFor(pts, salt) {
      const p = pts[0], q = pts[pts.length - 1];
      const k = `${Math.round(p[0])},${Math.round(p[1])},${Math.round(q[0])},${Math.round(q[1])},${pts.length},${salt},${this.boil}`;
      return mulberry32(hashStr(k));
    }

    resample(pts, closed, step = 7) {
      const src = closed ? pts.concat([pts[0]]) : pts;
      const out = [src[0]];
      for (let i = 1; i < src.length; i++) {
        const [x0, y0] = src[i - 1], [x1, y1] = src[i];
        const d = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.round(d / step));
        for (let j = 1; j <= n; j++) out.push([lerp(x0, x1, j / n), lerp(y0, y1, j / n)]);
      }
      if (closed) out.pop();
      return out;
    }

    wobble(pts, closed, amp, rng) {
      const n = pts.length;
      const f1 = 1 / (30 + rng() * 25), f2 = 1 / (9 + rng() * 6);
      const p1 = rng() * TAU, p2 = rng() * TAU;
      const out = [];
      let s = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
        const pa = !closed && i === 0 ? pts[i] : a;
        const pb = !closed && i === n - 1 ? pts[i] : b;
        let nx = -(pb[1] - pa[1]), ny = pb[0] - pa[0];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const o = amp * (0.65 * Math.sin(s * f1 + p1) + 0.35 * Math.sin(s * f2 + p2)) + (rng() - 0.5) * amp * 0.35;
        out.push([pts[i][0] + nx * o, pts[i][1] + ny * o]);
      }
      return out;
    }

    trace(pts, closed) {
      const c = this.ctx;
      c.beginPath();
      if (pts.length < 3) { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); if (closed) c.closePath(); return; }
      if (closed) {
        const m0 = [(pts[pts.length - 1][0] + pts[0][0]) / 2, (pts[pts.length - 1][1] + pts[0][1]) / 2];
        c.moveTo(m0[0], m0[1]);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        c.closePath();
      } else {
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        }
        const l = pts[pts.length - 1]; c.lineTo(l[0], l[1]);
      }
    }

    // wobbled stroke; closed shapes start at a random point and overshoot, like a pen loop
    strokePts(pts, closed, o = {}) {
      const amp = o.amp ?? this.amp;
      const rng = this.rngFor(pts, 's' + (o.salt || ''));
      let r = this.resample(pts, closed, o.step || 7);
      if (!closed && o.overshoot !== false && r.length > 1) {
        const ext = (a, b, k) => { const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.hypot(dx, dy) || 1; return [a[0] + (dx / l) * k, a[1] + (dy / l) * k]; };
        r = [ext(r[0], r[1], 1 + rng() * 3)].concat(r, [ext(r[r.length - 1], r[r.length - 2], 1 + rng() * 3)]);
      }
      let w = this.wobble(r, closed, amp, rng);
      if (closed) {
        const k = Math.floor(rng() * w.length);
        w = w.slice(k).concat(w.slice(0, k));
        const over = Math.max(2, Math.round(w.length * 0.06));
        const extra = w.slice(0, over).map(([x, y], i) => [x + (i + 1) * 0.35 * (rng() - 0.3), y + (i + 1) * 0.35 * (rng() - 0.3)]);
        w = w.concat(extra);
      }
      const c = this.ctx;
      c.save();
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = o.color || this.pal.ink;
      c.lineWidth = o.lw ?? this.lw;
      c.globalAlpha *= o.alpha ?? 1;
      if (o.dash) { c.setLineDash(o.dash); c.lineDashOffset = o.dashOffset || 0; }
      this.trace(w, false);
      c.stroke();
      if (o.double !== false && !o.dash && (o.lw ?? this.lw) >= 2.5) {
        // faint second pass: pencil re-trace
        const w2 = this.wobble(r, closed, amp * 0.9, mulberry32(hashStr('d' + this.boil + r.length + Math.round(r[0][0]))));
        c.lineWidth = (o.lw ?? this.lw) * 0.4;
        c.globalAlpha *= 0.45;
        this.trace(w2, closed);
        c.stroke();
      }
      c.restore();
      return w;
    }

    fillPts(pts, color, o = {}) {
      const rng = this.rngFor(pts, 'f' + (o.salt || ''));
      const w = this.wobble(this.resample(pts, true, 9), true, o.amp ?? 0.9, rng);
      const c = this.ctx;
      c.save();
      c.fillStyle = color;
      c.globalAlpha *= o.alpha ?? 1;
      this.trace(w, true);
      c.fill();
      c.restore();
    }

    // pencil hatching clipped to a shape, optionally to a second region (e.g. the shadow side)
    hatch(pts, o = {}) {
      const c = this.ctx;
      const gap = o.gap || 7, ang = o.angle ?? -0.9;
      // hatching keeps a fixed seed (no boil) so it doesn't strobe
      const saved = this.boil; if (!o.boil) this.boil = 0;
      const rng = this.rngFor(pts, 'h' + (o.salt || ''));
      this.boil = saved;
      c.save();
      this.trace(pts, true); c.clip();
      if (o.region) { this.trace(o.region, true); c.clip(); }
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, R = Math.hypot(maxX - minX, maxY - minY) / 2 + 4;
      const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
      c.strokeStyle = o.color || this.pal.ink;
      c.lineWidth = o.lw || 1.3;
      c.globalAlpha *= o.alpha ?? 0.5;
      c.lineCap = 'round';
      for (let d = -R; d <= R; d += gap) {
        const j = (rng() - 0.5) * gap * 0.35, aj = (rng() - 0.5) * 0.06;
        const ddx = Math.cos(ang + aj), ddy = Math.sin(ang + aj);
        const ox = cx + px * (d + j), oy = cy + py * (d + j);
        const L = R * (0.85 + rng() * 0.3);
        c.beginPath();
        c.moveTo(ox - ddx * L, oy - ddy * L);
        c.quadraticCurveTo(ox + px * (rng() - 0.5) * 2, oy + py * (rng() - 0.5) * 2, ox + ddx * L, oy + ddy * L);
        c.stroke();
      }
      c.restore();
    }

    // fill + optional hatch + ink outline
    shape(pts, o = {}) {
      const closed = o.closed !== false;
      if (o.fill && closed) this.fillPts(pts, o.fill, { salt: o.salt, alpha: o.fillAlpha });
      if (o.hatch && closed) this.hatch(pts, Object.assign({ salt: o.salt }, o.hatch));
      if (o.stroke !== false) this.strokePts(pts, closed, o);
    }
    line(x1, y1, x2, y2, o = {}) { return this.strokePts(G.line(x1, y1, x2, y2), false, o); }
    path(pts, o = {}) { return this.strokePts(pts, false, o); }

    // outlined tube along a path (arms, cables): ink casing then colour core, sharing one wobble
    tube(pts, width, color, o = {}) {
      const rng = this.rngFor(pts, 't' + (o.salt || ''));
      const w = this.wobble(this.resample(pts, false, 6), false, o.amp ?? 0.9, rng);
      const c = this.ctx;
      c.save();
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = this.pal.ink; c.lineWidth = width + (o.lw ?? this.lw) * 2;
      this.trace(w, false); c.stroke();
      c.strokeStyle = color; c.lineWidth = width;
      this.trace(w, false); c.stroke();
      if (o.shade !== false) {
        c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = width * 0.35;
        c.translate(width * 0.18, width * 0.18);
        this.trace(w, false); c.stroke();
      }
      c.restore();
    }

    arrowHead(x, y, ang, size = 14, o = {}) {
      this.path([[x - Math.cos(ang - 0.5) * size, y - Math.sin(ang - 0.5) * size], [x, y], [x - Math.cos(ang + 0.5) * size, y - Math.sin(ang + 0.5) * size]], Object.assign({ overshoot: false }, o));
    }

    glow(x, y, r, color, alpha = 1) {
      const c = this.ctx;
      c.save();
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalAlpha *= alpha; c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      c.restore();
    }

    text(str, x, y, o = {}) {
      const c = this.ctx;
      c.save();
      c.font = o.font || `600 28px Caveat`;
      c.fillStyle = o.color || this.pal.ink;
      c.textAlign = o.align || 'left';
      c.textBaseline = o.baseline || 'alphabetic';
      if (o.letterSpacing) c.letterSpacing = o.letterSpacing;
      c.globalAlpha *= o.alpha ?? 1;
      let rot = o.rot || 0, jx = 0, jy = 0;
      if (o.jitter) {
        const rng = mulberry32(hashStr(str + Math.round(x) + Math.round(y) + this.boil));
        rot += (rng() - 0.5) * 0.02; jx = (rng() - 0.5) * 1.2; jy = (rng() - 0.5) * 1.2;
      }
      c.translate(x + jx, y + jy);
      if (rot) c.rotate(rot);
      c.fillText(str, 0, 0);
      const w = c.measureText(str).width;
      c.restore();
      return w;
    }
  }

  // cream paper with grain, faint fibres and a soft vignette (drawn once, reused every frame)
  function makePaper(w, h, base, seed = 7) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h), d = img.data;
    const rng = mulberry32(seed);
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
    }
    c.putImageData(img, 0, 0);
    c.globalAlpha = 0.05; c.strokeStyle = '#6b5a3e'; c.lineWidth = 0.8;
    for (let i = 0; i < 260; i++) {
      const x = rng() * w, y = rng() * h, a = rng() * TAU, l = 6 + rng() * 22;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    c.globalAlpha = 1;
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(120,90,50,0)'); g.addColorStop(1, 'rgba(120,90,50,0.10)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    return cv;
  }

  window.SK = { Sketch, G, ease, seg, lerp, clamp01, pulse, makePaper, mulberry32, hashStr, bezierAt, TAU };
})();
