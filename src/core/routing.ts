import { useCallback, useEffect, useRef, useState } from 'react';

export type ModalRoute = 'library' | 'search' | 'appearance' | 'voice' | 'help' | 'model';
export interface AppRoute { bookId?: string; modal: ModalRoute | null; illustration: number | null; panel: 'chapters' | 'illustrations' }
const segments: Record<Exclude<ModalRoute, 'library'>, string> = { search: 'search', appearance: 'appearance', voice: 'voice', help: 'shortcuts', model: 'voice-model' };
export function readRoute(url = new URL(window.location.href)): AppRoute {
  const routeUrl = new URL(url.hash.slice(1) || '/', url.origin);
  const path = routeUrl.pathname.split('/').filter(Boolean);
  const route: AppRoute = { modal: null, illustration: null, panel: routeUrl.searchParams.get('panel') === 'illustrations' ? 'illustrations' : 'chapters' };
  if (path[0] === 'library') { route.modal = 'library'; route.bookId = routeUrl.searchParams.get('book') || undefined; }
  else if (path[0] === 'books' && path[1]) {
    try { route.bookId = decodeURIComponent(path[1]); } catch { route.modal = 'library'; return route; }
    if (path[2] === 'illustrations' && /^\d+$/.test(path[3] || '') && Number(path[3]) > 0) route.illustration = Number(path[3]) - 1;
    else if (path[2]) route.modal = (Object.entries(segments).find(([, segment]) => segment === path[2])?.[0] as ModalRoute) || 'library';
  } else if (path.length) route.modal = (Object.entries(segments).find(([, segment]) => segment === path[0])?.[0] as ModalRoute) || 'library';
  return route;
}
export function routeUrl(route: AppRoute): string {
  const query = new URLSearchParams();
  let path = route.bookId ? `/books/${encodeURIComponent(route.bookId)}` : '/';
  if (route.modal === 'library') { path = '/library'; if (route.bookId) query.set('book', route.bookId); }
  else if (route.modal) path += (path === '/' ? '' : '/') + segments[route.modal];
  else if (route.illustration !== null && route.bookId) path += `/illustrations/${route.illustration + 1}`;
  if (route.panel === 'illustrations') query.set('panel', 'illustrations');
  return `${import.meta.env.BASE_URL}#${path}${query.size ? `?${query}` : ''}`;
}

/** Hash routes for static hosting: overlays return to their parent; browsing a viewer replaces its current entry. */
export function useAppRoute() {
  const [route, setRoute] = useState(readRoute);
  const routeRef = useRef(route); routeRef.current = route;
  useEffect(() => { const update = () => setRoute(readRoute()); window.addEventListener('popstate', update); window.addEventListener('hashchange', update); return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); }; }, []);
  const navigate = useCallback((next: AppRoute, options: { replace?: boolean; overlay?: boolean } = {}) => {
    const url = routeUrl(next); const current = window.location.pathname + window.location.search + window.location.hash;
    if (url === current) return;
    const state = options.overlay ? { listenReturn: current } : options.replace ? window.history.state : {};
    if (options.replace) window.history.replaceState(state, '', url); else window.history.pushState(state, '', url);
    routeRef.current = next; setRoute(next);
  }, []);
  const setModal = useCallback((modal: ModalRoute | null) => {
    const current = routeRef.current;
    if (modal === null && current.modal && window.history.state?.listenReturn) { window.history.back(); return; }
    navigate({ ...current, modal, illustration: null }, { overlay: modal !== null });
  }, [navigate]);
  const setViewer = useCallback((illustration: number | null) => {
    const current = routeRef.current;
    if (illustration === null && current.illustration !== null && window.history.state?.listenReturn) { window.history.back(); return; }
    navigate({ ...current, illustration, modal: null }, { overlay: illustration !== null && current.illustration === null, replace: illustration !== null && current.illustration !== null });
  }, [navigate]);
  const setPanel = useCallback((panel: AppRoute['panel']) => navigate({ ...routeRef.current, panel }), [navigate]);
  return { route, routeRef, navigate, setModal, setViewer, setPanel };
}
