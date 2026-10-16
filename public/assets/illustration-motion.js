/* Progressive enhancement for the original, self-contained SVG illustrations. */
(() => {
  'use strict';

  const figures = [...document.querySelectorAll('[data-motion-illustration]')];
  if (!figures.length) return;

  const english = document.documentElement.lang.toLowerCase().startsWith('en');
  const words = english ? {
    pause:'Pause animation', resume:'Resume animation',
    reduced:'Reduced motion enabled',
    reducedHelp:'Animation is disabled by your system motion preference.',
    expand:'Enlarge illustration', close:'Close',
    note:'Static view. Scroll horizontally or vertically to explore the illustration at a readable size.',
    title:'IFINDIT illustration',
  } : {
    pause:'Pausar animación', resume:'Reanudar animación',
    reduced:'Movimiento reducido activado',
    reducedHelp:'La animación está desactivada por la preferencia de movimiento de tu sistema.',
    expand:'Ampliar ilustración', close:'Cerrar',
    note:'Vista estática. Desplázate en horizontal o vertical para explorar la ilustración a un tamaño legible.',
    title:'Ilustración de IFINDIT',
  };
  const motionPreference = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const supportsDialog = typeof window.HTMLDialogElement === 'function'
    && typeof window.HTMLDialogElement.prototype.showModal === 'function';
  const states = [];
  let leavingPage = false;
  let dialog;
  let dialogTitle;
  let dialogBody;
  let dialogSource;
  let dialogTrigger;
  let cloneNumber = 0;

  function update(state) {
    const reduced = Boolean(motionPreference?.matches);
    const paused = state.userPaused || reduced;
    const playing = !paused && state.intersecting && !document.hidden
      && !leavingPage && !state.expanded;
    state.figure.classList.toggle('is-playing',playing);
    state.toggle.disabled = reduced;
    state.toggle.setAttribute('aria-pressed',String(paused));
    state.toggle.textContent = reduced ? words.reduced : paused ? words.resume : words.pause;
    state.toggle.title = reduced ? words.reducedHelp : '';
  }

  function updateAll() { states.forEach(update); }

  // A second inline SVG needs fresh IDs for filters, gradients and accessible names.
  function isolateReferences(svg) {
    const prefix = `ifm-expanded-${++cloneNumber}-`;
    const nodes = [svg,...svg.querySelectorAll('*')];
    const ids = new Map();
    for (const node of nodes) {
      if (node.id) ids.set(node.id,`${prefix}${ids.size}`);
    }
    for (const node of nodes) {
      for (const attribute of [...node.attributes]) {
        let value = attribute.value;
        if (attribute.name === 'id') value = ids.get(value) || value;
        else if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
          value = value.split(/\s+/).map(id => ids.get(id) || id).join(' ');
        } else if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) {
          value = ids.has(value.slice(1)) ? `#${ids.get(value.slice(1))}` : value;
        } else {
          value = value.replace(/url\(\s*(['"]?)#([^\s)'";]+)\1\s*\)/g,
            (match,quote,id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
        }
        if (value !== attribute.value) node.setAttribute(attribute.name,value);
      }
    }
    return svg;
  }

  function makeDialog() {
    dialog = document.createElement('dialog');
    dialog.id = 'illustrationDialog';
    dialog.className = 'illustration-dialog';
    dialog.setAttribute('aria-labelledby','illustrationDialogTitle');
    dialog.setAttribute('aria-describedby','illustrationDialogNote');
    const head = document.createElement('div');
    head.className = 'illustration-dialog-head';
    dialogTitle = document.createElement('h2');
    dialogTitle.id = 'illustrationDialogTitle';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'illustration-dialog-close';
    close.textContent = words.close;
    close.addEventListener('click',() => dialog.close());
    const note = document.createElement('p');
    note.id = 'illustrationDialogNote';
    note.className = 'illustration-dialog-note';
    note.textContent = words.note;
    dialogBody = document.createElement('div');
    dialogBody.className = 'illustration-dialog-body';
    dialogBody.tabIndex = 0;
    dialogBody.setAttribute('role','region');
    dialogBody.setAttribute('aria-label',words.expand);
    head.append(dialogTitle,close);
    dialog.append(head,note,dialogBody);
    dialog.addEventListener('close',() => {
      document.body.classList.remove('illustration-dialog-open');
      if (dialogSource) {
        dialogSource.expanded = false;
        update(dialogSource);
      }
      dialogBody.replaceChildren();
      if (dialogTrigger?.isConnected) dialogTrigger.focus({preventScroll:true});
      dialogSource = null;
      dialogTrigger = null;
    });
    document.body.append(dialog);
  }

  function expand(state,trigger) {
    if (!supportsDialog) return;
    if (!dialog) makeDialog();
    if (dialog.open) return;
    dialogTitle.textContent = state.figure.dataset.motionTitle || words.title;
    dialogBody.replaceChildren(isolateReferences(state.svg.cloneNode(true)));
    dialogSource = state;
    dialogTrigger = trigger;
    state.expanded = true;
    update(state);
    try {
      dialog.showModal();
      document.body.classList.add('illustration-dialog-open');
      dialogBody.scrollTo(0,0);
    } catch {
      state.expanded = false;
      dialogBody.replaceChildren();
      dialogSource = null;
      dialogTrigger = null;
      update(state);
    }
  }

  const observer = typeof window.IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        const state = states.find(item => item.figure === entry.target);
        if (!state) continue;
        state.intersecting = entry.isIntersecting && entry.intersectionRatio >= .05;
        update(state);
      }
    },{threshold:[0,.05]}) : null;

  for (const figure of figures) {
    const section = figure.closest('.product-motion-section');
    const controls = section?.querySelector('.product-motion-controls');
    const toggle = controls?.querySelector('[data-motion-toggle]');
    const enlarge = controls?.querySelector('[data-motion-expand]');
    const svg = figure.querySelector('.ifindit-motion-graphic');
    if (!toggle || !svg || figure.dataset.motionReady) continue;
    // Moving a panel also moves its labels. Keep every text-bearing ancestor
    // static, while independent shapes inside the panel can still animate.
    const fixedLabels = new Set();
    for (const text of svg.querySelectorAll('text, tspan, textPath')) {
      for (let node = text; node && node !== svg; node = node.parentElement) {
        fixedLabels.add(node);
      }
    }
    fixedLabels.forEach(node => node.classList.add('ifm-fixed-label'));
    const state = {figure,svg,toggle,userPaused:false,expanded:false,intersecting:false};
    states.push(state);
    figure.dataset.motionReady = 'true';
    toggle.addEventListener('click',() => {
      state.userPaused = !state.userPaused;
      update(state);
    });
    if (enlarge) {
      enlarge.hidden = !supportsDialog;
      enlarge.textContent = words.expand;
      if (supportsDialog) {
        if (!dialog) makeDialog();
        enlarge.setAttribute('aria-haspopup','dialog');
        enlarge.setAttribute('aria-controls','illustrationDialog');
      }
      enlarge.addEventListener('click',() => expand(state,enlarge));
    }
    controls.hidden = false;
    update(state);
    observer?.observe(figure);
  }

  if (!observer) {
    let scheduled = false;
    const checkVisibility = () => {
      scheduled = false;
      for (const state of states) {
        const rect = state.figure.getBoundingClientRect();
        state.intersecting = rect.bottom > 0 && rect.right > 0
          && rect.top < window.innerHeight && rect.left < window.innerWidth;
        update(state);
      }
    };
    const scheduleVisibility = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(checkVisibility);
    };
    window.addEventListener('scroll',scheduleVisibility,{passive:true});
    window.addEventListener('resize',scheduleVisibility,{passive:true});
    checkVisibility();
  }
  if (typeof motionPreference?.addEventListener === 'function') {
    motionPreference.addEventListener('change',updateAll);
  } else if (typeof motionPreference?.addListener === 'function') {
    motionPreference.addListener(updateAll);
  }
  document.addEventListener('visibilitychange',updateAll);
  window.addEventListener('pagehide',() => { leavingPage = true; updateAll(); });
  window.addEventListener('pageshow',() => { leavingPage = false; updateAll(); });
})();
