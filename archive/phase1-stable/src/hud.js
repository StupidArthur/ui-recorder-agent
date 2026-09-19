(function () {
  if (window.__hud && window.__hud.__ready) return;

  const Z = 2147483000;
  let els = null;

  const CSS = `
  .__hud-root,.__hud-root *{box-sizing:border-box;margin:0;padding:0;font-family:"Microsoft YaHei",-apple-system,"Segoe UI",sans-serif;}
  .__hud-root{position:fixed;inset:0;pointer-events:none;z-index:${Z};}
  .__hud-cursor{position:fixed;left:0;top:0;width:26px;height:26px;will-change:transform;opacity:0;
    transition:transform .5s cubic-bezier(.22,.61,.36,1),opacity .25s ease;
    filter:drop-shadow(0 6px 10px rgba(16,22,40,.35));}
  .__hud-cursor.show{opacity:1;}
  .__hud-halo{position:fixed;left:0;top:0;width:46px;height:46px;border-radius:50%;will-change:transform,opacity;
    background:radial-gradient(circle,rgba(59,110,246,.35),rgba(59,110,246,0) 68%);
    transition:transform .5s cubic-bezier(.22,.61,.36,1),opacity .25s ease;opacity:0;}
  .__hud-halo.show{opacity:1;}
  .__hud-ring{position:fixed;border:2px solid #3b6ef6;border-radius:12px;opacity:0;
    box-shadow:0 0 0 4px rgba(59,110,246,.16),0 0 22px rgba(59,110,246,.45);
    transition:all .28s cubic-bezier(.22,.61,.36,1);}
  .__hud-ring.show{opacity:1;}
  .__hud-ring.pulse{animation:__hud-pulse 1.15s ease-in-out infinite;}
  @keyframes __hud-pulse{0%,100%{box-shadow:0 0 0 4px rgba(59,110,246,.16),0 0 20px rgba(59,110,246,.35)}
    50%{box-shadow:0 0 0 9px rgba(59,110,246,.08),0 0 30px rgba(59,110,246,.6)}}
  .__hud-tip{position:fixed;transform:translate(-50%,-100%);background:#17203a;color:#fff;font-size:12.5px;font-weight:600;
    padding:6px 11px;border-radius:8px;white-space:nowrap;opacity:0;transition:opacity .25s ease;letter-spacing:.3px;
    box-shadow:0 10px 22px rgba(16,22,40,.3);}
  .__hud-tip.show{opacity:1;}
  .__hud-tip:after{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%);
    border:6px solid transparent;border-top-color:#17203a;border-bottom:0;}
  .__hud-caption{position:fixed;left:28px;bottom:28px;max-width:640px;display:flex;gap:14px;align-items:center;
    background:rgba(17,23,41,.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.1);
    padding:14px 20px 14px 16px;border-radius:14px;color:#fff;opacity:0;transform:translateY(14px);
    transition:opacity .32s ease,transform .32s cubic-bezier(.22,.61,.36,1);box-shadow:0 20px 44px rgba(16,22,40,.35);}
  .__hud-caption.show{opacity:1;transform:translateY(0);}
  .__hud-step{flex:none;width:42px;height:42px;border-radius:11px;display:grid;place-items:center;font-size:13px;font-weight:800;
    background:linear-gradient(135deg,#3b6ef6,#7a5cf0);color:#fff;letter-spacing:.5px;}
  .__hud-txt{min-width:0;}
  .__hud-title{font-size:15.5px;font-weight:700;line-height:1.25;}
  .__hud-detail{font-size:12.5px;color:#a9b4cf;margin-top:3px;line-height:1.35;}
  .__hud-progress{position:fixed;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.08);}
  .__hud-bar{height:100%;width:0;background:linear-gradient(90deg,#3b6ef6,#7a5cf0);transition:width .4s ease;}
  .__hud-ripple{position:fixed;width:14px;height:14px;border-radius:50%;border:2px solid rgba(59,110,246,.9);
    transform:translate(-50%,-50%) scale(.4);opacity:0;}
  .__hud-ripple.go{animation:__hud-ripple .55s ease-out forwards;}
  @keyframes __hud-ripple{0%{opacity:.9;transform:translate(-50%,-50%) scale(.4)}
    100%{opacity:0;transform:translate(-50%,-50%) scale(4.2)}}
  .__hud-card{position:fixed;inset:0;display:grid;place-items:center;background:#0f1526;opacity:0;
    transition:opacity .45s ease;}
  .__hud-card.show{opacity:1;}
  .__hud-card .inner{text-align:center;color:#fff;transform:translateY(10px);transition:transform .5s cubic-bezier(.22,.61,.36,1);}
  .__hud-card.show .inner{transform:translateY(0);}
  .__hud-card .big{font-size:40px;font-weight:800;letter-spacing:1px;
    background:linear-gradient(135deg,#7fa1ff,#c3aaff);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .__hud-card .sm{margin-top:12px;font-size:14px;color:#9aa6c4;letter-spacing:2px;}
  `;

  function ensure() {
    if (els) return els;
    const style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    const root = document.createElement('div');
    root.className = '__hud-root';
    root.innerHTML = `
      <div class="__hud-halo"></div>
      <svg class="__hud-cursor" viewBox="0 0 24 24" fill="none">
        <path d="M4 2.5 19.5 10.2c1.1.5 1 2.1-.2 2.4l-5.6 1.5-2.4 5.6c-.5 1.2-2.1 1.1-2.4-.2L2.5 4.1C2.2 3 3 2 4 2.5Z"
          fill="#fff" stroke="#17203a" stroke-width="1.4"/>
      </svg>
      <div class="__hud-ring"></div>
      <div class="__hud-tip"></div>
      <div class="__hud-caption">
        <div class="__hud-step">1/1</div>
        <div class="__hud-txt"><div class="__hud-title"></div><div class="__hud-detail"></div></div>
      </div>
      <div class="__hud-progress"><div class="__hud-bar"></div></div>
      <div class="__hud-card"><div class="inner"><div class="big"></div><div class="sm"></div></div></div>`;
    document.body.appendChild(root);

    els = {
      root,
      cursor: root.querySelector('.__hud-cursor'),
      halo: root.querySelector('.__hud-halo'),
      ring: root.querySelector('.__hud-ring'),
      tip: root.querySelector('.__hud-tip'),
      caption: root.querySelector('.__hud-caption'),
      step: root.querySelector('.__hud-step'),
      title: root.querySelector('.__hud-title'),
      detail: root.querySelector('.__hud-detail'),
      bar: root.querySelector('.__hud-bar'),
      card: root.querySelector('.__hud-card'),
      cardBig: root.querySelector('.__hud-card .big'),
      cardSm: root.querySelector('.__hud-card .sm'),
      cx: 0, cy: 0,
    };
    return els;
  }

  const api = {
    __ready: true,

    init() { ensure(); },

    caption(step, total, title, detail) {
      const e = ensure();
      e.step.textContent = step + '/' + total;
      e.title.textContent = title || '';
      e.detail.textContent = detail || '';
      e.caption.classList.add('show');
      e.bar.style.width = (step / total) * 100 + '%';
    },
    hideCaption() { ensure().caption.classList.remove('show'); },

    moveCursor(x, y) {
      const e = ensure();
      e.cx = x; e.cy = y;
      e.cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
      e.halo.style.transform = `translate(${x - 23}px, ${y - 23}px)`;
      e.cursor.classList.add('show');
      e.halo.classList.add('show');
    },

    highlight(rect, tip) {
      const e = ensure();
      const pad = 6;
      e.ring.style.left = (rect.x - pad) + 'px';
      e.ring.style.top = (rect.y - pad) + 'px';
      e.ring.style.width = (rect.width + pad * 2) + 'px';
      e.ring.style.height = (rect.height + pad * 2) + 'px';
      e.ring.classList.add('show', 'pulse');
      if (tip) {
        e.tip.textContent = tip;
        e.tip.style.left = (rect.x + rect.width / 2) + 'px';
        e.tip.style.top = (rect.y - pad - 8) + 'px';
        e.tip.classList.add('show');
      }
    },
    clearHighlight() {
      const e = ensure();
      e.ring.classList.remove('show', 'pulse');
      e.tip.classList.remove('show');
    },

    ripple(x, y) {
      const e = ensure();
      const r = document.createElement('div');
      r.className = '__hud-ripple';
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      e.root.appendChild(r);
      requestAnimationFrame(() => r.classList.add('go'));
      setTimeout(() => r.remove(), 700);
    },

    card(big, sm) {
      const e = ensure();
      e.cardBig.textContent = big || '';
      e.cardSm.textContent = sm || '';
      e.card.style.display = 'grid';
      requestAnimationFrame(() => e.card.classList.add('show'));
    },
    hideCard() {
      const e = ensure();
      e.card.classList.remove('show');
      setTimeout(() => { e.card.style.display = 'none'; }, 500);
    },

    badge(text) {
      const e = ensure();
      e.step.textContent = text;
    },
  };

  window.__hud = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensure());
  } else {
    ensure();
  }
})();
