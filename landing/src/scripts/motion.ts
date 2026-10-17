const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = window.matchMedia("(pointer: fine)").matches;

function onVisible(run: () => void, pause: () => void) {
  const sync = () => {
    if (document.visibilityState === "visible") run();
    else pause();
  };
  document.addEventListener("visibilitychange", sync);
  sync();
}

function glow() {
  const el = document.getElementById("cursor-glow");
  if (!el || reduce || !fine) return;
  let x = innerWidth * 0.7;
  let y = innerHeight * 0.2;
  let tx = x;
  let ty = y;
  let raf = 0;
  window.addEventListener(
    "pointermove",
    (event) => {
      tx = event.clientX;
      ty = event.clientY;
    },
    { passive: true },
  );
  const tick = () => {
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    el.style.transform = `translate3d(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight / 2}px, 0)`;
    raf = requestAnimationFrame(tick);
  };
  onVisible(
    () => {
      if (!raf) raf = requestAnimationFrame(tick);
    },
    () => {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  );
}

function loot() {
  const canvas = document.getElementById("loot") as HTMLCanvasElement | null;
  if (!canvas || reduce) return;
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;
  const area = innerWidth * innerHeight;
  const count = Math.min(52, Math.max(24, Math.round(area / 42000)));
  const dots = Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.9 + Math.random() * 1.8,
    s: 0.05 + Math.random() * 0.16,
    a: Math.random() * Math.PI * 2,
    hue: 268 + Math.random() * 36,
  }));
  let w = 0;
  let h = 0;
  let raf = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.y += d.s / 220;
      d.a += 0.008;
      if (d.y > 1.06) d.y = -0.06;
      const x = d.x * w + Math.sin(d.a) * 10;
      const y = d.y * h;
      ctx.fillStyle = `hsla(${d.hue} 88% 74% / 0.38)`;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${d.hue} 90% 86% / 0.62)`;
      ctx.beginPath();
      ctx.moveTo(x, y - d.r * 1.55);
      ctx.lineTo(x + d.r, y);
      ctx.lineTo(x, y + d.r * 1.55);
      ctx.lineTo(x - d.r, y);
      ctx.closePath();
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  onVisible(
    () => {
      if (!raf) raf = requestAnimationFrame(draw);
    },
    () => {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  );
}

function videoFacade() {
  const host = document.querySelector<HTMLElement>("[data-video-host]");
  const trigger = host?.querySelector<HTMLButtonElement>("[data-video-facade]");
  if (!host || !trigger) return;
  const load = () => {
    const id = trigger.dataset.videoId;
    if (!id) return;
    trigger.classList.add("is-loading");
    trigger.setAttribute("aria-busy", "true");
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
    iframe.title = trigger.dataset.videoTitle || "DropHunter promo";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    trigger.replaceWith(iframe);
  };
  trigger.addEventListener("click", load, { once: true });
}

function reveals() {
  const nodes = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!nodes.length) return;
  if (reduce) {
    for (const node of nodes) node.classList.add("is-in");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
  );
  for (const node of nodes) {
    node.classList.add("js-reveal");
    io.observe(node);
  }
}

function counters() {
  const nodes = document.querySelectorAll<HTMLElement>("[data-count]");
  if (!nodes.length) return;
  const run = (el: HTMLElement) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix ?? "";
    if (reduce || Number.isNaN(target)) {
      el.textContent = `${target}${suffix}`;
      return;
    }
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          run(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.5 },
  );
  for (const node of nodes) io.observe(node);
}

function tilt() {
  if (reduce || !fine) return;
  const cards = document.querySelectorAll<HTMLElement>("[data-tilt]");
  for (const card of cards) {
    card.addEventListener("pointermove", (event) => {
      const r = card.getBoundingClientRect();
      const px = (event.clientX - r.left) / r.width - 0.5;
      const py = (event.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${px * -12}deg) rotateX(${py * 8}deg) translateZ(12px)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("transform");
    });
  }
}

function shinePreview() {
  if (new URLSearchParams(location.search).get("shine") === "mid") {
    document.documentElement.classList.add("shine-mid");
  }
}

glow();
loot();
videoFacade();
reveals();
counters();
tilt();
shinePreview();
