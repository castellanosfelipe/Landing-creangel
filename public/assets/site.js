'use strict';
const menuButton=document.querySelector('#menuToggle'),mobileMenu=document.querySelector('#mobileNav'),productButton=document.querySelector('#productToggle'),productMenu=document.querySelector('#productMenu');
function closeMenus(){for(const [button,panel] of [[menuButton,mobileMenu],[productButton,productMenu]]){if(button&&panel){button.setAttribute('aria-expanded','false');panel.hidden=true}}}
for(const [button,panel] of [[menuButton,mobileMenu],[productButton,productMenu]])button?.addEventListener('click',()=>{const open=panel.hidden;closeMenus();panel.hidden=!open;button.setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(productMenu&&!productMenu.hidden){closeMenus();productButton.focus()}else if(mobileMenu&&!mobileMenu.hidden){closeMenus();menuButton.focus()}}});
document.addEventListener('click',e=>{if(!e.target.closest('.site-header'))closeMenus()});
matchMedia('(max-width:1120px)').addEventListener('change',()=>{const inHeader=document.querySelector('.site-header')?.contains(document.activeElement);closeMenus();if(inHeader)(matchMedia('(max-width:1120px)').matches?menuButton:productButton)?.focus()});
const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
const featureCatalog = document.querySelector('.feature-catalog');
if (featureCatalog) {
  const featureInput = featureCatalog.querySelector('#featureSearch');
  const featureCount = featureCatalog.querySelector('#featureCount');
  const featureEmpty = featureCatalog.querySelector('#featureEmpty');
  const featureReset = featureCatalog.querySelector('#featureReset');
  const featureSelect = featureCatalog.querySelector('#featureCategory');
  const featurePanelTitle = featureCatalog.querySelector('#featurePanelTitle');
  const categoryLinks = [...document.querySelectorAll('[data-category-target]')];
  const categories = [...featureCatalog.querySelectorAll('.feature-category')].map(group => ({
    id: group.id,
    name: group.dataset.categoryName,
    element: group,
    heading: group.querySelector('.feature-category-heading'),
    rows: [...group.querySelectorAll('.feature-item')].map(element => {
      const title = element.querySelector('.feature-title');
      const excerpt = element.querySelector('.feature-excerpt');
      const description = element.querySelector('.feature-description');
      const more = element.querySelector('.feature-more');
      const row = {
        id: element.id,
        element,
        title,
        excerpt,
        description,
        badge: element.querySelector('.feature-category-name'),
        titleText: title.textContent,
        excerptText: excerpt.textContent,
        descriptionText: description.textContent,
        searchText: fold(title.textContent + ' ' + description.textContent)
      };
      if (more) {
        const moreLabel = document.createTextNode('Ver detalle ');
        const moreIcon = document.createElement('span');
        moreIcon.setAttribute('aria-hidden', 'true');
        moreIcon.textContent = '+';
        more.replaceChildren(moreLabel, moreIcon);
        const updateMore = () => { moreLabel.textContent = element.open ? 'Ocultar detalle ' : 'Ver detalle '; };
        element.addEventListener('toggle', updateMore);
        updateMore();
      }
      return row;
    })
  }));
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const featureById = new Map(categories.flatMap(category => category.rows.map(row => [row.id, { row, category }])));
  const initialCategory = categoryById.has(featureCatalog.dataset.initialCategory)
    ? featureCatalog.dataset.initialCategory : (categories[0]?.id || 'all');
  let selectedCategory = initialCategory;

  // Offsets preserve the source spelling while matching accents and case independently.
  function searchableOffsets(text) {
    let normalized = '', offset = 0;
    const starts = [], ends = [];
    for (const character of text) {
      const part = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
      if (part) {
        normalized += part;
        for (let i = 0; i < part.length; i++) {
          starts.push(offset);
          ends.push(offset + character.length);
        }
      } else if (ends.length) {
        // A combining mark belongs to the preceding original character.
        ends[ends.length - 1] = offset + character.length;
      }
      offset += character.length;
    }
    return { normalized, starts, ends };
  }

  function paintMatches(element, text, query) {
    if (!query) {
      if (element.textContent !== text || element.querySelector('mark')) element.textContent = text;
      return;
    }
    const { normalized, starts, ends } = searchableOffsets(text);
    const fragment = document.createDocumentFragment();
    let from = 0, found = normalized.indexOf(query), next = 0;
    while (found !== -1) {
      const start = starts[found], end = ends[found + query.length - 1];
      if (start >= from) {
        fragment.append(document.createTextNode(text.slice(from, start)));
        const mark = document.createElement('mark');
        mark.className = 'feature-match';
        mark.textContent = text.slice(start, end);
        fragment.append(mark);
        from = end;
      }
      next = found + query.length;
      found = normalized.indexOf(query, next);
    }
    fragment.append(document.createTextNode(text.slice(from)));
    element.replaceChildren(fragment);
  }

  function matchingExcerpt(row, query) {
    if (!query || fold(row.excerptText).includes(query)) return row.excerptText;
    const { normalized, starts, ends } = searchableOffsets(row.descriptionText);
    const match = normalized.indexOf(query);
    if (match === -1) return row.excerptText;
    const hitStart = starts[match], hitEnd = ends[match + query.length - 1];
    let start = Math.max(0, hitStart - 65);
    let end = Math.min(row.descriptionText.length, Math.max(start + 190, hitEnd + 55));
    if (start > 0) {
      const boundary = row.descriptionText.indexOf(' ', start);
      if (boundary !== -1 && boundary < hitStart) start = boundary + 1;
    }
    if (end < row.descriptionText.length) {
      const boundary = row.descriptionText.lastIndexOf(' ', end);
      if (boundary > hitEnd) end = boundary;
    }
    return (start > 0 ? '…' : '') + row.descriptionText.slice(start, end).trim() +
      (end < row.descriptionText.length ? '…' : '');
  }

  function renderFeatures() {
    const query = fold(featureInput.value);
    let visibleCount = 0;
    featureCatalog.classList.toggle('catalog-search', Boolean(query));
    featureCatalog.classList.toggle('catalog-all', !query && selectedCategory === 'all');
    featureCatalog.dataset.activeCategory = selectedCategory;
    for (const category of categories) {
      let hits = 0;
      const categoryVisible = query || selectedCategory === 'all' || selectedCategory === category.id;
      for (const row of category.rows) {
        const visible = Boolean(categoryVisible && (!query || row.searchText.includes(query)));
        row.element.hidden = !visible;
        if (visible) hits++;
        row.badge.hidden = !query;
        paintMatches(row.title, row.titleText, query);
        paintMatches(row.excerpt, matchingExcerpt(row, query), query);
        paintMatches(row.description, row.descriptionText, query);
      }
      category.element.hidden = hits === 0;
      if (category.heading) category.heading.hidden = Boolean(query) || selectedCategory !== 'all';
      visibleCount += hits;
    }
    for (const link of categoryLinks) {
      const active = !query && link.dataset.categoryTarget === selectedCategory;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    featureSelect.value = query ? 'all' : selectedCategory;
    featureReset.hidden = !query;
    featureEmpty.hidden = visibleCount !== 0;
    if (query) {
      featurePanelTitle.textContent = 'Resultados de búsqueda';
      featureCount.textContent = visibleCount + (visibleCount === 1 ? ' resultado' : ' resultados') +
        ' para “' + featureInput.value.trim() + '” en todas las categorías';
    } else {
      const categoryName = selectedCategory === 'all' ? 'Todas las categorías' : categoryById.get(selectedCategory).name;
      featurePanelTitle.textContent = categoryName;
      featureCount.textContent = visibleCount + (visibleCount === 1 ? ' característica' : ' características') +
        (selectedCategory === 'all' ? ' en todas las categorías' : ' en ' + categoryName);
    }
  }

  function scrollToCatalogTarget(target, focus) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (focus) {
        if (!target.matches('summary')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }

  function readHash() {
    try { return decodeURIComponent(location.hash.slice(1)); }
    catch { return ''; }
  }

  function applyCatalogHash({ focus = false, scroll = true } = {}) {
    const id = readHash();
    const match = featureById.get(id);
    if (match) {
      selectedCategory = match.category.id;
      featureInput.value = '';
      renderFeatures();
      match.row.element.open = true;
      if (scroll) scrollToCatalogTarget(match.row.element.querySelector('summary'), focus);
      return true;
    }
    if (id === 'caracteristicas' || categoryById.has(id)) {
      selectedCategory = id === 'caracteristicas' ? 'all' : id;
      featureInput.value = '';
      renderFeatures();
      if (scroll) scrollToCatalogTarget(id === 'caracteristicas' ? featureCatalog : featurePanelTitle, focus);
      return true;
    }
    return false;
  }

  function navigateCatalog(id, { focus = true, scroll = true } = {}) {
    const hash = '#' + encodeURIComponent(id);
    if (location.hash !== hash) history.pushState(null, '', hash);
    applyCatalogHash({ focus, scroll });
  }

  featureCatalog.classList.add('catalog-enhanced');
  featureInput.addEventListener('input', renderFeatures);
  featureReset.addEventListener('click', () => {
    featureInput.value = '';
    renderFeatures();
    featureInput.focus();
  });
  featureSelect.addEventListener('change', () => {
    navigateCatalog(featureSelect.value === 'all' ? 'caracteristicas' : featureSelect.value, { focus: false, scroll: false });
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const destination = new URL(anchor.href, location.href);
    if (destination.origin !== location.origin || destination.pathname !== location.pathname || destination.search !== location.search) return;
    let id;
    try { id = decodeURIComponent(destination.hash.slice(1)); }
    catch { return; }
    if (id !== 'caracteristicas' && !categoryById.has(id) && !featureById.has(id)) return;
    event.preventDefault();
    navigateCatalog(id);
  });
  window.addEventListener('hashchange', () => {
    if (!readHash()) {
      selectedCategory = initialCategory;
      featureInput.value = '';
      renderFeatures();
    } else applyCatalogHash();
  });
  renderFeatures();
  applyCatalogHash();
}
const galleryInput=document.querySelector('#gallerySearch');
if(galleryInput){const cards=[...document.querySelectorAll('#resourceGallery .media-card')];galleryInput.addEventListener('input',()=>{const q=fold(galleryInput.value);let count=0;cards.forEach(card=>{card.hidden=!!q&&!fold(card.dataset.search||card.textContent).includes(q);if(!card.hidden)count++});document.querySelector('#galleryCount').textContent=count+' imágenes';document.querySelector('#galleryEmpty').hidden=count!==0});}
let lastFocus;const zoom=document.querySelector('#imageDialog');
document.querySelectorAll('.media-zoom').forEach(button=>button.addEventListener('click',()=>{if(!zoom)return;lastFocus=button;zoom.querySelector('h2').textContent=button.dataset.title;const img=document.createElement('img');img.src=button.dataset.src;img.alt=button.dataset.alt||button.dataset.title;const a=document.createElement('a');a.href=button.dataset.src;a.download='';a.textContent='Descargar imagen';zoom.querySelector('.zoom-body').replaceChildren(img,a);zoom.showModal()}));
zoom?.querySelector('.zoom-close').addEventListener('click',()=>zoom.close());zoom?.addEventListener('close',()=>lastFocus?.focus());
document.querySelectorAll('[data-youtube]').forEach(button=>button.addEventListener('click',()=>{const frame=document.createElement('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+button.dataset.youtube+'?autoplay=1';frame.title=button.dataset.title;frame.allow='autoplay; encrypted-media; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';button.closest('.youtube-player').replaceChildren(frame);frame.focus()}));
const siteSearch=document.querySelector('#siteSearch');
if(siteSearch){const data=JSON.parse(document.querySelector('#searchIndex').textContent),list=document.querySelector('#siteResults'),count=document.querySelector('#siteResultCount');function search(){const q=fold(siteSearch.value);const matches=data.filter(p=>!q||fold(p.title+' '+p.description+' '+p.type+' '+(p.keywords||'')).includes(q));list.replaceChildren();for(const p of matches){const li=document.createElement('li'),type=document.createElement('div'),h=document.createElement('h2'),a=document.createElement('a'),d=document.createElement('p');type.className='result-type';type.textContent=p.type;a.href=p.href;a.textContent=p.title;h.append(a);d.textContent=p.description;li.append(type,h,d);list.append(li)}count.textContent=matches.length+' resultados';document.querySelector('#siteSearchEmpty').hidden=matches.length!==0;}siteSearch.addEventListener('input',search);const q=new URLSearchParams(location.search).get('q');if(q)siteSearch.value=q;search();}

// Reveal only existing diagram groups. The underlying content remains visible
// without JavaScript, while scrolling, and when reduced motion is requested.
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const motionGroups = document.querySelectorAll(
  '.platform-diagram .platform-audience-block,' +
  '.platform-diagram .platform-masthead,' +
  '.platform-diagram .platform-products-grid,' +
  '.platform-diagram .platform-shared,' +
  '.platform-diagram .platform-source-block,' +
  '.capability-map'
);
if (motionGroups.length && 'IntersectionObserver' in window && typeof Element.prototype.animate === 'function') {
  const activeMotion = new Set();
  const motionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      motionObserver.unobserve(entry.target);
      if (motionPreference.matches || document.visibilityState === 'hidden') continue;
      const compact = matchMedia('(max-width: 780px)').matches;
      const animation = entry.target.animate(
        [
          { opacity: compact ? .92 : .84, transform: `translateY(${compact ? 4 : 8}px)` },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: compact ? 280 : 420, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
      activeMotion.add(animation);
      const release = () => activeMotion.delete(animation);
      animation.addEventListener('finish', release, { once: true });
      animation.addEventListener('cancel', release, { once: true });
    }
  }, { threshold: .08, rootMargin: '0px 0px -30px 0px' });
  motionGroups.forEach(group => motionObserver.observe(group));
  motionPreference.addEventListener('change', () => {
    if (motionPreference.matches) activeMotion.forEach(animation => animation.cancel());
  });
}
