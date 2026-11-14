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
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M15.12 12.88l.54-3.53h-3.39V7.06c0-.97.48-1.91 2-1.91h1.54V2.15s-1.39-.24-2.72-.24c-2.79 0-4.61 1.69-4.61 4.73v2.71H5.38v3.53h3.09V21.4c.62.1 1.26.15 1.9.15s1.28-.05 1.9-.15v-8.52h2.85z" fill="white"/></svg>'
    },
    {
      id: 'instagram',
      name: 'Instagram',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><defs><radialGradient id="igG" cx="30%" cy="107%" r="150%"><stop offset="0%" stop-color="#fdf497"/><stop offset="5%" stop-color="#fdf497"/><stop offset="45%" stop-color="#fd5949"/><stop offset="60%" stop-color="#d6249f"/><stop offset="90%" stop-color="#285AEB"/></radialGradient></defs><rect width="24" height="24" rx="6.5" fill="url(#igG)"/><circle cx="12" cy="12" r="3.2" stroke="white" stroke-width="1.8" fill="none"/><rect x="4.5" y="4.5" width="15" height="15" rx="4" stroke="white" stroke-width="1.8" fill="none"/><circle cx="16.5" cy="7.5" r="1.1" fill="white"/></svg>'
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      placeholder: '+63 9... / contact number',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="12" fill="#25D366"/><path d="M17.5 14.4c-.3-.15-1.7-.85-2-1-.25-.1-.45-.15-.65.15-.2.3-.75 1-.9 1.2-.15.2-.35.2-.65.05-.3-.15-1.3-.5-2.45-1.55-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.45.15-.6.15-.15.3-.35.45-.5.15-.15.2-.3.3-.5.1-.2 0-.4-.05-.55-.1-.15-.65-1.6-.9-2.2-.25-.6-.5-.5-.65-.5H8c-.25 0-.6.1-.9.45-.35.35-1.2 1.15-1.2 2.8 0 1.65 1.25 3.25 1.4 3.45.2.2 2.45 3.75 5.95 5.25.85.35 1.5.6 2 .75.85.25 1.6.25 2.2.15.68-.1 2.08-.85 2.38-1.65.3-.85.3-1.55.2-1.7-.1-.15-.25-.25-.55-.4z" fill="white"/></svg>'
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect width="24" height="24" rx="6" fill="#000000"/><path d="M16.8 8.12a4.4 4.4 0 0 1-2.92-1.72V14.6a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.6h2.2a4.38 4.38 0 0 0 2.9 2.52v2Z" fill="#25F4EE"/><path d="M16.3 7.62a4.4 4.4 0 0 1-2.42-1.22V14.1a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.1h2.2a4.38 4.38 0 0 0 2.4 2.52v2Z" fill="#FE2C55"/><path d="M16.5 7.87a4.4 4.4 0 0 1-2.67-1.47V14.35a4.2 4.2 0 1 1-3.64-4.16v2.32a2.02 2.02 0 1 0 1.46 1.94V3.35h2.2a4.38 4.38 0 0 0 2.65 2.52v2Z" fill="#FFFFFF"/></svg>'
    },
    {
      id: 'messenger',
      name: 'Messenger',
      placeholder: 'm.me/username or name',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><defs><linearGradient id="msgG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00B2FE"/><stop offset="50%" stop-color="#006AFF"/><stop offset="100%" stop-color="#9B00E8"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#msgG)"/><path d="M12 4.2C7.7 4.2 4.2 7.3 4.2 11.2c0 2.2 1.1 4.2 2.9 5.5v2.8l2.7-1.5c.7.2 1.4.3 2.2.3 4.3 0 7.8-3.1 7.8-7S16.3 4.2 12 4.2zm1.2 9.5l-2.1-2.2-4.1 2.2 4.5-4.8 2.2 2.2 4-2.2-4.5 4.8z" fill="white"/></svg>'
    },
    {
      id: 'youtube',
      name: 'YouTube',
      placeholder: '@channel or link',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect width="24" height="24" rx="6" fill="#FF0000"/><path d="M10 8.5L15.5 12L10 15.5V8.5Z" fill="white"/></svg>'
    },
    {
      id: 'x',
      name: 'X (Twitter)',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect width="24" height="24" rx="6" fill="#000000"/><path d="M14.6 6H16.8L12 11.5 17.6 18H13.2L9.8 13.5 5.8 18H3.6L8.7 12.2 3.4 6H7.9L11 10.1 14.6 6ZM13.8 16.7H15L7.2 7.2H5.9L13.8 16.7Z" fill="white"/></svg>'
    },
    {
      id: 'telegram',
      name: 'Telegram',
      placeholder: '@username',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="12" fill="#2AABEE"/><path d="M5.5 11.8l10.8-4.4c.5-.2 1 .1.8.7l-1.8 8.6c-.1.6-.5.7-1 .4l-2.8-2.1-1.3 1.3c-.2.2-.3.3-.6.3l.2-2.8 5.1-4.6c.2-.2 0-.3-.3-.1l-6.3 4-2.7-.9c-.6-.2-.6-.6.1-.8z" fill="white"/></svg>'
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      placeholder: 'Profile link or name',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect width="24" height="24" rx="6" fill="#0A66C2"/><path d="M7.8 9.5H5.2V18h2.6V9.5zM6.5 6a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8zM18.8 12.8c0-2.6-1.4-3.8-3.3-3.8-1.5 0-2.2.8-2.6 1.4V9.5h-2.6c.03.7 0 8.5 0 8.5h2.6v-4.7c0-.25.02-.5.1-.7.2-.5.7-1 1.5-1 1.1 0 1.5.8 1.5 2v4.4H18.8v-5.2z" fill="white"/></svg>'
    },
    {
      id: 'other',
      name: 'Other',
      placeholder: '@username or URL',
      logoSvg: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect width="24" height="24" rx="6" fill="#8C6D3F"/><circle cx="12" cy="12" r="7" stroke="white" stroke-width="1.4" fill="none"/><path d="M5 12h14M12 5c2 2 3 5 3 7s-1 5-3 7c-2-2-3-5-3-7s1-5 3-7z" stroke="white" stroke-width="1.4" fill="none"/></svg>'
    }
  ];

  const socialModal = $('#socialModal');
  const platformGrid = $('#platformGrid');
  const socialList = $('#socialList');
  const addSocialCircle = $('#addSocialCircle');
  const MAX_SOCIAL_ACCOUNTS = 6;

  function renderPlatformGrid() {
    if (!platformGrid || platformGrid.children.length > 0) return;
    platformGrid.innerHTML = SOCIAL_PLATFORMS.map(p => `
      <button type="button" class="platform-btn" data-platform-id="${p.id}">
        <span class="platform-logo">${p.logoSvg}</span>
        <span class="platform-name">${p.name}</span>
      </button>
    `).join('');
  }

  function openSocialPicker() {
    renderPlatformGrid();
    if (!socialModal) return;
    socialModal.style.display = 'flex';
    requestAnimationFrame(() => {
      socialModal.classList.add('is-active');
    });
  }

  function closeSocialPicker() {
    if (!socialModal) return;
    socialModal.classList.remove('is-active');
    setTimeout(() => {
      if (!socialModal.classList.contains('is-active')) {
        socialModal.style.display = 'none';
      }
    }, 280);
  }

  function updateSocialVisibility() {
    const count = socialList ? socialList.children.length : 0;
    if (addSocialCircle) {
      addSocialCircle.disabled = count >= MAX_SOCIAL_ACCOUNTS;
      addSocialCircle.title = count >= MAX_SOCIAL_ACCOUNTS ? 'Maximum accounts reached' : 'Add social media account';
      addSocialCircle.style.opacity = count >= MAX_SOCIAL_ACCOUNTS ? '0.35' : '1';
    }
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

    const input = row.querySelector('.social-inner-input');
    if (input) {
      setTimeout(() => input.focus(), 60);
    }
  }

  function resetSocialAccounts() {
    if (socialList) socialList.innerHTML = '';
    updateSocialVisibility();
  }

  if (socialModal) {
    socialModal.addEventListener('click', e => {
      if (e.target === socialModal) closeSocialPicker();
    });
    const closeBtn = $('#socialModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeSocialPicker);

    if (platformGrid) {
      platformGrid.addEventListener('click', e => {
        const btn = e.target.closest('.platform-btn');
        if (btn && btn.dataset.platformId) {
          addSocialAccount(btn.dataset.platformId);
          closeSocialPicker();
        }
      });
    }
  }

  if (addSocialCircle) {
    addSocialCircle.addEventListener('click', e => {
      e.preventDefault();
      openSocialPicker();
    });
  }

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
    addSocial: () => {
      openSocialPicker();
    },
    openSocialPicker: () => {
      openSocialPicker();
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
