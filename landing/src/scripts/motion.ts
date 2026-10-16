const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = window.matchMedia("(pointer: fine)").matches;

function glow() {
  const el = document.getElementById("cursor-glow");
  if (!el || reduce || !fine) return;
  let x = innerWidth * 0.7;
  let y = innerHeight * 0.2;
  let tx = x;
  let ty = y;
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
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function loot() {
  const canvas = document.getElementById("loot") as HTMLCanvasElement | null;
  const hero = canvas?.parentElement;
  if (!canvas || !hero || reduce) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const dots = Array.from({ length: 28 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 1.2 + Math.random() * 2.4,
    s: 0.08 + Math.random() * 0.22,
    a: Math.random() * Math.PI * 2,
    hue: 270 + Math.random() * 40,
  }));
  let running = true;
  const resize = () => {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 1.5);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    running = document.visibilityState === "visible";
  });
  const draw = () => {
    if (running) {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        d.y += d.s / 180;
        d.a += 0.01;
        if (d.y > 1.05) d.y = -0.05;
        const x = d.x * width + Math.sin(d.a) * 12;
        const y = d.y * height;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${d.hue} 90% 72% / 0.55)`;
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = `hsla(${d.hue} 90% 85% / 0.9)`;
        ctx.moveTo(x, y - d.r * 1.6);
        ctx.lineTo(x + d.r * 1.1, y);
        ctx.lineTo(x, y + d.r * 1.6);
        ctx.lineTo(x - d.r * 1.1, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
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
      card.style.transform = "";
    });
  }
}

glow();
loot();
reveals();
counters();
tilt();
