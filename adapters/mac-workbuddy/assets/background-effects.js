(() => {
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
  const shortestDegrees = (left, right) => Math.abs(((left - right + 540) % 360) - 180);

  function directionalFrameForPointer(config, pointer, viewport, previousFrame = null) {
    const originX = viewport.width * (config.origin.xPercent / 100);
    const originY = viewport.height * (config.origin.yPercent / 100);
    const deltaX = pointer.x - originX;
    const deltaY = pointer.y - originY;
    if (Math.hypot(deltaX, deltaY) < 1) return config.idleFrame;
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const sector = 360 / config.directions;
    const candidate = Math.round(normalizeDegrees(angle - config.firstDirectionDegrees) / sector) % config.directions;
    if (!Number.isInteger(previousFrame) || previousFrame < 0 || previousFrame >= config.directions || candidate === previousFrame) {
      return candidate;
    }
    const previousCenter = normalizeDegrees(config.firstDirectionDegrees + previousFrame * sector);
    return shortestDegrees(angle, previousCenter) > sector * 0.62 ? candidate : previousFrame;
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "unknown shader error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function program(gl, vertexSource, fragmentSource) {
    const result = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(result, vertex);
    gl.attachShader(result, fragment);
    gl.linkProgram(result);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(result) || "unknown program link error";
      gl.deleteProgram(result);
      throw new Error(message);
    }
    return result;
  }

  function createBackgroundEffect(options) {
    const win = options.window || window;
    const doc = options.document || options.layer?.ownerDocument || document;
    const ImageConstructor = options.Image || win.Image;
    const layer = options.layer;
    const config = options.config || {};
    const mode = options.mode;
    let position = {
      xPercent: clamp(Number(options.position?.xPercent ?? 50), 0, 100),
      yPercent: clamp(Number(options.position?.yPercent ?? 50), 0, 100),
    };
    const motionQuery = options.motionMediaQuery || win.matchMedia?.("(prefers-reduced-motion: reduce)") || {
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    };
    const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
    const onFallback = typeof options.onFallback === "function" ? options.onFallback : () => {};
    if (!layer || !["ripple", "directional"].includes(mode)) throw new Error("Invalid interactive background options");

    const canvas = doc.createElement("canvas");
    canvas.setAttribute("data-skin-owned", "interactive-background-canvas");
    canvas.setAttribute("aria-hidden", "true");
    layer.appendChild(canvas);

    let desiredEnabled = true;
    let disposed = false;
    let ready = false;
    let fallback = null;
    let animationFrame = 0;
    let pointerFrame = 0;
    let idleTimer = 0;
    let sourceImage = null;
    let currentFrame = config.idleFrame ?? 0;
    let pendingPointer = null;
    let ripple = null;
    let windowFocused = true;
    const listeners = [];

    const listen = (target, type, handler, optionsValue) => {
      target?.addEventListener?.(type, handler, optionsValue);
      listeners.push(() => target?.removeEventListener?.(type, handler, optionsValue));
    };
    const requestFrame = (callback) => win.requestAnimationFrame?.(callback) ?? win.setTimeout(callback, 16);
    const cancelFrame = (id) => {
      if (!id) return;
      if (win.cancelAnimationFrame) win.cancelAnimationFrame(id);
      else win.clearTimeout?.(id);
    };
    const motionAllowed = () => desiredEnabled && windowFocused && !motionQuery.matches && !doc.hidden;
    const notify = () => onStateChange({
      mode,
      desiredEnabled,
      active: ready && !fallback && motionAllowed(),
      ready,
      fallback,
      frame: mode === "directional" ? currentFrame : null,
    });
    const fail = (reason) => {
      if (disposed || fallback) return;
      fallback = reason;
      ready = false;
      cancelFrame(animationFrame);
      animationFrame = 0;
      onFallback(reason);
      notify();
    };

    const viewport = () => ({
      width: Math.max(1, win.innerWidth || layer.clientWidth || 1),
      height: Math.max(1, win.innerHeight || layer.clientHeight || 1),
    });
    const pixelRatio = () => mode === "directional"
      ? Math.min(1.5, Math.max(1, win.devicePixelRatio || 1))
      : config.quality === "high" ? Math.min(2, Math.max(1, win.devicePixelRatio || 1))
        : config.quality === "low" ? 1 : Math.min(1.5, Math.max(1, win.devicePixelRatio || 1));

    const drawDirectional = (frame = currentFrame) => {
      if (!sourceImage || fallback) return;
      const context = canvas.getContext?.("2d", { alpha: false });
      if (!context) return fail("canvas-2d-unavailable");
      const frameWidth = sourceImage.naturalWidth / config.columns;
      const frameHeight = sourceImage.naturalHeight / config.rows;
      if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) return fail("atlas-grid-mismatch");
      const column = frame % config.columns;
      const row = Math.floor(frame / config.columns);
      const scale = Math.max(canvas.width / frameWidth, canvas.height / frameHeight);
      const drawWidth = frameWidth * scale;
      const drawHeight = frameHeight * scale;
      const x = (canvas.width - drawWidth) * (position.xPercent / 100);
      const y = (canvas.height - drawHeight) * (position.yPercent / 100);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        sourceImage,
        column * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        x,
        y,
        drawWidth,
        drawHeight,
      );
      currentFrame = frame;
    };

    const createRipple = (image) => {
      const gl = canvas.getContext?.("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      });
      if (!gl) return null;
      if (image.naturalWidth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.naturalHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        return null;
      }
      const vertexSource = `#version 300 es
        precision highp float;
        out vec2 vUv;
        void main() {
          vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
          vUv = position;
          gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
        }`;
      const simulationSource = `#version 300 es
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform sampler2D uState;
        uniform vec2 uTexel;
        uniform vec2 uDrop;
        uniform vec2 uRadius;
        uniform float uDropActive;
        uniform float uDamping;
        void main() {
          float current = texture(uState, vUv).r * 2.0 - 1.0;
          float previous = texture(uState, vUv).g * 2.0 - 1.0;
          float neighbors = texture(uState, vUv + vec2(uTexel.x, 0.0)).r +
            texture(uState, vUv - vec2(uTexel.x, 0.0)).r +
            texture(uState, vUv + vec2(0.0, uTexel.y)).r +
            texture(uState, vUv - vec2(0.0, uTexel.y)).r;
          neighbors = neighbors * 0.5 - 1.0;
          float nextHeight = (neighbors - previous) * uDamping;
          vec2 delta = (vUv - uDrop) / max(uRadius, vec2(0.0001));
          float drop = exp(-dot(delta, delta) * 2.5) * uDropActive;
          nextHeight -= drop * 0.55;
          outColor = vec4(nextHeight * 0.5 + 0.5, current * 0.5 + 0.5, 0.0, 1.0);
        }`;
      const renderSource = `#version 300 es
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform sampler2D uState;
        uniform sampler2D uSource;
        uniform vec2 uStateTexel;
        uniform vec2 uSourceSize;
        uniform vec2 uViewport;
        uniform vec2 uPosition;
        uniform float uIntensity;
        void main() {
          float left = texture(uState, vUv - vec2(uStateTexel.x, 0.0)).r;
          float right = texture(uState, vUv + vec2(uStateTexel.x, 0.0)).r;
          float down = texture(uState, vUv - vec2(0.0, uStateTexel.y)).r;
          float up = texture(uState, vUv + vec2(0.0, uStateTexel.y)).r;
          vec2 displaced = vUv + vec2(left - right, down - up) * uIntensity;
          vec2 viewportPx = displaced * uViewport;
          float scale = max(uViewport.x / uSourceSize.x, uViewport.y / uSourceSize.y);
          vec2 displayed = uSourceSize * scale;
          vec2 offset = (uViewport - displayed) * uPosition;
          vec2 sourceUv = clamp((viewportPx - offset) / displayed, 0.0, 1.0);
          outColor = texture(uSource, sourceUv);
        }`;
      const simulationProgram = program(gl, vertexSource, simulationSource);
      const renderProgram = program(gl, vertexSource, renderSource);
      const vao = gl.createVertexArray();
      const sourceTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

      let resolution = config.quality === "low" ? 128 : config.quality === "high" ? 384 : 256;
      let targets = [];
      let readIndex = 0;
      let energyFrames = 0;
      let drop = null;
      let samples = [];
      const resources = [simulationProgram, renderProgram, vao, sourceTexture];

      const createTargets = () => {
        for (const target of targets) {
          gl.deleteFramebuffer(target.framebuffer);
          gl.deleteTexture(target.texture);
        }
        targets = [0, 1].map(() => {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const initial = new Uint8Array(resolution * resolution * 4);
          for (let index = 0; index < initial.length; index += 4) {
            initial[index] = 128;
            initial[index + 1] = 128;
            initial[index + 3] = 255;
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, resolution, resolution, 0, gl.RGBA, gl.UNSIGNED_BYTE, initial);
          const framebuffer = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error("Ripple framebuffer is incomplete");
          }
          return { texture, framebuffer };
        });
        readIndex = 0;
      };
      createTargets();

      const render = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(renderProgram);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets[readIndex].texture);
        gl.uniform1i(gl.getUniformLocation(renderProgram, "uState"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(gl.getUniformLocation(renderProgram, "uSource"), 1);
        gl.uniform2f(gl.getUniformLocation(renderProgram, "uStateTexel"), 1 / resolution, 1 / resolution);
        gl.uniform2f(gl.getUniformLocation(renderProgram, "uSourceSize"), image.naturalWidth, image.naturalHeight);
        gl.uniform2f(gl.getUniformLocation(renderProgram, "uViewport"), canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(renderProgram, "uPosition"), position.xPercent / 100, position.yPercent / 100);
        gl.uniform1f(gl.getUniformLocation(renderProgram, "uIntensity"), clamp(config.intensity ?? 0.35, 0, 1) * 0.085);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };

      const simulate = () => {
        const writeIndex = 1 - readIndex;
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[writeIndex].framebuffer);
        gl.viewport(0, 0, resolution, resolution);
        gl.useProgram(simulationProgram);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets[readIndex].texture);
        gl.uniform1i(gl.getUniformLocation(simulationProgram, "uState"), 0);
        gl.uniform2f(gl.getUniformLocation(simulationProgram, "uTexel"), 1 / resolution, 1 / resolution);
        gl.uniform2f(gl.getUniformLocation(simulationProgram, "uDrop"), drop?.x ?? -1, drop?.y ?? -1);
        const view = viewport();
        gl.uniform2f(
          gl.getUniformLocation(simulationProgram, "uRadius"),
          (config.radiusPx ?? 24) / view.width,
          (config.radiusPx ?? 24) / view.height,
        );
        gl.uniform1f(gl.getUniformLocation(simulationProgram, "uDropActive"), drop ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(simulationProgram, "uDamping"), 0.985);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        readIndex = writeIndex;
        drop = null;
      };

      const tick = (time) => {
        animationFrame = 0;
        if (gl.isContextLost?.()) return fail("webgl-context-lost");
        if (disposed || fallback || !motionAllowed()) return render();
        const started = win.performance?.now?.() ?? time ?? 0;
        simulate();
        render();
        const elapsed = (win.performance?.now?.() ?? started) - started;
        if (config.quality === "auto") {
          samples.push(elapsed);
          if (samples.length >= 20) {
            const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
            samples = [];
            if (average > 22 && resolution > 128) {
              resolution = 128;
              createTargets();
            }
          }
        }
        energyFrames -= 1;
        if (energyFrames > 0) animationFrame = requestFrame(tick);
        else notify();
      };
      const wake = (point) => {
        drop = point;
        energyFrames = Math.max(energyFrames, 96);
        if (!animationFrame && motionAllowed()) animationFrame = requestFrame(tick);
      };
      const stop = () => {
        energyFrames = 0;
        cancelFrame(animationFrame);
        animationFrame = 0;
        render();
      };
      const resize = () => render();
      const dispose = () => {
        cancelFrame(animationFrame);
        animationFrame = 0;
        for (const target of targets) {
          gl.deleteFramebuffer(target.framebuffer);
          gl.deleteTexture(target.texture);
        }
        gl.deleteTexture(sourceTexture);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(simulationProgram);
        gl.deleteProgram(renderProgram);
      };
      render();
      return { gl, wake, stop, resize, dispose, render };
    };

    const resize = () => {
      if (disposed) return;
      const view = viewport();
      const ratio = pixelRatio();
      const width = Math.max(1, Math.round(view.width * ratio));
      const height = Math.max(1, Math.round(view.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (mode === "directional") drawDirectional();
      else ripple?.resize();
    };

    const returnToIdle = () => {
      if (mode !== "directional" || disposed) return;
      win.clearTimeout?.(idleTimer);
      idleTimer = win.setTimeout?.(() => {
        currentFrame = config.idleFrame;
        drawDirectional(currentFrame);
        notify();
      }, 220) ?? 0;
    };

    const onPointerMove = (event) => {
      if (!ready || fallback || !motionAllowed()) return;
      if (mode === "ripple") {
        const view = viewport();
        ripple?.wake({ x: event.clientX / view.width, y: 1 - event.clientY / view.height });
        return;
      }
      pendingPointer = { x: event.clientX, y: event.clientY };
      if (pointerFrame) return;
      pointerFrame = requestFrame(() => {
        pointerFrame = 0;
        if (!pendingPointer || disposed || !motionAllowed()) return;
        const next = directionalFrameForPointer(config, pendingPointer, viewport(), currentFrame);
        pendingPointer = null;
        if (next !== currentFrame) {
          drawDirectional(next);
          notify();
        }
      });
    };

    const syncMotion = () => {
      if (mode === "directional") {
        if (!motionAllowed()) {
          currentFrame = config.idleFrame;
          drawDirectional(currentFrame);
        }
      } else if (!motionAllowed()) ripple?.stop();
      notify();
    };

    const onWindowBlur = () => {
      windowFocused = false;
      if (mode === "directional") returnToIdle();
      else ripple?.stop();
      notify();
    };

    const onWindowFocus = () => {
      windowFocused = true;
      notify();
    };

    const loadSource = (sourceUrl) => {
      if (!sourceUrl || typeof ImageConstructor !== "function") return fail("image-unavailable");
      const image = new ImageConstructor();
      image.onerror = () => fail("image-load-failed");
      image.onload = () => {
        if (disposed) return;
        sourceImage = image;
        if (mode === "directional") {
          const frameWidth = image.naturalWidth / config.columns;
          const frameHeight = image.naturalHeight / config.rows;
          if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) return fail("atlas-grid-mismatch");
          const probeCanvas = doc.createElement?.("canvas");
          if (probeCanvas && probeCanvas !== canvas) {
            try {
              const probeGl = probeCanvas.getContext?.("webgl2") || probeCanvas.getContext?.("webgl");
              if (probeGl && (image.naturalWidth > probeGl.getParameter(probeGl.MAX_TEXTURE_SIZE) ||
                  image.naturalHeight > probeGl.getParameter(probeGl.MAX_TEXTURE_SIZE))) {
                probeCanvas.remove?.();
                return fail("gpu-texture-limit");
              }
            } catch {}
            probeCanvas.remove?.();
          }
          ready = true;
          currentFrame = config.idleFrame;
          resize();
        } else {
          resize();
          try {
            ripple = createRipple(image);
          } catch {
            ripple = null;
          }
          if (!ripple) return fail("webgl-unavailable");
          ready = true;
          ripple.render();
        }
        notify();
      };
      image.src = sourceUrl;
    };

    listen(win, "resize", resize, { passive: true });
    listen(win, "pointermove", onPointerMove, { passive: true });
    listen(win, "blur", onWindowBlur);
    listen(win, "focus", onWindowFocus);
    listen(doc, "mouseleave", returnToIdle);
    listen(doc, "visibilitychange", syncMotion);
    listen(motionQuery, "change", syncMotion);
    listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault?.();
      fail("webgl-context-lost");
    });

    resize();
    loadSource(options.sourceUrl);

    return {
      canvas,
      setEnabled(value) {
        const nextEnabled = value === true;
        if (desiredEnabled === nextEnabled) return;
        desiredEnabled = nextEnabled;
        if (!desiredEnabled) returnToIdle();
        syncMotion();
      },
      setSource(sourceUrl) {
        if (ready || fallback) return false;
        loadSource(sourceUrl);
        return true;
      },
      setPosition(value) {
        const xPercent = Number(value?.xPercent);
        const yPercent = Number(value?.yPercent);
        if (![xPercent, yPercent].every((number) => Number.isFinite(number) && number >= 0 && number <= 100)) {
          return false;
        }
        if (position.xPercent === xPercent && position.yPercent === yPercent) return true;
        position = { xPercent, yPercent };
        if (mode === "directional") drawDirectional(currentFrame);
        else ripple?.render();
        notify();
        return true;
      },
      inspect() {
        return {
          mode,
          desiredEnabled,
          active: ready && !fallback && motionAllowed(),
          ready,
          fallback,
          frame: currentFrame,
          position: { ...position },
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        cancelFrame(animationFrame);
        cancelFrame(pointerFrame);
        win.clearTimeout?.(idleTimer);
        for (const remove of listeners.splice(0)) remove();
        ripple?.dispose();
        sourceImage = null;
        canvas.remove();
      },
    };
  }

  createBackgroundEffect.directionalFrameForPointer = directionalFrameForPointer;
  return createBackgroundEffect;
})()
