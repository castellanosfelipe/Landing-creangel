import {useEffect} from 'react';
import {getActiveHeadingId} from './toc-highlight.mjs';

function anchorId(link) {
  try {return decodeURIComponent(new URL(link.href).hash.slice(1));}
  catch {return null;}
}

export default function useDocumentationTOCHighlight(config) {
  useEffect(() => {
    if (!config) return undefined;
    const {linkClassName, linkActiveClassName, minHeadingLevel, maxHeadingLevel} = config;
    const selectors = [];
    for (let level = minHeadingLevel; level <= maxHeadingLevel; level += 1) selectors.push(`h${level}.anchor`);
    const article = document.querySelector('.theme-doc-markdown');
    const links = Array.from(document.getElementsByClassName(linkClassName));
    const ids = new Set(links.map(anchorId));
    const headings = Array.from(article?.querySelectorAll(selectors.join(',')) ?? []).filter(heading => ids.has(heading.id));
    let selectedId = null;
    let frame = null;
    let pointerScrolling = false;

    function update() {
      frame = null;
      const scrolling = document.scrollingElement ?? document.documentElement;
      const navbar = document.querySelector('.navbar');
      const navbarRect = navbar?.getBoundingClientRect();
      const navbarHeight = navbarRect ? Math.max(0, navbarRect.bottom) : 0;
      const activeId = selectedId ?? getActiveHeadingId(headings.map(heading => {
        const rect = heading.getBoundingClientRect();
        return {id: heading.id, top: rect.top, bottom: rect.bottom};
      }), {
        scrollTop: scrolling.scrollTop,
        maxScroll: Math.max(0, scrolling.scrollHeight - scrolling.clientHeight),
        viewportHeight: window.innerHeight,
        navbarHeight,
      });
      for (const link of links) {
        const active = anchorId(link) === activeId;
        link.classList.toggle(linkActiveClassName, active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    function schedule() {if (frame === null) frame = window.requestAnimationFrame(update);}
    function releaseSelection() {selectedId = null; schedule();}
    function onScroll() {if (pointerScrolling) selectedId = null; schedule();}
    function onClick(event) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = links.find(item => item.contains(event.target));
      if (link) {selectedId = anchorId(link); schedule();}
    }
    function onHashChange() {
      const id = anchorId({href: window.location.href});
      selectedId = ids.has(id) ? id : null;
      schedule();
    }
    function onKeyDown(event) {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) releaseSelection();
    }
    function onPointerDown(event) {pointerScrolling = event.button === 0 && !links.some(link => link.contains(event.target));}
    function onPointerUp() {pointerScrolling = false;}

    document.addEventListener('scroll', onScroll, {passive: true});
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('resize', schedule);
    window.addEventListener('wheel', releaseSelection, {passive: true});
    window.addEventListener('touchmove', releaseSelection, {passive: true});
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (article) observer?.observe(article);
    onHashChange();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', releaseSelection);
      window.removeEventListener('touchmove', releaseSelection);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [config]);
}
