(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const html = document.documentElement;
  html.classList.add('js');

  const stage = $('#stage');
  const envelope = $('#envelope');
  const arrowBtn = $('#scrollDown');
  const rsvpFixedBtn = $('#toRsvp');
  const DESIGN_W = 402, ENV_H = 874;

  /* ---------- Core State Variables (hoisted to top to prevent TDZ errors) ---------- */
  let opened = false;
  let isInviteUsed = false;
  let isLinkValid = true;
  let invalidLinkReason = 'This link is not valid for registration. An official personal invitation link with a unique invitation code is required to RSVP.';
  let inviteCode = '';
  let sessionVerified = false;

  // Track unique invitation code ONLY from the URL query parameter (?code=... or ?invite=...)
  function getActiveInviteCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = (urlParams.get('code') || urlParams.get('invite') || '').trim().toUpperCase();
    if (fromUrl) {
      inviteCode = fromUrl;
      const hiddenInput = $('#formInviteCode');
      if (hiddenInput) hiddenInput.value = fromUrl;
      return fromUrl;
    }
    // No code in URL: this link itself is strictly NOT valid for registration
    inviteCode = '';
    isLinkValid = false;
    sessionStorage.removeItem('cayc_invite_code');
    localStorage.removeItem('cayc_invite_code');
    const hiddenInput = $('#formInviteCode');
    if (hiddenInput) hiddenInput.value = '';
    return '';
  }
  inviteCode = getActiveInviteCode();

  /* ---------- scale the 402px design to the viewport ---------- */
  function fit() {
    stage.style.setProperty('--s', Math.min(1, innerWidth / DESIGN_W));
    envelope.style.setProperty('--k', Math.min(1, innerWidth / DESIGN_W, innerHeight / ENV_H));
  }
  fit(); addEventListener('resize', fit);

  /* ---------- inject shared decoration into every screen ---------- */
  const tpl = $('#decor-tpl');
  $$('.screen[data-decor]').forEach(screen => {
    const frag = tpl.content.cloneNode(true);
    const decor = frag.querySelector('.decor');
    decor.style.setProperty('--dy', screen.dataset.dy || '0px');
    decor.style.setProperty('--flower-top', screen.dataset.flower || '-202px');
    screen.prepend(frag);
  });

  /* ---------- helpers ---------- */
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const EASE = {
    out: 'cubic-bezier(.22,1,.36,1)',
    inOut: 'cubic-bezier(.65,0,.35,1)',
    flap: 'cubic-bezier(.45,.05,.2,1)'
  };
  const anim = (el, keyframes, opts = {}) => {
    if (!el) return Promise.resolve();
    if (!el.animate) return Promise.resolve();
    return new Promise(resolve => {
      try {
        const a = el.animate(keyframes, { duration: 600, easing: EASE.out, fill: 'forwards', ...opts });
        if (a && a.finished) {
          a.finished.then(resolve).catch(resolve);
        } else if (a) {
          a.onfinish = resolve;
          a.onerror = resolve;
        } else {
          resolve();
        }
      } catch (err) {
        resolve();
      }
    });
  };

  /* ---------- floating UI indicators (fixed RSVP button + scroll arrow) ---------- */
  function setArrowVisible(visible) {
    if (!arrowBtn) return;
    arrowBtn.classList.toggle('is-hidden', !visible);
  }

  function setRsvpVisible(visible) {
    if (!rsvpFixedBtn) return;
    rsvpFixedBtn.classList.toggle('is-hidden', !visible);
  }

  function updateFloatingUi() {
    const inviteScreen = $('#invite');
    const isInviteActive = opened && inviteScreen && !inviteScreen.hidden;

    // Fixed RSVP button is visible whenever on invitation screen after envelope is opened
    setRsvpVisible(isInviteActive);

    if (rsvpFixedBtn) {
      if (!isLinkValid || !inviteCode) {
        rsvpFixedBtn.textContent = 'Invitation Code Required';
        rsvpFixedBtn.dataset.action = 'respond';
      } else if (isInviteUsed) {
        rsvpFixedBtn.textContent = 'View Guest Pass';
        rsvpFixedBtn.dataset.action = 'viewPass';
      } else {
        rsvpFixedBtn.textContent = 'Respond to invitation';
        rsvpFixedBtn.dataset.action = 'respond';
      }
    }

    if (!arrowBtn) return;
    if (!isInviteActive) {
      setArrowVisible(false);
      return;
    }

    // Hide scroll down arrow when scrolled near the end of the invitation
    const scale = parseFloat(stage.style.getPropertyValue('--s')) || 1;
    const atPageBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 60);
    const nearEnd = window.scrollY >= (2500 * scale);
    if (atPageBottom || nearEnd) {
      setArrowVisible(false);
    } else {
      setArrowVisible(true);
    }
  }

  function onScroll() {
    updateFloatingUi();
    if (isLeavesRunning && !hasLeavesFinished) {
      const y = window.scrollY;
      if (y > 35) {
        stopFallingLeaves(false);
      } else if (leavesCanvas) {
        const op = Math.max(0, 1 - (y / 35));
        leavesCanvas.style.opacity = String(op);
      }
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* ---------- screens ---------- */
  function populatePass(name, no) {
    if (name) $('#passName').textContent = name;
    if (no) {
      const numStr = String(no).padStart(3, '0');
      $('#passNo').textContent = `GUEST ${numStr}`;
      $('#passRef').textContent = `GL · 2026 · ${numStr}`;
    }
    const passBack = $('#pass .back');
    if (passBack) {
      passBack.dataset.go = 'invite';
      passBack.innerHTML = '<img src="assets/icon-back.svg" alt="">Invitation';
    }
  }

  /* ---------- Message Box Modal ---------- */
  const msgBox = $('#msgBoxModal');
  const msgBoxText = $('#msgBoxText');
  const msgBoxTitle = $('#msgBoxTitle');
  const msgBoxCloseBtn = $('#msgBoxCloseBtn');

  function showMsgBox(message, title = 'Notice') {
    if (msgBoxText) msgBoxText.textContent = message;
    if (msgBoxTitle) msgBoxTitle.textContent = title;
    if (msgBox) msgBox.style.display = 'flex';
  }

  function hideMsgBox() {
    if (msgBox) msgBox.style.display = 'none';
  }

  if (msgBoxCloseBtn) msgBoxCloseBtn.addEventListener('click', hideMsgBox);
  if (msgBox) {
    msgBox.addEventListener('click', e => {
      if (e.target === msgBox) hideMsgBox();
    });
  }

  const screens = $$('.screen');
  function show(id) {
    if (id !== 'invite') {
      stopFallingLeaves(true);
    }
    if ((!isLinkValid || !inviteCode) && (id === 'form' || id === 'confirm')) {
      showMsgBox(invalidLinkReason, 'Invitation Required');
      return;
    }
    if (isInviteUsed && (id === 'form' || id === 'confirm')) {
      id = sessionVerified ? 'pass' : 'alreadyUsed';
    }
    if (isInviteUsed && id === 'pass' && !sessionVerified) {
      id = 'alreadyUsed';
    }
    screens.forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
    document.body.dataset.bg = 'cream';
    updateFloatingUi();
  }

  /* ---------- Falling Leaves & Golden Petals Engine ---------- */
  let leavesCanvas = null;
  let leavesCtx = null;
  let leavesAnimId = null;
  let leavesList = [];
  let isLeavesRunning = false;
  let canSpawnLeaves = false;
  let hasLeavesFinished = false;
  let spawnTimer = null;
  const LEAF_COUNT = 36;

  function initFallingLeaves() {
    leavesCanvas = document.getElementById('fallingLeavesCanvas');
    if (!leavesCanvas) return;
    leavesCtx = leavesCanvas.getContext('2d');
    resizeLeavesCanvas();
    window.addEventListener('resize', resizeLeavesCanvas);
  }

  function resizeLeavesCanvas() {
    if (!leavesCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    leavesCanvas.width = window.innerWidth * dpr;
    leavesCanvas.height = window.innerHeight * dpr;
    if (leavesCtx) leavesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createLeafParticle(initialY) {
    const w = window.innerWidth;
    const types = ['goldLeaf', 'rosePetal', 'amberLeaf', 'goldFlake'];
    const type = types[Math.floor(Math.random() * types.length)];

    const colors = {
      goldLeaf: ['#e5a93b', '#f5cb5c', '#d49428'],
      rosePetal: ['#e89578', '#f2b199', '#f7cca0'],
      amberLeaf: ['#c97e2e', '#e3993d', '#f0b768'],
      goldFlake: ['#f4c72f', '#f9da6a', '#e8b828']
    };
    const palette = colors[type];
    const color = palette[Math.floor(Math.random() * palette.length)];

    return {
      type,
      color,
      x: Math.random() * w,
      y: initialY !== undefined ? initialY : -35 - Math.random() * 50,
      size: type === 'goldFlake' ? 4 + Math.random() * 4 : 10 + Math.random() * 11,
      speedY: 0.85 + Math.random() * 1.35,
      speedX: -0.3 + Math.random() * 0.6,
      swayAngle: Math.random() * Math.PI * 2,
      swaySpeed: 0.015 + Math.random() * 0.02,
      swayRadius: 0.8 + Math.random() * 1.3,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: -0.015 + Math.random() * 0.03,
      flipAngle: Math.random() * Math.PI * 2,
      flipSpeed: 0.015 + Math.random() * 0.03,
      opacity: 0.45 + Math.random() * 0.45
    };
  }

  function drawLeaf(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.scale(Math.cos(p.flipAngle), 1);
    ctx.globalAlpha = p.opacity;

    if (p.type === 'rosePetal') {
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.bezierCurveTo(p.size * 0.85, -p.size * 0.5, p.size * 0.9, p.size * 0.6, 0, p.size);
      ctx.bezierCurveTo(-p.size * 0.9, p.size * 0.6, -p.size * 0.85, -p.size * 0.5, 0, -p.size);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.type === 'goldFlake') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.quadraticCurveTo(p.size * 0.65, 0, 0, p.size);
      ctx.quadraticCurveTo(-p.size * 0.65, 0, 0, -p.size);
      ctx.fillStyle = p.color;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, -p.size * 0.7);
      ctx.lineTo(0, p.size * 0.8);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.restore();
  }

  function updateAndDrawLeaves() {
    if (!leavesCtx || !leavesCanvas || !isLeavesRunning) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    leavesCtx.clearRect(0, 0, w, h);

    let activeCount = 0;
    for (let i = 0; i < leavesList.length; i++) {
      const p = leavesList[i];
      if (!p) continue;
      p.swayAngle += p.swaySpeed;
      p.rotation += p.rotationSpeed;
      p.flipAngle += p.flipSpeed;
      p.y += p.speedY;
      p.x += Math.sin(p.swayAngle) * p.swayRadius + p.speedX;

      drawLeaf(leavesCtx, p);

      if (p.y > h + 35 || p.x < -35 || p.x > w + 35) {
        if (canSpawnLeaves) {
          leavesList[i] = createLeafParticle(-30);
          activeCount++;
        } else {
          leavesList[i] = null;
        }
      } else {
        activeCount++;
      }
    }

    if (activeCount === 0 && !canSpawnLeaves) {
      stopFallingLeaves(true);
      return;
    }

    leavesAnimId = requestAnimationFrame(updateAndDrawLeaves);
  }

  function stopFallingLeaves(immediate = false) {
    canSpawnLeaves = false;
    isLeavesRunning = false;
    hasLeavesFinished = true;
    if (spawnTimer) {
      clearTimeout(spawnTimer);
      spawnTimer = null;
    }
    if (leavesCanvas) {
      leavesCanvas.classList.remove('is-active');
      if (immediate) {
        leavesCanvas.style.opacity = '0';
        leavesCanvas.style.display = 'none';
        if (leavesCtx) leavesCtx.clearRect(0, 0, leavesCanvas.width, leavesCanvas.height);
        if (leavesAnimId) {
          cancelAnimationFrame(leavesAnimId);
          leavesAnimId = null;
        }
        leavesList = [];
      } else {
        leavesCanvas.style.opacity = '0';
        setTimeout(() => {
          if (!isLeavesRunning && leavesCanvas) {
            leavesCanvas.style.display = 'none';
            if (leavesCtx) leavesCtx.clearRect(0, 0, leavesCanvas.width, leavesCanvas.height);
            if (leavesAnimId) {
              cancelAnimationFrame(leavesAnimId);
              leavesAnimId = null;
            }
            leavesList = [];
          }
        }, 450);
      }
    }
  }

  function startFallingLeaves() {
    if (isLeavesRunning || hasLeavesFinished) return;
    const inviteScreen = document.getElementById('invite');
    if (!inviteScreen || inviteScreen.hidden) return;
    if (window.scrollY > 30) return;

    if (!leavesCanvas) initFallingLeaves();
    if (!leavesCanvas) return;

    isLeavesRunning = true;
    canSpawnLeaves = true;
    leavesCanvas.style.display = 'block';
    leavesCanvas.style.opacity = '1';
    leavesCanvas.classList.add('is-active');

    const h = window.innerHeight;
    leavesList = [];
    for (let i = 0; i < LEAF_COUNT; i++) {
      leavesList.push(createLeafParticle(-30 + Math.random() * (h * 0.75)));
    }

    if (leavesAnimId) cancelAnimationFrame(leavesAnimId);
    leavesAnimId = requestAnimationFrame(updateAndDrawLeaves);

    if (spawnTimer) clearTimeout(spawnTimer);
    spawnTimer = setTimeout(() => {
      canSpawnLeaves = false;
    }, 6500);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (leavesAnimId) cancelAnimationFrame(leavesAnimId);
    } else if (isLeavesRunning) {
      leavesAnimId = requestAnimationFrame(updateAndDrawLeaves);
    }
  });

  /* ---------- envelope opening (smooth Figma Smart Animate split) ---------- */
  function finishOpen() {
    opened = true;
    if (envelope) {
      envelope.hidden = true;
      envelope.style.display = 'none';
      envelope.style.pointerEvents = 'none';
    }
    html.classList.remove('locked');
    document.body.dataset.bg = 'cream';
    updateFloatingUi();
    startFallingLeaves();
  }
  window.finishOpen = finishOpen;

  async function openEnvelope() {
    if (opened) return;
    opened = true;
    const seal = $('#seal'),
          envTop = $('#envTop'),
          envBottom = $('#envBottom'),
          envBackdrop = $('#envBackdrop'),
          hint = $('#hint');
    if (seal) seal.disabled = true;

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await anim(envelope, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
      return finishOpen();
    }

    if (hint) anim(hint, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 400 });

    if (envBackdrop) envBackdrop.style.display = 'none';
    document.body.dataset.bg = 'cream';

    const DURATION = 2600; // Slow, graceful cinematic opening animation (2.6s)
    const EASING = 'cubic-bezier(0.35, 0, 0.15, 1)'; // Elegant, smooth ease-in-out curve with immediate continuous motion

    // Start falling leaves gracefully right as envelope begins sliding open
    setTimeout(() => {
      startFallingLeaves();
    }, 600);

    // Safety fallback: guarantee envelope disappears even if animation promises stall
    const fallbackTimer = setTimeout(() => {
      finishOpen();
    }, DURATION + 200);

    // Top section (flap + seal) slides smoothly UP
    const topAnim = anim(envTop, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-125%)' }
    ], { duration: DURATION, easing: EASING });

    // Bottom section (pocket body + fill) slides smoothly DOWN
    const bottomAnim = anim(envBottom, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(125%)' }
    ], { duration: DURATION, easing: EASING });

    await Promise.all([topAnim, bottomAnim]);
    clearTimeout(fallbackTimer);
    finishOpen();
  }

  /* ---------- Social Media Component & Platform Picker ---------- */
  const SOCIAL_PLATFORMS = [
    {
      id: 'facebook',
      name: 'Facebook',
      placeholder: 'Profile link or name',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M15.12 12.88l.54-3.53h-3.39V7.06c0-.97.48-1.91 2-1.91h1.54V2.15s-1.39-.24-2.72-.24c-2.79 0-4.61 1.69-4.61 4.73v2.71H5.38v3.53h3.09V21.4c.62.1 1.26.15 1.9.15s1.28-.05 1.9-.15v-8.52h2.85z" fill="#FFFFFF"/></svg>'
    },
    {
      id: 'instagram',
      name: 'Instagram',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" class="ig-svg-icon" style="background:radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%); border-radius:6px;"><rect width="24" height="24" rx="6" fill="url(#globalIgGrad)" style="opacity:0.99"/><rect x="4" y="4" width="16" height="16" rx="4.5" stroke="#FFFFFF" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="3.4" stroke="#FFFFFF" stroke-width="1.8" fill="none"/><circle cx="16.5" cy="7.5" r="1.1" fill="#FFFFFF"/></svg>'
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" style="background:#000000; border-radius:6px;"><rect width="24" height="24" rx="6" fill="#000000"/><path d="M16.8 8.12a4.4 4.4 0 0 1-2.92-1.72V14.6a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.6h2.2a4.38 4.38 0 0 0 2.9 2.52v2Z" fill="#25F4EE"/><path d="M16.3 7.62a4.4 4.4 0 0 1-2.42-1.22V14.1a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.1h2.2a4.38 4.38 0 0 0 2.4 2.52v2Z" fill="#FE2C55"/><path d="M16.5 7.87a4.4 4.4 0 0 1-2.67-1.47V14.35a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.35h2.2a4.38 4.38 0 0 0 2.65 2.52v2Z" fill="#FFFFFF"/></svg>'
    },
    {
      id: 'youtube',
      name: 'YouTube',
      placeholder: '@channel or link',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="1.5" y="3.5" width="21" height="17" rx="5" fill="#FF0000"/><path d="M10 8.5L15.5 12L10 15.5V8.5Z" fill="#FFFFFF"/></svg>'
    }
  ];

  const socialDropdownPanel = $('#socialDropdownPanel');
  const socialDropdownGrid = $('#socialDropdownGrid');
  const socialList = $('#socialList');
  const addSocialCircle = $('#addSocialCircle');
  const MAX_SOCIAL_ACCOUNTS = 4;
  let isDropdownOpen = false;

  function renderSocialDropdown() {
    if (!socialDropdownGrid || socialDropdownGrid.children.length > 0) return;
    socialDropdownGrid.innerHTML = SOCIAL_PLATFORMS.map(p => `
      <button type="button" class="social-drop-item" data-platform-id="${p.id}" title="${p.name}" aria-label="${p.name}">
        ${p.logoSvg}
      </button>
    `).join('');
  }

  function openSocialDropdown() {
    renderSocialDropdown();
    if (!socialDropdownPanel) return;
    isDropdownOpen = true;
    socialDropdownPanel.style.display = 'block';
    if (addSocialCircle) addSocialCircle.classList.add('is-open');
    requestAnimationFrame(() => {
      socialDropdownPanel.classList.add('is-active');
    });
  }

  function closeSocialDropdown() {
    if (!socialDropdownPanel || !isDropdownOpen) return;
    isDropdownOpen = false;
    if (addSocialCircle) addSocialCircle.classList.remove('is-open');
    socialDropdownPanel.classList.remove('is-active');
    setTimeout(() => {
      if (!isDropdownOpen && socialDropdownPanel) {
        socialDropdownPanel.style.display = 'none';
      }
    }, 280);
  }

  function toggleSocialDropdown() {
    if (isDropdownOpen) {
      closeSocialDropdown();
    } else {
      openSocialDropdown();
    }
  }

  function adjustFormBottomPosition() {
    const formEl = $('#guestForm');
    const dateText = $('#formDateText');
    const locText = $('#formLocText');
    if (!formEl || !dateText || !locText) return;
    const formBottom = formEl.offsetTop + formEl.offsetHeight;
    const baseDateTop = 1032;
    const targetDateTop = Math.max(baseDateTop, formBottom + 35);
    dateText.style.top = `${targetDateTop}px`;
    locText.style.top = `${targetDateTop + 18}px`;
  }

  function updateSocialVisibility() {
    const count = socialList ? socialList.children.length : 0;
    if (addSocialCircle) {
      addSocialCircle.disabled = count >= MAX_SOCIAL_ACCOUNTS;
      addSocialCircle.title = count >= MAX_SOCIAL_ACCOUNTS ? 'Maximum accounts reached' : 'Add social media account';
      addSocialCircle.style.opacity = count >= MAX_SOCIAL_ACCOUNTS ? '0.35' : '1';
    }
    adjustFormBottomPosition();
  }

  function addSocialAccount(platformId) {
    const platform = SOCIAL_PLATFORMS.find(p => p.id === platformId) || SOCIAL_PLATFORMS[0];
    if (!socialList) return;
    if (socialList.children.length >= MAX_SOCIAL_ACCOUNTS) return;

    const row = document.createElement('div');
    row.className = 'social-input-row';
    row.dataset.platform = platform.name;

    // Display ONLY the brand logo on the left (no text label)
    row.innerHTML = `
      <div class="social-input-box">
        <div class="social-box-left" title="${platform.name}">
          <span class="social-logo-wrap">${platform.logoSvg}</span>
        </div>
        <div class="social-box-divider"></div>
        <input type="text" class="social-inner-input" placeholder="${platform.placeholder}" autocomplete="off" spellcheck="false" title="${platform.name}">
        <button type="button" class="social-row-remove" aria-label="Remove ${platform.name} account" title="Remove account">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;

    const removeBtn = row.querySelector('.social-row-remove');
    removeBtn.addEventListener('click', () => {
      row.classList.add('removing');
      setTimeout(() => {
        row.remove();
        updateSocialVisibility();
      }, 230);
    });

    socialList.appendChild(row);
    updateSocialVisibility();
    closeSocialDropdown();

    const input = row.querySelector('.social-inner-input');
    if (input) {
      setTimeout(() => input.focus(), 60);
    }
  }

  function resetSocialAccounts() {
    if (socialList) socialList.innerHTML = '';
    closeSocialDropdown();
    updateSocialVisibility();
  }

  if (socialDropdownPanel) {
    socialDropdownPanel.addEventListener('click', e => {
      e.stopPropagation();
    });
  }

  if (socialDropdownGrid) {
    socialDropdownGrid.addEventListener('click', e => {
      const btn = e.target.closest('.social-drop-item');
      if (btn && btn.dataset.platformId) {
        e.preventDefault();
        e.stopPropagation();
        addSocialAccount(btn.dataset.platformId);
      }
    });
  }

  if (addSocialCircle) {
    addSocialCircle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleSocialDropdown();
    });
  }

  document.addEventListener('click', e => {
    if (!isDropdownOpen) return;
    if (!e.target.closest('.social-field-wrap')) {
      closeSocialDropdown();
    }
  });

  /* ---------- RSVP + form ---------- */
  const form = $('#guestForm');
  const rules = {
    first: v => v.trim().length > 0,
    last: v => v.trim().length > 0,
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    mobile: v => v.replace(/\D/g, '').length >= 10
  };
  const setInvalid = (el, bad) => el.closest('.field').classList.toggle('invalid', bad);
  Object.keys(rules).forEach(id => {
    const el = $('#' + id);
    el.addEventListener('input', () => setInvalid(el, !rules[id](el.value)));
  });

  // Submit RSVP to backend (MongoDB Atlas) with unique link support & automatic retry
  async function submitRSVP(payload) {
    const codeToSend = getActiveInviteCode();
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, code: codeToSend })
      });
      const data = await res.json();
      if (!res.ok && (data.error === 'service_unavailable' || res.status === 503)) {
        // Cold start auto-retry
        await new Promise(r => setTimeout(r, 1000));
        const retryRes = await fetch('/api/rsvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, code: codeToSend })
        });
        const retryData = await retryRes.json();
        return { ok: retryRes.ok, status: retryRes.status, ...retryData };
      }
      return { ok: res.ok, status: res.status, ...data };
    } catch (err) {
      console.warn('API endpoint unavailable', err);
    }
    return null;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    let ok = true;
    for (const [id, test] of Object.entries(rules)) {
      const el = $('#' + id), bad = !test(el.value);
      setInvalid(el, bad); if (bad) ok = false;
    }
    const consent = $('#consent');
    $('#consentWrap').classList.toggle('invalid', !consent.checked);
    if (!consent.checked) ok = false;
    if (!ok) { $('.field.invalid input, .field.invalid textarea', form)?.focus(); return; }

    const activeCode = getActiveInviteCode();
    if (!activeCode || !isLinkValid) {
      showMsgBox(invalidLinkReason);
      return;
    }

    const submitBtn = $('.submit', form);
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving RSVP...';
    }

    const data = Object.fromEntries(new FormData(form));
    // Collect all dynamic social media accounts formatted nicely: "Platform: username"
    const socialRows = $$('.social-input-row', form);
    data.social = socialRows.map(row => {
      const platformName = row.dataset.platform || 'Social';
      const input = row.querySelector('.social-inner-input');
      const val = input ? input.value.trim() : '';
      if (!val) return null;
      return `${platformName}: ${val}`;
    }).filter(Boolean);

    data.response = 'accepted';

    const serverRes = await submitRSVP(data);

    if (serverRes && !serverRes.ok) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & get my guest pass';
      }
      if (serverRes.error === 'already_used') {
        isInviteUsed = true;
        showMsgBox('This invitation link has already been registered and cannot be reused.', 'Notice');
        show('alreadyUsed');
        return;
      } else if (serverRes.error === 'invalid_link') {
        isLinkValid = false;
        showMsgBox(serverRes.message || 'This invitation link is not valid.', 'Notice');
        return;
      } else {
        showMsgBox(serverRes.message || 'Unable to register RSVP. Please try again.', 'Notice');
        return;
      }
    }

    if (!serverRes) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & get my guest pass';
      }
      showMsgBox('Unable to reach server. Please check your internet connection and try again.', 'Notice');
      return;
    }

    // Mark as permanently used on client to lock the link from re-use
    isInviteUsed = true;
    sessionVerified = true;

    let num;
    if (serverRes && serverRes.no) {
      num = serverRes.no;
    } else {
      const n = store.get('gl-guest-count', 0) + 1;
      store.set('gl-guest-count', n);
      num = String(n).padStart(3, '0');
    }

    store.set('gl-rsvp', { ...data, no: num });

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm & get my guest pass';
    }

    form.reset();
    resetSocialAccounts();

    const badge = $('#passBadge'); if (badge) badge.innerHTML = '✓&nbsp; REGISTRATION COMPLETE';
    const headline = $('#passHeadline'); if (headline) headline.innerHTML = 'You’re on the<br>guest list!';
    $('#passName').textContent = `${data.first.trim()} ${data.last.trim()}`;
    $('#passNo').textContent = `GUEST ${num}`;
    $('#passRef').textContent = `GL · 2026 · ${num}`;
    const pass = $('.pass'); pass.style.animation = 'none'; void pass.offsetWidth; pass.style.animation = '';
    const passBack = $('#pass .back');
    if (passBack) {
      passBack.dataset.go = 'invite';
      passBack.innerHTML = '<img src="assets/icon-back.svg" alt="">Invitation';
    }
    show('pass');
  });

  // Verify Name & Mobile Number for Already Used Links
  const claimPassForm = $('#claimPassForm');
  if (claimPassForm) {
    claimPassForm.addEventListener('submit', async e => {
      e.preventDefault();
      const nameInput = $('#claimName');
      const mobileInput = $('#claimMobile');
      const errEl = $('#claimError');
      const submitBtn = $('#claimSubmitBtn');

      if (!nameInput.value.trim() || !mobileInput.value.trim()) {
        errEl.textContent = 'Please enter both your full name and contact number.';
        errEl.style.display = 'block';
        return;
      }

      errEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying Details...';

      try {
        const res = await fetch('/api/invite/claim-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: inviteCode,
            fullName: nameInput.value.trim(),
            mobile: mobileInput.value.trim()
          })
        });
        const data = await res.json();
        if (data.ok && data.pass) {
          sessionVerified = true;
          const p = data.pass;
          const badge = $('#passBadge'); if (badge) badge.innerHTML = '✓&nbsp; VERIFIED GUEST PASS';
          const headline = $('#passHeadline'); if (headline) headline.innerHTML = 'Your Special<br>Guest Pass';
          $('#passName').textContent = p.name;
          const numStr = String(p.no || '001').padStart(3, '0');
          $('#passNo').textContent = `GUEST ${numStr}`;
          $('#passRef').textContent = `GL · 2026 · ${numStr}`;
          const pass = $('.pass'); pass.style.animation = 'none'; void pass.offsetWidth; pass.style.animation = '';
          const passBack = $('#pass .back');
          if (passBack) {
            passBack.dataset.go = 'invite';
            passBack.innerHTML = '<img src="assets/icon-back.svg" alt="">Invitation';
          }
          show('pass');
        } else {
          errEl.textContent = data.error || 'Name or contact number does not match this invitation.';
          errEl.style.display = 'block';
        }
      } catch (err) {
        errEl.textContent = 'Verification error. Please try again.';
        errEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify & View Pass';
      }
    });
  }

  /* ---------- Download Guest Pass as High-Resolution Ticket Image ---------- */
  async function downloadGuestPass() {
    const btn = $('#downloadPassBtn');
    const btnText = $('#downloadBtnText');
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Generating Pass...';

    try {
      if (document.fonts) {
        await document.fonts.ready;
      }

      const passName = ($('#passName')?.textContent || 'Juan Dela Cruz').trim();
      const passNo = ($('#passNo')?.textContent || 'GUEST 001').trim();
      const passRef = ($('#passRef')?.textContent || 'GL · 2026 · 001').trim();
      const passBadge = ($('#passBadge')?.textContent || 'VERIFIED GUEST PASS').trim().replace(/^[✓\s]+/, '');

      const canvas = document.createElement('canvas');
      const w = 800;
      const h = 1420;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      function roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
      }

      // Outer canvas background (soft warm luxury cream)
      const outerGrad = ctx.createLinearGradient(0, 0, w, h);
      outerGrad.addColorStop(0, '#fefbf3');
      outerGrad.addColorStop(0.5, '#fef6e2');
      outerGrad.addColorStop(1, '#fef9ee');
      ctx.fillStyle = outerGrad;
      ctx.fillRect(0, 0, w, h);

      // VIP Pass Main Card
      const cardX = 40;
      const cardY = 40;
      const cardW = w - 80;
      const cardH = h - 80;
      const cardR = 36;

      ctx.save();
      ctx.shadowColor = 'rgba(88, 44, 14, 0.18)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 16;

      const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      cardGrad.addColorStop(0, '#ffffff');
      cardGrad.addColorStop(0.4, '#fffbf0');
      cardGrad.addColorStop(0.8, '#fffdf8');
      cardGrad.addColorStop(1, '#ffffff');

      roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.fillStyle = cardGrad;
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.strokeStyle = '#d8c9a3';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // Top Decorative Ribbon
      const ribbonW = 260;
      const ribbonH = 40;
      const ribbonX = (w - ribbonW) / 2;
      const ribbonY = cardY + 36;
      roundRect(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 20);
      ctx.fillStyle = 'rgba(230, 234, 211, 0.95)';
      ctx.fill();
      ctx.fillStyle = '#40532c';
      ctx.font = '600 13px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓  ' + passBadge.toUpperCase(), w / 2, ribbonY + ribbonH / 2);

      // Goldilocks Brand Logo
      await new Promise(resolve => {
        const logoImg = new Image();
        logoImg.onload = () => {
          const logoW = 180;
          const logoH = 45;
          ctx.drawImage(logoImg, (w - logoW) / 2, cardY + 95, logoW, logoH);
          resolve();
        };
        logoImg.onerror = () => {
          // Fallback text if logo image is unavailable
          ctx.fillStyle = '#582c00';
          ctx.font = 'bold 28px "Cormorant Garamond", Georgia, serif';
          ctx.fillText('Goldilocks', w / 2, cardY + 125);
          resolve();
        };
        logoImg.src = 'assets/logo.png';
      });

      // Eyebrow
      ctx.fillStyle = '#8c6225';
      ctx.font = '600 13px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GOLDILOCKS  /  EXCLUSIVE INVITATION', w / 2, cardY + 175);

      // Title: Special Guest Pass
      ctx.fillStyle = '#3c1e08';
      ctx.font = 'bold 52px "Cormorant Garamond", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Special Guest Pass', w / 2, cardY + 245);

      // Chip: ADMIT ONE
      const chipW = 150;
      const chipH = 36;
      const chipX = (w - chipW) / 2;
      const chipY = cardY + 280;
      roundRect(ctx, chipX, chipY, chipW, chipH, 18);
      ctx.fillStyle = 'rgba(120, 80, 33, 0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(185, 138, 63, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#582c00';
      ctx.font = '600 13px Montserrat, sans-serif';
      ctx.fillText('ADMIT ONE', w / 2, chipY + chipH / 2 + 1);

      // Event Details
      ctx.fillStyle = '#3c1e08';
      ctx.font = 'bold 22px Montserrat, sans-serif';
      ctx.fillText('CAKE ALL YOU CAN', w / 2, cardY + 370);

      ctx.fillStyle = '#7a6348';
      ctx.font = '500 18px Montserrat, sans-serif';
      ctx.fillText('International Cake Day', w / 2, cardY + 402);

      // Golden Divider
      ctx.beginPath();
      ctx.moveTo(cardX + 60, cardY + 440);
      ctx.lineTo(cardX + cardW - 60, cardY + 440);
      ctx.strokeStyle = 'rgba(185, 138, 63, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Prepared For
      ctx.fillStyle = '#997a53';
      ctx.font = '600 14px Montserrat, sans-serif';
      ctx.fillText('PREPARED FOR', w / 2, cardY + 480);

      // Guest Name (auto-adjust size for long names)
      let nameFontSize = 46;
      if (passName.length > 20) nameFontSize = 36;
      if (passName.length > 30) nameFontSize = 28;
      ctx.fillStyle = '#3c1e08';
      ctx.font = `bold ${nameFontSize}px "Cormorant Garamond", Georgia, serif`;
      ctx.fillText(passName, w / 2, cardY + 540);

      // Schedule & Venue
      ctx.fillStyle = '#3c1e08';
      ctx.font = 'bold 20px Montserrat, sans-serif';
      ctx.fillText('November 30, 2026', w / 2, cardY + 615);

      ctx.fillStyle = '#582c00';
      ctx.font = '500 18px Montserrat, sans-serif';
      ctx.fillText('3:00 PM – 8:00 PM', w / 2, cardY + 648);

      ctx.fillStyle = '#4a2603';
      ctx.font = '500 17px Montserrat, sans-serif';
      ctx.fillText('Level 1, Expansion Activity Area', w / 2, cardY + 705);
      ctx.fillText('Robinsons Marasbaras Tacloban', w / 2, cardY + 735);

      // Perforated line & ticket notches
      const notchY = cardY + 810;
      const notchRadius = 24;

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([8, 8]);
      ctx.moveTo(cardX + notchRadius + 5, notchY);
      ctx.lineTo(cardX + cardW - notchRadius - 5, notchY);
      ctx.strokeStyle = 'rgba(185, 138, 63, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cardX, notchY, notchRadius, -Math.PI / 2, Math.PI / 2);
      ctx.fillStyle = '#fef6e2';
      ctx.fill();
      ctx.strokeStyle = '#d8c9a3';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cardX + cardW, notchY, notchRadius, Math.PI / 2, -Math.PI / 2);
      ctx.fillStyle = '#fef6e2';
      ctx.fill();
      ctx.strokeStyle = '#d8c9a3';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // Bottom Stub
      const stubY = notchY + 30;
      const stubH = (cardY + cardH) - stubY - 20;

      roundRect(ctx, cardX + 24, stubY, cardW - 48, stubH, 20);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(216, 201, 163, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Guest Number (Left)
      ctx.fillStyle = '#3c1e08';
      ctx.font = 'bold 24px Montserrat, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(passNo, cardX + 50, stubY + 55);

      // Ref Code (Right)
      ctx.fillStyle = '#7a6348';
      ctx.font = '600 17px Montserrat, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(passRef, cardX + cardW - 50, stubY + 55);

      // Divider inside stub
      ctx.beginPath();
      ctx.moveTo(cardX + 50, stubY + 80);
      ctx.lineTo(cardX + cardW - 50, stubY + 80);
      ctx.strokeStyle = 'rgba(185, 138, 63, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Check-in notice
      ctx.fillStyle = '#8c7355';
      ctx.font = '500 15px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Official Guest Pass · Present at Event Check-in', w / 2, stubY + 125);
      ctx.fillText('Valid for one (1) admitted guest only', w / 2, stubY + 155);

      ctx.fillStyle = '#582c00';
      ctx.font = 'italic 16px "Cormorant Garamond", Georgia, serif';
      ctx.fillText('Warmest regards, The Goldilocks Team', w / 2, stubY + 205);

      function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      const fileSafeName = passName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Goldilocks_GuestPass_${fileSafeName}.png`;

      const onDownloadComplete = () => {
        if (btnText) btnText.textContent = '✓ Pass Downloaded!';
        if (btn) btn.classList.add('is-success');
        setTimeout(() => {
          if (btnText) btnText.textContent = 'Download Guest Pass';
          if (btn) {
            btn.classList.remove('is-success');
            btn.disabled = false;
          }
        }, 2500);
      };

      if (canvas.toBlob) {
        canvas.toBlob(blob => {
          if (!blob) {
            triggerDownload(canvas.toDataURL('image/png'), fileName);
            onDownloadComplete();
            return;
          }
          const blobUrl = URL.createObjectURL(blob);
          triggerDownload(blobUrl, fileName);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
          onDownloadComplete();
        }, 'image/png');
      } else {
        triggerDownload(canvas.toDataURL('image/png'), fileName);
        onDownloadComplete();
      }

    } catch (err) {
      console.error('Download pass error:', err);
      if (btnText) btnText.textContent = 'Download Guest Pass';
      if (btn) btn.disabled = false;
      showMsgBox('Unable to generate pass image. Please take a screenshot of your pass instead.', 'Notice');
    }
  }

  /* ---------- every button, through one delegated handler ---------- */
  const actions = {
    viewPass: () => {
      if (!isLinkValid || !inviteCode) {
        showMsgBox(invalidLinkReason, 'Invitation Required');
        return;
      }
      if (sessionVerified) {
        show('pass');
      } else {
        show('alreadyUsed');
      }
    },
    open: () => {
      openEnvelope();
    },
    respond: () => {
      if (!isLinkValid || !inviteCode) {
        showMsgBox(invalidLinkReason, 'Invitation Required');
        return;
      }
      if (isInviteUsed) {
        if (sessionVerified) {
          show('pass');
        } else {
          show('alreadyUsed');
        }
        return;
      }
      show('confirm');
    },
    accept: () => {
      if (!isLinkValid || !inviteCode) {
        showMsgBox(invalidLinkReason, 'Invitation Required');
        return;
      }
      if (isInviteUsed) {
        if (sessionVerified) {
          show('pass');
        } else {
          show('alreadyUsed');
        }
        return;
      }
      show('form');
    },
    decline: () => {
      if (!isLinkValid || !inviteCode) {
        showMsgBox(invalidLinkReason, 'Invitation Required');
        return;
      }
      if (isInviteUsed) {
        if (sessionVerified) {
          show('pass');
        } else {
          show('alreadyUsed');
        }
        return;
      }
      fetch('/api/rsvp/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode, at: new Date().toISOString() })
      }).catch(() => {});
      store.set('gl-rsvp', { response: 'declined', at: new Date().toISOString() });
      show('declined');
    },
    backToInvite: () => show('invite'),
    scrollDown: () => {
      const scale = parseFloat(stage.style.getPropertyValue('--s')) || 1;
      const landmarks = [1060, 1350, 1680, 2180, 2740];
      const currentY = window.scrollY;
      for (const lm of landmarks) {
        const targetY = lm * scale;
        if (targetY > currentY + 50) {
          window.scrollTo({ top: targetY, behavior: 'smooth' });
          return;
        }
      }
      window.scrollBy({ top: window.innerHeight * 0.82, behavior: 'smooth' });
    },
    toggleSocialDropdown: () => {
      toggleSocialDropdown();
    },
    addSocial: () => {
      toggleSocialDropdown();
    },
    openSocialPicker: () => {
      toggleSocialDropdown();
    },
    downloadPass: () => {
      downloadGuestPass();
    }
  };
  document.addEventListener('click', e => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { show(goBtn.dataset.go); return; }
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  });
  // Direct envelope click listeners: clicking seal or envelope immediately opens it
  const sealBtn = $('#seal');
  if (sealBtn) {
    sealBtn.dataset.action = 'open';
    sealBtn.addEventListener('click', e => {
      e.stopPropagation();
      openEnvelope();
    });
  }
  if (envelope) {
    envelope.addEventListener('click', () => {
      openEnvelope();
    });
  }
  const envTopEl = $('#envTop');
  if (envTopEl) {
    envTopEl.addEventListener('click', () => {
      openEnvelope();
    });
  }
  const envBottomEl = $('#envBottom');
  if (envBottomEl) {
    envBottomEl.addEventListener('click', () => {
      openEnvelope();
    });
  }

  /* ---------- Pinned paper note wind breeze flutter on touch ---------- */
  const paperContainer = $('#pinnedPaperContainer');
  const paperSheet = $('#pinnedPaperSheet');
  if (paperContainer && paperSheet) {
    let windTimer = null;
    const triggerPaperWind = () => {
      paperSheet.classList.add('is-wind-flutter');
      clearTimeout(windTimer);
      windTimer = setTimeout(() => {
        paperSheet.classList.remove('is-wind-flutter');
      }, 2800);
    };
    paperContainer.addEventListener('touchstart', triggerPaperWind, { passive: true });
    paperContainer.addEventListener('click', triggerPaperWind);
  }

  /* ---------- 3D Golden Gift Box tap interaction for mobile ---------- */
  const giftWrap = $('#giftBoxWrap');
  const giftBox = $('#giftBoxImg');
  if (giftWrap && giftBox) {
    let giftTimer = null;
    const triggerGiftShake = () => {
      giftBox.classList.add('is-shaking');
      clearTimeout(giftTimer);
      giftTimer = setTimeout(() => {
        giftBox.classList.remove('is-shaking');
      }, 1800);
    };
    giftWrap.addEventListener('touchstart', triggerGiftShake, { passive: true });
    giftWrap.addEventListener('click', triggerGiftShake);
  }

  /* ---------- start ---------- */
  async function initInvitation() {
    const activeCode = getActiveInviteCode();
    if (!activeCode) {
      isLinkValid = false;
      invalidLinkReason = 'This link is not valid for registration. An official personal invitation link with a unique invitation code is required to RSVP.';
      showMsgBox(invalidLinkReason, 'Invitation Required');
      show('invite');
      document.body.dataset.bg = 'gold';
      setArrowVisible(false);
      setRsvpVisible(false);
      return;
    }

    try {
      let res = await fetch(`/api/invite/verify?code=${encodeURIComponent(activeCode)}`);
      let data = await res.json();
      if (res.status === 503 || data.error === 'db_connecting') {
        // Cold start retry
        await new Promise(r => setTimeout(r, 1000));
        res = await fetch(`/api/invite/verify?code=${encodeURIComponent(activeCode)}`);
        data = await res.json();
      }

      if (data.ok) {
        isLinkValid = true;
        if (data.status === 'used') {
          isInviteUsed = true;
          const passBack = $('#pass .back');
          if (passBack) {
            passBack.dataset.go = 'invite';
            passBack.innerHTML = '<img src="assets/icon-back.svg" alt="">Invitation';
          }
        } else if (data.status === 'declined') {
          opened = true; envelope.hidden = true; html.classList.remove('locked');
          show('declined');
          return;
        }
      } else if (data.error === 'not_found' || res.status === 404) {
        isLinkValid = false;
        invalidLinkReason = 'This invitation code was not found in the official guest list. An official personal invitation link is required to RSVP.';
        showMsgBox(invalidLinkReason, 'Invalid Link');
        show('invite');
        document.body.dataset.bg = 'gold';
        setArrowVisible(false);
        setRsvpVisible(false);
        return;
      }
    } catch (e) {
      console.warn('Backend verification offline', e);
    }

    const startId = location.hash.slice(1);
    const startEl = startId && document.getElementById(startId);
    if (startEl && startEl.classList.contains('screen') && startId !== 'invite') {
      if ((!isLinkValid || !inviteCode) && (startId === 'form' || startId === 'confirm')) {
        showMsgBox(invalidLinkReason, 'Invitation Required');
        show('invite');
        return;
      }
      if (isInviteUsed) {
        opened = true; envelope.hidden = true; html.classList.remove('locked');
        if (startId === 'pass' && !sessionVerified) {
          show('alreadyUsed');
        } else if (startId === 'form' || startId === 'confirm') {
          show('invite');
        } else {
          show(startId);
        }
        return;
      }
      // deep link – skip the envelope
      opened = true; envelope.hidden = true; html.classList.remove('locked');
      show(startId);
      return;
    }

    show('invite');
    document.body.dataset.bg = 'gold';
    setArrowVisible(false);
    setRsvpVisible(false);
  }
  initInvitation();
})();
