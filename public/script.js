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
  let opened = false;

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
    if (!el || !el.animate) return Promise.resolve();
    const a = el.animate(keyframes, { duration: 600, easing: EASE.out, fill: 'forwards', ...opts });
    return a.finished.catch(() => {});
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
  let isInviteUsed = false;
  const screens = $$('.screen');
  function show(id) {
    if (isInviteUsed && (id === 'form' || id === 'confirm')) {
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
    envelope.hidden = true;
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

    if (hint) anim(hint, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 250 });

    if (envBackdrop) envBackdrop.style.display = 'none';
    document.body.dataset.bg = 'cream';

    const DURATION = 3000; // Slower, cinematic opening animation (3.0s)
    const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'; // Smooth, graceful ease-in-out so it starts gently without sudden jerk

    // Top section (flap + seal) slides smoothly UP without any opacity fading
    const topAnim = anim(envTop, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-125%)' }
    ], { duration: DURATION, easing: EASING });

    // Bottom section (pocket body + fill) slides smoothly DOWN without any opacity fading
    const bottomAnim = anim(envBottom, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(125%)' }
    ], { duration: DURATION, easing: EASING });

    await Promise.all([topAnim, bottomAnim]);
    finishOpen();
  }

  /* ---------- RSVP + form ---------- */
  const form = $('#guestForm');
  const extra = $('#socialExtra');
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

  // Track unique invitation code from URL or session
  const urlParams = new URLSearchParams(window.location.search);
  let inviteCode = urlParams.get('code') || urlParams.get('invite') || sessionStorage.getItem('cayc_invite_code') || '';
  if (inviteCode) {
    inviteCode = inviteCode.trim().toUpperCase();
    sessionStorage.setItem('cayc_invite_code', inviteCode);
  }

  // Submit RSVP to backend (MongoDB Atlas) with unique link support & offline fallback
  async function submitRSVP(payload) {
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, code: inviteCode })
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, ...data };
    } catch (err) {
      console.warn('API endpoint unavailable, falling back to local storage', err);
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

    const submitBtn = $('.submit', form);
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving RSVP...';
    }

    const data = Object.fromEntries(new FormData(form));
    data.social = $$('input[name="social"]', form).map(i => i.value.trim()).filter(Boolean);
    data.response = 'accepted';

    const serverRes = await submitRSVP(data);

    if (serverRes && !serverRes.ok) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & get my guest pass';
      }
      if (serverRes.error === 'already_used') {
        isInviteUsed = true;
        alert('This invitation link has already been registered and cannot be reused.');
        show('alreadyUsed');
        return;
      } else {
        alert(serverRes.message || 'Unable to register RSVP. Please try again.');
        return;
      }
    }

    if (!serverRes) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & get my guest pass';
      }
      alert('Unable to reach server. Please check your internet connection and try again.');
      return;
    }

    // Mark as permanently used on client to lock the link from re-use
    isInviteUsed = true;

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

    const badge = $('#passBadge'); if (badge) badge.innerHTML = '✓&nbsp; REGISTRATION COMPLETE';
    const headline = $('#passHeadline'); if (headline) headline.innerHTML = 'You’re on the<br>guest list!';
    $('#passName').textContent = `${data.first.trim()} ${data.last.trim()}`;
    $('#passNo').textContent = `GUEST ${num}`;
    $('#passRef').textContent = `GL · 2026 · ${num}`;
    const pass = $('.pass'); pass.style.animation = 'none'; void pass.offsetWidth; pass.style.animation = '';
    const passBack = $('#pass .back');
    if (passBack) passBack.dataset.go = 'alreadyUsed';
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
        errEl.textContent = 'Please enter both your full name and mobile number.';
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
          const p = data.pass;
          const badge = $('#passBadge'); if (badge) badge.innerHTML = '✓&nbsp; VERIFIED GUEST PASS';
          const headline = $('#passHeadline'); if (headline) headline.innerHTML = 'Your Special<br>Guest Pass';
          $('#passName').textContent = p.name;
          const numStr = String(p.no || '001').padStart(3, '0');
          $('#passNo').textContent = `GUEST ${numStr}`;
          $('#passRef').textContent = `GL · 2026 · ${numStr}`;
          const pass = $('.pass'); pass.style.animation = 'none'; void pass.offsetWidth; pass.style.animation = '';
          const passBack = $('#pass .back');
          if (passBack) passBack.dataset.go = 'alreadyUsed';
          show('pass');
        } else {
          errEl.textContent = data.error || 'Name or mobile number does not match this invitation.';
          errEl.style.display = 'block';
        }
      } catch (err) {
        errEl.textContent = 'Verification error. Please try again.';
        errEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'View Existing Guest Pass';
      }
    });
  }

  /* ---------- every button, through one delegated handler ---------- */
  const actions = {
    open: () => {
      if (isInviteUsed) {
        show('alreadyUsed');
        return;
      }
      openEnvelope();
    },
    respond: () => {
      if (isInviteUsed) {
        show('alreadyUsed');
        return;
      }
      show('confirm');
    },
    accept: () => {
      if (isInviteUsed) {
        show('alreadyUsed');
        return;
      }
      show('form');
    },
    decline: () => {
      if (isInviteUsed) {
        show('alreadyUsed');
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
      if (extra.children.length >= 2) return;
      const i = document.createElement('input');
      i.name = 'social'; i.placeholder = 'e.g. @username';
      extra.appendChild(i); i.focus();
    }
  };
  document.addEventListener('click', e => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { show(goBtn.dataset.go); return; }
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  });
  $('#seal').dataset.action = 'open';
  envelope.addEventListener('click', e => {
    if (!opened && !e.target.closest('#seal')) openEnvelope();
  });

  /* ---------- start ---------- */
  async function initInvitation() {
    if (inviteCode) {
      try {
        const res = await fetch(`/api/invite/verify?code=${encodeURIComponent(inviteCode)}`);
        const data = await res.json();
        if (data.ok) {
          if (data.status === 'used') {
            isInviteUsed = true;
            opened = true; envelope.hidden = true; html.classList.remove('locked');
            show('alreadyUsed');
            return;
          } else if (data.status === 'declined') {
            opened = true; envelope.hidden = true; html.classList.remove('locked');
            show('declined');
            return;
          }
        } else if (data.error === 'not_found' || res.status === 404) {
          sessionStorage.removeItem('cayc_invite_code');
          inviteCode = '';
          if (window.location.search) {
            window.location.replace(window.location.pathname);
            return;
          }
        }
      } catch (e) {
        console.warn('Backend verification offline', e);
      }
    }

    const startId = location.hash.slice(1);
    const startEl = startId && document.getElementById(startId);
    if (startEl && startEl.classList.contains('screen') && startId !== 'invite') {
      if (isInviteUsed && (startId === 'form' || startId === 'confirm')) {
        opened = true; envelope.hidden = true; html.classList.remove('locked');
        show('alreadyUsed');
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
