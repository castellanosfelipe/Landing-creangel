import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

const localizedRoutes = new Set([
  '/', '/productos/', '/plataforma/', '/recursos/documentos/',
  '/recursos/multimedia/', '/contacto/', '/soporte/',
]);

export default function usePortalHref() {
  const {i18n, siteConfig} = useDocusaurusContext();
  const portalRoot = siteConfig.themeConfig.navbar.logo.href;

  return (href) => {
    if (i18n.currentLocale !== 'en' || !href) return href;
    const root = new URL(portalRoot);
    const url = new URL(href, root);
    const prefix = root.pathname.replace(/\/$/, '');
    if (url.origin !== root.origin || !url.pathname.startsWith(`${prefix}/`)) return href;
    const route = url.pathname.slice(prefix.length);
    if (!localizedRoutes.has(route)) return href;
    url.pathname = `${prefix}/en${route}`;
    return url.href;
  };
}
