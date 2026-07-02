(() => {
  const ENABLE_PAGE_LOAD = true; // 開発中 false、本番 true

  // ── 状態管理 ──────────────────────────────────────────────────────────────
  let yOffset = 0;
  let prevScrollHeight = 0;
  let currentScene = 0;
  let enterNewScene = false;
  let acc = 0.2;
  let delayedYOffset = 0;
  let rafId;
  let rafState;

  // ── フレーム番号 ───────────────────────────────────────────────────────────
  const harryFrameNumbers  = Array.from({ length: 350 }, (_, i) => i + 1).filter(n => n !== 233);
  const harry2FrameNumbers = Array.from({ length: 622 }, (_, i) => i + 1);

  const BLEND_WIPE_DURATION = 0.18;
  const BLEND_SCENE = 3;
  const MOTION_SCENE = 2;
  const FRAME_LOAD_CONCURRENCY = 8;
  const HARRY02_PRIORITY_BASE = 10000;

  let pageRevealed = false;
  let harry02Scheduled = false;

  const MOTION_DESC_LETTERS = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const MOTION_DESC_TIMING = [
    [0.200, 0.225], [0.260, 0.285], [0.320, 0.345], [0.380, 0.405], [0.440, 0.465],
    [0.500, 0.525], [0.560, 0.585], [0.620, 0.645], [0.680, 0.705], [0.740, 0.765],
  ];

  function createBlendValues() {
    return {
      rect1X:       [0, 0, { start: 0, end: 0 }],
      rect2X:       [0, 0, { start: 0, end: 0 }],
      blendHeight:  [0, 0, { start: 0, end: 0 }],
      canvas_scale: [0, 0, { start: 0, end: 0 }],
      rectStartY: 0,
      wipeTimingSet: false,
      blendShrinkScale: 0,
      blendShrinkScaleSet: false,
      hallQuoteLatch: false,
    };
  }

  function createMotionDescs() {
    return MOTION_DESC_LETTERS.map((letter, i) => {
      const selector = `#section-motion .section-motion__desc--${letter}`;
      return {
        inStart: MOTION_DESC_TIMING[i][0],
        inEnd:   MOTION_DESC_TIMING[i][1],
        el:  document.querySelector(selector),
        pin: document.querySelector(`${selector} .section-motion__pin`),
      };
    });
  }

  // ── シーン定義 ─────────────────────────────────────────────────────────────
  const sceneInfo = [
    {
      // Scene 0: FV（ファーストビュー）
      type: 'sticky',
      heightNum: 5,
      scrollHeight: 0,
      objs: {
        container: document.querySelector('#section-fv'),
        canvas:    document.querySelector('#section-fv-canvas'),
        context:   document.querySelector('#section-fv-canvas').getContext('2d'),
        videoImages: [],
        // メッセージA〜D: threshold = in→out の切り替えスクロール比率
        messages: [
          { el: document.querySelector('#section-fv .section-fv__line--a'), threshold: 0.22, inRange: [0.1,  0.2 ], outRange: [0.25, 0.3 ] },
          { el: document.querySelector('#section-fv .section-fv__line--b'), threshold: 0.42, inRange: [0.3,  0.4 ], outRange: [0.45, 0.5 ] },
          { el: document.querySelector('#section-fv .section-fv__line--c'), threshold: 0.62, inRange: [0.5,  0.6 ], outRange: [0.65, 0.7 ] },
          { el: document.querySelector('#section-fv .section-fv__line--d'), threshold: 0.82, inRange: [0.7,  0.8 ], outRange: [0.85, 0.9 ] },
        ],
      },
      values: {
        imageSequence: [0, harryFrameNumbers.length - 1],
        canvas_opacity: [1, 0, { start: 0.9, end: 1 }],
      },
    },
    {
      // Scene 1: リード（通常スクロール）
      type: 'normal',
      heightNum: 2,
      scrollHeight: 0,
      objs: {
        container: document.querySelector('#section-lead'),
        content:   document.querySelector('#section-lead .section-lead__txt'),
      },
    },
    {
      // Scene 2: モーション
      type: 'sticky',
      heightNum: 10,
      scrollHeight: 0,
      objs: {
        container:   document.querySelector('#section-motion'),
        canvas:      document.querySelector('#section-motion-canvas'),
        context:     document.querySelector('#section-motion-canvas').getContext('2d'),
        videoImages: [],
        // タイトルテキスト（エクスペクト・パトローナム）
        messageA: {
          el:       document.querySelector('#section-motion .section-motion__line--a'),
          threshold: 0.155,
          inRange:  [0.02, 0.08],
          outRange: [0.16, 0.20],
        },
        // 説明テキスト B〜K（フェードインのみ、アウトなし）
        descs: createMotionDescs(),
      },
      values: {
        imageSequence:     [0, harry2FrameNumbers.length - 1],
        canvas_opacity_in:  [0, 1, { start: 0,    end: 0.1 }],
        canvas_opacity_out: [1, 0, { start: 0.95, end: 1   }],
      },
    },
    {
      // Scene 3: 画像ブレンド
      type: 'sticky',
      heightNum: 3,
      scrollHeight: 0,
      objs: {
        container:  document.querySelector('#section-blend'),
        canvasWrap: document.querySelector('#section-blend-canvas-wrap'),
        hallQuote:  document.querySelector('.section-blend__hall-quote'),
        canvas:     document.querySelector('#section-blend-canvas'),
        context:    document.querySelector('#section-blend-canvas').getContext('2d'),
        imagesPath: ['./images/4house-img02.png', './images/4house-img.png'],
        images: [],
      },
      values: createBlendValues(),
    },
  ];

  // ── ユーティリティ ──────────────────────────────────────────────────────────

  // スクロール比率に応じて values[0]〜values[1] を線形補間する
  function calcValues(values, currentYOffset) {
    const scrollHeight = sceneInfo[currentScene].scrollHeight;
    if (values.length === 3) {
      const { start, end } = values[2];
      const startPx = start * scrollHeight;
      const endPx   = end   * scrollHeight;
      const range   = endPx - startPx;
      if (range <= 0)              return currentYOffset >= endPx ? values[1] : values[0];
      if (currentYOffset < startPx) return values[0];
      if (currentYOffset > endPx)   return values[1];
      return ((currentYOffset - startPx) / range) * (values[1] - values[0]) + values[0];
    }
    return (currentYOffset / scrollHeight) * (values[1] - values[0]) + values[0];
  }

  // メッセージのフェードイン／アウト（threshold で切り替え）
  function applyMessage(msg, currentYOffset, scrollHeight, fromY, toY) {
    const isIn  = (currentYOffset / scrollHeight) <= msg.threshold;
    const range = isIn ? msg.inRange : msg.outRange;
    const timing = { start: range[0], end: range[1] };
    msg.el.style.opacity   = calcValues(isIn ? [0, 1, timing] : [1, 0, timing], currentYOffset);
    msg.el.style.transform = `translate3d(0, ${calcValues(isIn ? [fromY, 0, timing] : [0, toY, timing], currentYOffset)}%, 0)`;
  }

  // 説明テキストのフェードイン（アウトなし）
  function applyDesc(desc, currentYOffset, scrollHeight) {
    const inStart = desc.inStart * scrollHeight;
    const inEnd   = desc.inEnd   * scrollHeight;
    const ratio   = Math.max(0, Math.min(1, (currentYOffset - inStart) / (inEnd - inStart)));
    desc.el.style.opacity    = ratio;
    desc.el.style.transform  = `translate3d(0, ${30 - ratio * 30}%, 0)`;
    desc.pin.style.transform = `scaleY(${0.5 + ratio * 0.5})`;
  }

  // canvas に画像をレターボックス（contain）で描画する
  function drawLetterboxed(ctx, img, cw, ch) {
    if (!img) return;
    const iw = img.tagName === 'VIDEO' ? img.videoWidth  : img.naturalWidth;
    const ih = img.tagName === 'VIDEO' ? img.videoHeight : img.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, 0, 0, iw, ih, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  // canvas に画像をカバー（crop）で描画する
  function drawCover(ctx, img, cw, ch) {
    if (!img) return;
    const iw = img.tagName === 'VIDEO' ? img.videoWidth  : img.naturalWidth;
    const ih = img.tagName === 'VIDEO' ? img.videoHeight : img.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, 0, 0, iw, ih, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  // 画像／動画が描画可能かチェック
  function isDrawable(img) {
    if (!img || img.isBroken) return false;
    if (img.tagName === 'VIDEO') return (img.isLoaded || img.readyState >= 2) && img.videoWidth > 0;
    return img.complete && img.naturalWidth > 0;
  }

  // ブレンドキャンバスの表示幅を bitmap 座標で返す
  function getBlendInnerWidth(canvasEl) {
    const dispW = canvasEl.getBoundingClientRect().width;
    if (dispW < 1) return Math.min(document.body.offsetWidth, canvasEl.width);
    return Math.min(window.innerWidth * (canvasEl.width / dispW), canvasEl.width);
  }

  // ── 画像ロード ──────────────────────────────────────────────────────────────

  const imageLoadQueue = (() => {
    let active = 0;
    const pending = [];

    function run() {
      pending.sort((a, b) => a.priority - b.priority);
      while (active < FRAME_LOAD_CONCURRENCY && pending.length) {
        const task = pending.shift();
        active += 1;
        task.start(() => {
          active -= 1;
          task.done?.();
          run();
        });
      }
    }

    return {
      add(priority, start, done) {
        pending.push({ priority, start, done });
        run();
      },
    };
  })();

  function scheduleFrameLoad(targetArray, index, directory, frameNum, ext, priority, onLoaded) {
    const extStr = ext.startsWith('.') ? ext : `.${ext}`;
    const img = new Image();
    img.isLoaded = false;
    img.isBroken = false;
    targetArray[index] = img;

    imageLoadQueue.add(priority, (finish) => {
      const complete = () => {
        finish();
        onLoaded?.(img, index);
      };
      img.onload = () => {
        img.isLoaded = true;
        complete();
      };
      img.onerror = () => {
        img.isBroken = true;
        complete();
      };
      img.src = `${directory}/IMG_${frameNum}${extStr}`;
    });
  }

  function drawFirstHarryFrame() {
    const { context, canvas } = sceneInfo[0].objs;
    const frame0 = sceneInfo[0].objs.videoImages[0];
    if (frame0?.isLoaded && !frame0.isBroken) {
      drawCover(context, frame0, canvas.width, canvas.height);
    }
  }

  function tryRevealPage() {
    if (pageRevealed) return;

    if (!ENABLE_PAGE_LOAD) {
      pageRevealed = true;
      document.body.classList.remove('body--before-load');
      return;
    }

    const frame0 = sceneInfo[0].objs.videoImages[0];
    if (!frame0?.isLoaded || frame0.isBroken) return;

    pageRevealed = true;
    setLayout();
    document.body.classList.remove('body--before-load');
    drawFirstHarryFrame();

    document.querySelector('.page-load')?.addEventListener('transitionend', (e) => {
      document.body.removeChild(e.currentTarget);
    }, { once: true });
  }

  function scheduleHarry02Loads() {
    if (harry02Scheduled) return;
    harry02Scheduled = true;

    harry2FrameNumbers.forEach((frameNum, index) => {
      scheduleFrameLoad(
        sceneInfo[MOTION_SCENE].objs.videoImages,
        index,
        './video/harry02',
        frameNum,
        'jpg',
        HARRY02_PRIORITY_BASE + index,
      );
    });
  }

  function maybeScheduleHarry02Early() {
    const motionStart = sceneInfo.slice(0, MOTION_SCENE).reduce((sum, scene) => sum + scene.scrollHeight, 0);
    if (yOffset >= motionStart - window.innerHeight * 1.5) scheduleHarry02Loads();
  }

  function setCanvasImages() {
    harryFrameNumbers.forEach((frameNum, index) => {
      scheduleFrameLoad(
        sceneInfo[0].objs.videoImages,
        index,
        './video/harry',
        frameNum,
        'jpg',
        index,
        (_img, loadedIndex) => {
          if (loadedIndex === 0) tryRevealPage();
          if (loadedIndex === 0) scheduleHarry02Loads();
        },
      );
    });

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => scheduleHarry02Loads(), { timeout: 2500 });
    } else {
      setTimeout(scheduleHarry02Loads, 2000);
    }

    for (const path of sceneInfo[BLEND_SCENE].objs.imagesPath) {
      let imgElem;
      if (/\.(mov|mp4|webm)$/i.test(path)) {
        imgElem = document.createElement('video');
        Object.assign(imgElem, { src: path, loop: true, muted: true, autoplay: true, playsInline: true, preload: 'auto' });
        imgElem.isLoaded = false;
        imgElem.isBroken = false;
        imgElem.addEventListener('loadeddata', () => { imgElem.isLoaded = true; });
        imgElem.addEventListener('error',      () => { imgElem.isBroken = true; });
        imgElem.play().catch(() => {});
      } else {
        imgElem = new Image();
        imgElem.isLoaded = false;
        imgElem.isBroken = false;
        imgElem.onload  = () => { imgElem.isLoaded = true; };
        imgElem.onerror = () => { imgElem.isBroken = true; };
        imgElem.src = path;
        if (imgElem.complete && imgElem.naturalWidth > 0) imgElem.isLoaded = true;
      }
      sceneInfo[BLEND_SCENE].objs.images.push(imgElem);
    }
  }

  // ── レイアウト ──────────────────────────────────────────────────────────────


  function resetBlendScene() {
    const { objs, values } = sceneInfo[BLEND_SCENE];
    objs.canvasWrap.classList.remove('sticky');
    objs.canvasWrap.style.transform = '';
    objs.canvas.style.cssText = '';
    values.blendShrinkScaleSet = false;
    values.hallQuoteLatch = false;
    objs.hallQuote?.classList.remove('section-blend__hall-quote--visible');
  }

  function getTotalScrollHeight() {
    return sceneInfo.reduce((sum, s) => sum + s.scrollHeight, 0);
  }

  function releaseBlendIfEnd() {
    if (yOffset >= getTotalScrollHeight() - 2) resetBlendScene();
  }

  function setLayout() {
    for (const scene of sceneInfo) {
      scene.scrollHeight = scene.heightNum
        ? scene.heightNum * window.innerHeight
        : scene.objs.content.offsetHeight + window.innerHeight * 0.5;
      scene.objs.container.style.height = `${scene.scrollHeight}px`;
    }

    yOffset = window.pageYOffset;
    let total = 0;
    for (let i = 0; i < sceneInfo.length; i++) {
      total += sceneInfo[i].scrollHeight;
      if (total >= yOffset) { currentScene = i; break; }
    }
    document.body.dataset.scene = String(currentScene);

    // ブレンドシーンの値をリセット
    Object.assign(sceneInfo[BLEND_SCENE].values, createBlendValues());
    resetBlendScene();

    // Scene 0 / 2 のキャンバスをビューポートに合わせてスケール
    const coverRatio = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
    const coverTransform = `translate3d(-50%, -50%, 0) scale(${coverRatio})`;
    sceneInfo[0].objs.canvas.style.transform = coverTransform;
    sceneInfo[MOTION_SCENE].objs.canvas.style.transform = coverTransform;

    maybeScheduleHarry02Early();
  }

  // Scene 2 の末尾でブレンドキャンバスをプレビュー描画する
  function drawBlendPreview() {
    const { objs, values } = sceneInfo[BLEND_SCENE];
    objs.canvas.style.transform = '';
    objs.context.fillStyle = '#111';
    objs.context.fillRect(0, 0, objs.canvas.width, objs.canvas.height);
    if (isDrawable(objs.images[0])) drawLetterboxed(objs.context, objs.images[0], objs.canvas.width, objs.canvas.height);

    const innerW = getBlendInnerWidth(objs.canvas);
    const rectW  = innerW * 0.15;
    values.rect1X[0] = (objs.canvas.width - innerW) / 2;
    values.rect1X[1] = values.rect1X[0] - rectW;
    values.rect2X[0] = values.rect1X[0] + innerW - rectW;
    values.rect2X[1] = values.rect2X[0] + rectW;

    objs.context.fillStyle = '#000';
    objs.context.fillRect(parseInt(values.rect1X[0]), 0, parseInt(rectW), objs.canvas.height);
    objs.context.fillRect(parseInt(values.rect2X[0]), 0, parseInt(rectW), objs.canvas.height);
  }

  // ブレンドシーンの wipe 開始タイミングを一度だけ計算する
  function ensureBlendWipeTiming(values, objs, scrollHeight) {
    if (values.wipeTimingSet) return;
    const pinOffsetY = objs.canvasWrap.offsetTop;
    values.rectStartY = pinOffsetY;
    const pinRatio  = Math.min(0.92, pinOffsetY / scrollHeight);
    const wipeStart = Math.max(0.02, pinRatio - BLEND_WIPE_DURATION);
    values.rect1X[2] = { start: wipeStart, end: pinRatio };
    values.rect2X[2] = { start: wipeStart, end: pinRatio };
    values.wipeTimingSet = true;
  }

  // ── アニメーション ──────────────────────────────────────────────────────────

  function playAnimation() {
    releaseBlendIfEnd();

    const objs          = sceneInfo[currentScene].objs;
    const values        = sceneInfo[currentScene].values;
    const currentYOffset = yOffset - prevScrollHeight;
    const scrollHeight  = sceneInfo[currentScene].scrollHeight;
    const scrollRatio   = currentYOffset / scrollHeight;

    if (currentScene !== BLEND_SCENE) sceneInfo[BLEND_SCENE].objs.hallQuote?.classList.remove('section-blend__hall-quote--visible');

    switch (currentScene) {
      case 0:
        objs.canvas.style.opacity = calcValues(values.canvas_opacity, currentYOffset);
        for (const msg of objs.messages) {
          applyMessage(msg, currentYOffset, scrollHeight, 20, -20);
        }
        break;

      case 2:
        objs.canvas.style.opacity = calcValues(
          scrollRatio <= 0.5 ? values.canvas_opacity_in : values.canvas_opacity_out,
          currentYOffset,
        );
        applyMessage(objs.messageA, currentYOffset, scrollHeight, 20, -20);
        for (const desc of objs.descs) {
          applyDesc(desc, currentYOffset, scrollHeight);
        }
        if (scrollRatio > 0.94) drawBlendPreview();
        break;

      case BLEND_SCENE: {
        const { context, canvas, images, canvasWrap, hallQuote } = objs;

        // ベース画像を描画
        canvas.style.transform = '';
        context.fillStyle = '#111';
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (isDrawable(images[0])) drawLetterboxed(context, images[0], canvas.width, canvas.height);

        const innerW = getBlendInnerWidth(canvas);
        ensureBlendWipeTiming(values, objs, scrollHeight);

        // 左右の黒帯を更新
        const rectW = innerW * 0.15;
        values.rect1X[0] = (canvas.width - innerW) / 2;
        values.rect1X[1] = values.rect1X[0] - rectW;
        values.rect2X[0] = values.rect1X[0] + innerW - rectW;
        values.rect2X[1] = values.rect2X[0] + rectW;
        context.fillStyle = '#000';
        context.fillRect(parseInt(calcValues(values.rect1X, currentYOffset)), 0, parseInt(rectW), canvas.height);
        context.fillRect(parseInt(calcValues(values.rect2X, currentYOffset)), 0, parseInt(rectW), canvas.height);

        if (scrollRatio < values.rect1X[2].end) {
          // ピン前: スティッキー解除
          canvasWrap.classList.remove('sticky');
          canvasWrap.style.transform = '';
          canvas.style.cssText = '';
          values.blendShrinkScaleSet = false;
          values.hallQuoteLatch = false;
          hallQuote?.classList.remove('section-blend__hall-quote--visible');
        } else {
          // ピン後: ブレンド + 縮小
          values.blendHeight[2] = { start: values.rect1X[2].end, end: values.rect1X[2].end + 0.2 };
          values.blendHeight[0] = 0;
          values.blendHeight[1] = canvas.height;
          const blendHeight = calcValues(values.blendHeight, currentYOffset);

          if (blendHeight >= canvas.height - 0.5) values.hallQuoteLatch = true;
          hallQuote?.classList.toggle('section-blend__hall-quote--visible', values.hallQuoteLatch);

          if (isDrawable(images[1]) && blendHeight > 0) {
            context.save();
            context.beginPath();
            context.rect(0, canvas.height - blendHeight, canvas.width, blendHeight);
            context.clip();
            drawLetterboxed(context, images[1], canvas.width, canvas.height);
            context.restore();
          }

          canvas.style.left = '';
          canvas.style.top  = '';

          if (scrollRatio > values.blendHeight[2].end) {
            // 縮小アニメーション
            if (!values.blendShrinkScaleSet) {
              const dispW = canvas.getBoundingClientRect().width || canvas.clientWidth || 1;
              values.blendShrinkScale = Math.min(1, document.body.offsetWidth / (1.5 * dispW));
              values.blendShrinkScaleSet = true;
            }
            values.canvas_scale[0] = 1;
            values.canvas_scale[1] = values.blendShrinkScale;
            values.canvas_scale[2] = { start: values.blendHeight[2].end, end: values.blendHeight[2].end + 0.2 };
            canvas.style.transform  = `scale(${calcValues(values.canvas_scale, currentYOffset)})`;
            canvas.style.marginTop  = '0';
            // 縮小に合わせてキャンバスを暗くする
            const darkAlpha = calcValues([0, 0.55, values.canvas_scale[2]], currentYOffset);
            context.fillStyle = `rgba(0, 0, 0, ${darkAlpha})`;
            context.fillRect(0, 0, canvas.width, canvas.height);
          } else {
            canvas.style.transform = '';
            values.blendShrinkScaleSet = false;
          }

          const scaleEnd      = values.canvas_scale[2].end;
          const shrinkComplete = scaleEnd > 0 && scrollRatio > scaleEnd - 0.002;
          const nearEnd        = currentYOffset >= scrollHeight - 2;

          if (nearEnd) {
            canvasWrap.classList.remove('sticky');
            canvasWrap.style.transform = '';
          } else if (shrinkComplete) {
            canvasWrap.classList.add('sticky');
            const exitDelta = Math.max(0, currentYOffset - scaleEnd * scrollHeight);
            canvasWrap.style.transform = `translate3d(0, ${-exitDelta}px, 0)`;
          } else {
            canvasWrap.classList.add('sticky');
            canvasWrap.style.transform = '';
          }
        }
        break;
      }
    }
  }

  function scrollLoop() {
    enterNewScene = false;
    prevScrollHeight = 0;
    for (let i = 0; i < currentScene; i++) prevScrollHeight += sceneInfo[i].scrollHeight;

    const sceneEnd = prevScrollHeight + sceneInfo[currentScene].scrollHeight;

    if (delayedYOffset < sceneEnd) {
      document.body.classList.remove('body--scroll-ended');
    }

    if (delayedYOffset > sceneEnd) {
      enterNewScene = true;
      if (currentScene === sceneInfo.length - 1) document.body.classList.add('body--scroll-ended');
      if (currentScene === BLEND_SCENE) resetBlendScene();
      if (currentScene < sceneInfo.length - 1) currentScene++;
      document.body.dataset.scene = String(currentScene);
    }

    if (delayedYOffset < prevScrollHeight) {
      enterNewScene = true;
      if (currentScene === 0) return;
      currentScene--;
      document.body.dataset.scene = String(currentScene);
    }

    if (!enterNewScene) playAnimation();
  }

  function loop() {
    delayedYOffset += (yOffset - delayedYOffset) * acc;

    // フレーム画像の描画
    if (!enterNewScene && (currentScene === 0 || currentScene === 2)) {
      const currentYOffset = delayedYOffset - prevScrollHeight;
      const { objs, values } = sceneInfo[currentScene];
      const sequence = Math.round(calcValues(values.imageSequence, currentYOffset));
      const frame = objs.videoImages[sequence];
      if (frame?.isLoaded && !frame.isBroken) drawCover(objs.context, frame, objs.canvas.width, objs.canvas.height);
    }

    // ページ先頭付近
    if (delayedYOffset < 1) {
      scrollLoop();
      sceneInfo[0].objs.canvas.style.opacity = 1;
      const frame0 = sceneInfo[0].objs.videoImages[0];
      if (frame0?.isLoaded && !frame0.isBroken) drawCover(sceneInfo[0].objs.context, frame0, sceneInfo[0].objs.canvas.width, sceneInfo[0].objs.canvas.height);
    }

    // ページ末尾付近
    if (document.body.offsetHeight - window.innerHeight - delayedYOffset < 1) scrollLoop();

    rafId = requestAnimationFrame(loop);
    if (Math.abs(yOffset - delayedYOffset) < 1) {
      cancelAnimationFrame(rafId);
      rafState = false;
    }
  }

  // ── 初期化 ─────────────────────────────────────────────────────────────────

  function initApp() {
    setLayout();

    if (yOffset > 0) {
      let tempY = yOffset;
      let count = 0;
      const siId = setInterval(() => {
        scrollTo(0, tempY);
        tempY += 5;
        if (++count > 20) clearInterval(siId);
      }, 20);
    }

    window.addEventListener('scroll', () => {
      yOffset = window.pageYOffset;
      maybeScheduleHarry02Early();
      releaseBlendIfEnd();
      scrollLoop();
      if (!rafState) { rafId = requestAnimationFrame(loop); rafState = true; }
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) window.location.reload();
    });

    window.addEventListener('orientationchange', () => {
      scrollTo(0, 0);
      setTimeout(() => window.location.reload(), 500);
    });

    if (!rafState) {
      rafId = requestAnimationFrame(loop);
      rafState = true;
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);

  window.addEventListener('load', () => {
    setLayout();
    tryRevealPage();
    drawFirstHarryFrame();
  });

  setCanvasImages();
})();
