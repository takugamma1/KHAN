/*
  KHAN — scroll choreography engine.
  Source of truth: KHAN_animation_spec.md (Shopify OS 2.0 + GSAP 3.x + ScrollTrigger).

  Architecture
  ------------
  - One ScrollTrigger / timeline PER scene. Pinned scenes own their own trigger,
    use pinSpacing:true + anticipatePin:1, and run sequentially (never overlap).
  - Init contract: each section renders a root `[data-khan-scene="<name>"]`. On
    DOMContentLoaded AND on shopify:section:load we (re)initialise the scene(s) in
    scope and call ScrollTrigger.refresh(). Refresh again after fonts load.
  - prefers-reduced-motion: no pinning, no scrubbing — every scene jumps to its
    final/poster composition statically.

  Reusable helpers (named per spec): scrubSequence (A), scrubVideoOnce (B),
  pinnedScene (C), staggerReveal (D). Pattern E (logo pulse) is pure CSS.

  DOM contract is documented at each KHAN.register(...) initializer below; sections
  must render matching layer classes. Initializers no-op gracefully when a layer is
  absent, so sections can be scaffolded with placeholders and filled in as assets land.
*/
(function () {
  'use strict';

  var KHAN = (window.KHAN = window.KHAN || {});
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  KHAN.reducedMotion = REDUCED;

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* Draw an image "cover" onto a canvas (full-bleed, no distortion), DPR-aware. */
  function drawCover(canvas, img) {
    if (!img || !img.complete || !img.naturalWidth) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth || canvas.width;
    var ch = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    var s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    var w = img.naturalWidth * s, h = img.naturalHeight * s;
    var x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, x, y, w, h);
  }

  /* Pick the right sequence base path for the current viewport. */
  function seqBase(canvas) {
    var mobile = canvas.getAttribute('data-seq-base-mobile');
    if (mobile && window.matchMedia('(max-width: 749px)').matches) return mobile;
    return canvas.getAttribute('data-seq-base');
  }

  /* ---- PATTERN A — scroll-scrub image sequence onto a canvas ---- */
  KHAN.scrubSequence = function (opts) {
    var canvas = opts.canvas;
    if (!canvas) return null;
    var base = opts.basePath || seqBase(canvas);
    var frameCount = opts.frameCount || parseInt(canvas.getAttribute('data-seq-frames'), 10) || 0;
    if (!base || !frameCount) return null;

    var pad = opts.pad || 4;
    var ext = opts.ext || 'webp';
    var images = [];
    for (var i = 0; i < frameCount; i++) {
      var img = new Image();
      img.src = base + String(i).padStart(pad, '0') + '.' + ext;
      images.push(img);
    }
    var state = { frame: 0 };
    function render() { drawCover(canvas, images[state.frame]); }
    if (images[0]) images[0].onload = render;
    window.addEventListener('resize', render);

    if (REDUCED || !window.gsap) { return { render: render }; }

    return gsap.to(state, {
      frame: frameCount - 1,
      ease: 'none',
      snap: 'frame',
      scrollTrigger: {
        trigger: opts.trigger || canvas,
        start: opts.start || 'top top',
        end: '+=' + (opts.scrollLength || '300%'),
        scrub: opts.scrub != null ? opts.scrub : true,
        pin: opts.pin != null ? opts.pin : false,
        anticipatePin: 1
      },
      onUpdate: render
    });
  };

  /* ---- PATTERN B — scrub an MP4's currentTime by scroll, freeze at end ---- */
  KHAN.scrubVideoOnce = function (opts) {
    var video = opts.video;
    if (!video) return null;
    video.pause();
    video.removeAttribute('autoplay');
    video.removeAttribute('loop');
    video.muted = true;
    video.playsInline = true;

    if (REDUCED || !window.gsap || !window.ScrollTrigger) return null; // poster holds

    var dur = 0;
    function ready() { dur = video.duration || 0; }
    if (video.readyState >= 1) ready();
    else video.addEventListener('loadedmetadata', ready, { once: true });

    return ScrollTrigger.create({
      trigger: opts.trigger || video,
      start: opts.start || 'top top',
      end: '+=' + (opts.scrollLength || '150%'),
      scrub: opts.scrub != null ? opts.scrub : true,
      pin: opts.pin != null ? opts.pin : true,
      anticipatePin: 1,
      onUpdate: function (self) { if (dur) video.currentTime = self.progress * dur; }
    });
  };

  /* ---- PATTERN C — pinned multi-layer scene ---- */
  KHAN.pinnedScene = function (opts) {
    var trigger = opts.trigger;
    if (!trigger || !window.gsap) return null;

    if (REDUCED || !window.ScrollTrigger) {
      // no pin/scrub: build the timeline detached and jump to the end composition
      var still = gsap.timeline({ paused: true });
      if (opts.build) opts.build(still);
      still.progress(1, false);
      return still;
    }
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: trigger,
        start: opts.start || 'top top',
        end: '+=' + (opts.scrollLength || '260%'),
        scrub: opts.scrub != null ? opts.scrub : true,
        pin: opts.pin != null ? opts.pin : true,
        pinSpacing: true,
        anticipatePin: 1
      }
    });
    if (opts.build) opts.build(tl);
    return tl;
  };

  /* ---- PATTERN D — stagger reveal on enter (no pin) ---- */
  KHAN.staggerReveal = function (opts) {
    var items = opts.items;
    if (!items || !items.length || !window.gsap) return null;
    if (REDUCED || !window.ScrollTrigger) {
      gsap.set(items, { opacity: 1, y: 0 });
      return null;
    }
    return gsap.from(items, {
      scrollTrigger: { trigger: opts.trigger || items[0], start: opts.start || 'top 75%' },
      y: opts.y != null ? opts.y : 24,
      opacity: 0,
      duration: opts.duration || 0.6,
      stagger: opts.stagger || 0.08,
      ease: opts.ease || 'power2.out'
    });
  };

  /* Fire a one-shot preload hook on a scene root when the *previous* scene enters. */
  KHAN.preloadOnPrev = function (prevRoot, fn) {
    if (!prevRoot || !window.ScrollTrigger) { fn(); return; }
    ScrollTrigger.create({ trigger: prevRoot, start: 'top bottom', once: true, onEnter: fn });
  };

  /* ===================== Scene registry / init contract ===================== */
  KHAN.scenes = {};
  KHAN.register = function (name, initFn) { KHAN.scenes[name] = initFn; };

  KHAN.initScene = function (root) {
    var name = root.getAttribute('data-khan-scene');
    var fn = KHAN.scenes[name];
    if (!fn || root.__khanInit) return;
    root.__khanInit = true;
    root.classList.toggle('khan-reduced', REDUCED);
    try { fn(root); } catch (e) { console.warn('[KHAN] init failed:', name, e); }
  };

  KHAN.initAll = function (scope) {
    (scope || document).querySelectorAll('[data-khan-scene]').forEach(KHAN.initScene);
  };

  function boot() {
    if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    KHAN.initAll(document);
    if (window.ScrollTrigger && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    }
  }
  onReady(boot);

  // Theme editor: a section can reload in isolation — re-init just that subtree.
  document.addEventListener('shopify:section:load', function (e) {
    KHAN.initAll(e.target);
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  });
  document.addEventListener('shopify:section:unload', function (e) {
    if (!window.ScrollTrigger) return;
    ScrollTrigger.getAll().forEach(function (st) {
      if (e.target.contains(st.trigger)) st.kill();
    });
  });

  /* ============================== S1 — Hero + Identity ==============================
     data-khan-scene="hero"; data-scroll-length (e.g. "260%").
     Layers: .khan-hero__liquid-bar, canvas.khan-hero__smoke (Pattern A),
     .khan-hero__identity, .khan-hero__badge (repeated). Logo pulse is CSS. */
  KHAN.register('hero', function (root) {
    var len = root.getAttribute('data-scroll-length') || '260%';
    var smoke = root.querySelector('canvas.khan-hero__smoke');
    var bar = root.querySelector('.khan-hero__liquid-bar');
    var identity = root.querySelector('.khan-hero__identity');
    var badges = root.querySelectorAll('.khan-hero__badge');
    if (smoke) KHAN.scrubSequence({ canvas: smoke, trigger: root, pin: false, scrub: true, scrollLength: len });

    KHAN.pinnedScene({
      trigger: root, scrollLength: len,
      build: function (tl) {
        if (bar) { // 0.00–0.25: docks from hero-centre up to the top
          var dock = bar.getAttribute('data-hero-offset') || '38vh';
          tl.fromTo(bar, { y: dock }, { y: 0, ease: 'power2.inOut' }, 0.0);
        }
        if (smoke) tl.fromTo(smoke, { opacity: 0, yPercent: 12 }, { opacity: 1, yPercent: 0 }, 0.20); // 0.20–0.60 rise
        if (identity) tl.from(identity, { opacity: 0, x: -40 }, 0.20);
        if (badges.length) tl.from(badges, { opacity: 0, y: 24, stagger: 0.08 }, 0.55); // 0.55–1.00
      }
    });
  });

  /* ============================== S2 — Slogan ==============================
     data-khan-scene="slogan". Layers: canvas.khan-slogan__smoke (carry-over),
     .khan-slogan__wash (white), .khan-slogan__text. Smoke→white dissolve. */
  KHAN.register('slogan', function (root) {
    var len = root.getAttribute('data-scroll-length') || '160%';
    var smoke = root.querySelector('canvas.khan-slogan__smoke');
    var wash = root.querySelector('.khan-slogan__wash');
    var text = root.querySelector('.khan-slogan__text');
    if (smoke) KHAN.scrubSequence({ canvas: smoke, trigger: root, pin: false, scrollLength: len });
    KHAN.pinnedScene({
      trigger: root, scrollLength: len,
      build: function (tl) {
        if (smoke) tl.to(smoke, { opacity: 0 }, 0.0);
        if (wash) tl.fromTo(wash, { opacity: 0 }, { opacity: 1 }, 0.0);
        if (text) tl.from(text, { opacity: 0, y: 28 }, 0.25);
      }
    });
  });

  /* ============================== S3 — Pre-workout + Apparel ==============================
     data-khan-scene="product-duo". Layers: canvas.khan-duo__jar (Pattern A),
     .khan-duo__model, .khan-duo__pre-ui, .khan-duo__apparel-ui. No clipping on product layers. */
  KHAN.register('product-duo', function (root) {
    var len = root.getAttribute('data-scroll-length') || '320%';
    var jar = root.querySelector('canvas.khan-duo__jar');
    var model = root.querySelector('.khan-duo__model');
    var preUi = root.querySelectorAll('.khan-duo__pre-ui > *');
    var apparelUi = root.querySelectorAll('.khan-duo__apparel-ui > *');
    if (jar) KHAN.scrubSequence({ canvas: jar, trigger: root, pin: false, scrollLength: len });
    KHAN.pinnedScene({
      trigger: root, scrollLength: len,
      build: function (tl) {
        if (preUi.length) tl.from(preUi, { opacity: 0, y: 24, stagger: 0.06 }, 0.0); // 0.00–0.45
        if (model) tl.fromTo(model, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1 }, 0.40); // 0.40–0.65 overlap
        if (jar) tl.to(jar, { xPercent: -8 }, 0.60); // jar eases to resting transform
        if (apparelUi.length) tl.from(apparelUi, { opacity: 0, y: 24, stagger: 0.06 }, 0.60); // 0.60–1.00
      }
    });
  });

  /* ============================== S4 — Slogan reprise ==============================
     data-khan-scene="reprise". Two lines reveal on enter (Pattern D), no pin. */
  KHAN.register('reprise', function (root) {
    var lines = root.querySelectorAll('.khan-reprise__line');
    KHAN.staggerReveal({ trigger: root, items: lines, y: 28, stagger: 0.18 });
  });

  /* ============================== S5 — Footer drop ==============================
     data-khan-scene="footer". Layers: video.khan-footer__video (Pattern B),
     .khan-footer__bg (light→dark wash), .khan-footer__nav (revealed after). */
  KHAN.register('footer', function (root) {
    var len = root.getAttribute('data-scroll-length') || '150%';
    var video = root.querySelector('video.khan-footer__video');
    var bg = root.querySelector('.khan-footer__bg');
    var nav = root.querySelectorAll('.khan-footer__nav > *');
    if (video) KHAN.scrubVideoOnce({ video: video, trigger: root, scrollLength: len, pin: true });
    if (bg && window.gsap) {
      if (REDUCED || !window.ScrollTrigger) {
        gsap.set(bg, { '--khan-footer-dark': 1 });
      } else {
        gsap.fromTo(bg, { '--khan-footer-dark': 0 }, {
          '--khan-footer-dark': 1, ease: 'none',
          scrollTrigger: { trigger: root, start: 'top top', end: '+=' + len, scrub: true }
        });
      }
    }
    if (nav.length) KHAN.staggerReveal({ trigger: root, items: nav, start: 'top 60%', y: 20, stagger: 0.06 });
  });
})();
