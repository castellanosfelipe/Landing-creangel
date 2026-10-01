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
  const pagination = [...featureCatalog.querySelectorAll('[data-feature-pagination]')].map(element => ({
    element,
    info: element.querySelector('.feature-page-info'),
    controls: element.querySelector('.feature-page-controls')
  }));
  const categoryLinks = [...document.querySelectorAll('[data-category-target]')];
  const categories = [...featureCatalog.querySelectorAll('.feature-category')].map(group => ({
    id: group.id,
    name: group.dataset.categoryName,
    element: group,
    heading: group.querySelector('.feature-category-heading'),
    rows: [...group.querySelectorAll('.feature-item')].map(element => {
      const title = element.querySelector('.feature-title');
      const excerpt = element.querySelector('.feature-excerpt');
      const badge = element.querySelector('.feature-category-name');
      const descriptionText = element.dataset.searchDescription || excerpt.textContent;
      return {
        id: element.id,
        element,
        title: title.querySelector('a') || title,
        excerpt,
        badge,
        titleText: title.textContent,
        excerptText: excerpt.textContent,
        categoryText: badge?.textContent || group.dataset.categoryName || '',
        descriptionText,
        searchText: fold([title.textContent, badge?.textContent || group.dataset.categoryName || '',
          excerpt.textContent, descriptionText].join(' '))
      };
    })
  }));
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const featureById = new Map(categories.flatMap(category => category.rows.map(row => [row.id, { row, category }])));
  const initialCategory = categoryById.has(featureCatalog.dataset.initialCategory)
    ? featureCatalog.dataset.initialCategory : (categories[0]?.id || 'all');
  const pageSize = 10;
  let selectedCategory = initialCategory;
  let currentPage = 1;

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

  function paintMatches(element, text, tokens) {
    if (!element) return;
    if (!tokens.length) {
      if (element.textContent !== text || element.querySelector('mark')) element.textContent = text;
      return;
    }
    const { normalized, starts, ends } = searchableOffsets(text);
    const ranges = [];
    for (const token of tokens) {
      let found = normalized.indexOf(token);
      while (found !== -1) {
        ranges.push([starts[found], ends[found + token.length - 1]]);
        found = normalized.indexOf(token, found + token.length);
      }
    }
    ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push(range);
    }
    if (!merged.length) {
      if (element.textContent !== text || element.querySelector('mark')) element.textContent = text;
      return;
    }
    const fragment = document.createDocumentFragment();
    let from = 0;
    for (const [start, end] of merged) {
      fragment.append(document.createTextNode(text.slice(from, start)));
      const mark = document.createElement('mark');
      mark.className = 'feature-match';
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
      from = end;
    }
    fragment.append(document.createTextNode(text.slice(from)));
    element.replaceChildren(fragment);
  }

  function matchingExcerpt(row, tokens) {
    if (!tokens.length) return row.excerptText;
    const excerpt = fold(row.excerptText);
    const { normalized, starts, ends } = searchableOffsets(row.descriptionText);
    const token = tokens.find(value => !excerpt.includes(value) && normalized.includes(value));
    if (!token) return row.excerptText;
    const match = normalized.indexOf(token);
    const hitStart = starts[match], hitEnd = ends[match + token.length - 1];
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

  function pageNumbers(pageCount) {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
    let first = Math.max(2, currentPage - 1);
    let last = Math.min(pageCount - 1, currentPage + 1);
    if (currentPage <= 3) { first = 2; last = 4; }
    if (currentPage >= pageCount - 2) { first = pageCount - 3; last = pageCount - 1; }
    return [1, ...Array.from({ length: last - first + 1 }, (_, index) => first + index), pageCount];
  }

  function pageButton(label, page, pageCount, { direction = false, disabled = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.featurePage = String(page);
    button.disabled = disabled;
    if (direction) {
      button.className = 'feature-page-direction';
      button.setAttribute('aria-label', label === 'Anterior' ? 'Ir a la página anterior' : 'Ir a la página siguiente');
    } else {
      button.setAttribute('aria-label', 'Página ' + page + ' de ' + pageCount);
      if (page === currentPage) button.setAttribute('aria-current', 'page');
    }
    return button;
  }

  function renderPagination(total, pageCount, first, last) {
    for (const navigation of pagination) {
      navigation.element.hidden = total <= pageSize;
      navigation.info.textContent = total ? 'Página ' + currentPage + ' de ' + pageCount +
        ' · Mostrando ' + first + '–' + last + ' de ' + total : '';
      if (navigation.element.hidden) {
        navigation.controls.replaceChildren();
        continue;
      }
      const fragment = document.createDocumentFragment();
      fragment.append(pageButton('Anterior', currentPage - 1, pageCount, {
        direction: true, disabled: currentPage === 1
      }));
      let previous = 0;
      for (const page of pageNumbers(pageCount)) {
        if (previous && page - previous > 1) {
          const ellipsis = document.createElement('span');
          ellipsis.className = 'feature-page-ellipsis';
          ellipsis.textContent = '…';
          ellipsis.setAttribute('aria-hidden', 'true');
          fragment.append(ellipsis);
        }
        fragment.append(pageButton(String(page), page, pageCount));
        previous = page;
      }
      fragment.append(pageButton('Siguiente', currentPage + 1, pageCount, {
        direction: true, disabled: currentPage === pageCount
      }));
      navigation.controls.replaceChildren(fragment);
    }
  }

  function renderFeatures() {
    const query = fold(featureInput.value);
    const tokens = [...new Set(query.split(/\s+/).filter(Boolean))];
    const filteredRows = categories.flatMap(category => {
      const visible = tokens.length || selectedCategory === 'all' || selectedCategory === category.id;
      return visible ? category.rows.filter(row => tokens.every(token => row.searchText.includes(token))) : [];
    });
    const total = filteredRows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    currentPage = Math.max(1, Math.min(currentPage, pageCount));
    const offset = (currentPage - 1) * pageSize;
    const visibleRows = new Set(filteredRows.slice(offset, offset + pageSize));
    const first = total ? offset + 1 : 0;
    const last = Math.min(offset + pageSize, total);
    featureCatalog.classList.toggle('catalog-search', Boolean(tokens.length));
    featureCatalog.classList.toggle('catalog-all', !tokens.length && selectedCategory === 'all');
    featureCatalog.dataset.activeCategory = selectedCategory;
    for (const category of categories) {
      let hits = 0;
      for (const row of category.rows) {
        const visible = visibleRows.has(row);
        row.element.hidden = !visible;
        if (row.badge) row.badge.hidden = !tokens.length;
        if (visible) {
          hits++;
          paintMatches(row.title, row.titleText, tokens);
          paintMatches(row.excerpt, matchingExcerpt(row, tokens), tokens);
          paintMatches(row.badge, row.categoryText, tokens);
        }
      }
      category.element.hidden = hits === 0;
      if (category.heading) category.heading.hidden = hits === 0 || Boolean(tokens.length) || selectedCategory !== 'all';
    }
    for (const link of categoryLinks) {
      const active = !tokens.length && link.dataset.categoryTarget === selectedCategory;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    featureSelect.value = tokens.length ? 'all' : selectedCategory;
    featureReset.hidden = !tokens.length;
    featureEmpty.hidden = total !== 0;
    const range = total ? 'Mostrando ' + first + '–' + last + ' de ' : '';
    let countText;
    if (tokens.length) {
      featurePanelTitle.textContent = 'Resultados de búsqueda';
      countText = range + total + (total === 1 ? ' resultado' : ' resultados') +
        ' para “' + featureInput.value.trim() + '” en todas las categorías';
    } else {
      const categoryName = selectedCategory === 'all' ? 'Todas las categorías' : categoryById.get(selectedCategory).name;
      featurePanelTitle.textContent = categoryName;
      countText = range + total + (total === 1 ? ' característica' : ' características') +
        (selectedCategory === 'all' ? ' en todas las categorías' : ' en ' + categoryName);
    }
    // Only this status announces changes; both pagination summaries remain ordinary text.
    if (featureCount.textContent !== countText) featureCount.textContent = countText;
    renderPagination(total, pageCount, first, last);
  }

  function scrollToCatalogTarget(target, focus) {
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (focus) {
        target.setAttribute('tabindex', '-1');
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
      currentPage = Math.floor(match.category.rows.indexOf(match.row) / pageSize) + 1;
      renderFeatures();
      match.row.element.setAttribute('tabindex', '-1');
      if (scroll) scrollToCatalogTarget(match.row.element, focus);
      return true;
    }
    if (id === 'caracteristicas' || categoryById.has(id)) {
      selectedCategory = id === 'caracteristicas' ? 'all' : id;
      featureInput.value = '';
      currentPage = 1;
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
  featureCount.setAttribute('aria-atomic', 'true');
  featureInput.addEventListener('input', () => {
    currentPage = 1;
    renderFeatures();
  });
  featureReset.addEventListener('click', () => {
    featureInput.value = '';
    currentPage = 1;
    renderFeatures();
    featureInput.focus();
  });
  featureSelect.addEventListener('change', () => {
    navigateCatalog(featureSelect.value === 'all' ? 'caracteristicas' : featureSelect.value, { focus: false, scroll: false });
  });
  for (const navigation of pagination) {
    navigation.controls.addEventListener('click', event => {
      const button = event.target.closest('button[data-feature-page]');
      if (!button || button.disabled || !navigation.controls.contains(button)) return;
      currentPage = Number(button.dataset.featurePage);
      renderFeatures();
      scrollToCatalogTarget(featurePanelTitle, true);
    });
  }
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
      currentPage = 1;
      renderFeatures();
    } else applyCatalogHash({ focus: true });
  });
  renderFeatures();
  applyCatalogHash({ focus: true });
}
const galleryInput=document.querySelector('#gallerySearch');
if(galleryInput){const cards=[...document.querySelectorAll('#resourceGallery .media-card')];galleryInput.addEventListener('input',()=>{const q=fold(galleryInput.value);let count=0;cards.forEach(card=>{card.hidden=!!q&&!fold(card.dataset.search||card.textContent).includes(q);if(!card.hidden)count++});document.querySelector('#galleryCount').textContent=count+' imágenes';document.querySelector('#galleryEmpty').hidden=count!==0});}
let lastFocus;const zoom=document.querySelector('#imageDialog');
document.querySelectorAll('.media-zoom').forEach(button=>button.addEventListener('click',()=>{if(!zoom)return;lastFocus=button;zoom.querySelector('h2').textContent=button.dataset.title;const img=document.createElement('img');img.src=button.dataset.src;img.alt=button.dataset.alt||button.dataset.title;zoom.querySelector('.zoom-body').replaceChildren(img);zoom.showModal()}));
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
