const siteRoot = (process.env.PUBLIC_SITE_URL || 'https://portal.creangel.com').replace(/\/+$/, '');
const publicUrl = new URL(siteRoot);
const rootLink = (pathname) => `${siteRoot}${pathname}`;

module.exports = {
  title: 'Documentación IFINDIT',
  tagline: 'Productos y capacidades de la plataforma IFINDIT',
  url: publicUrl.origin,
  baseUrl: '/documentacion/',
  trailingSlash: true,
  favicon: rootLink('/assets/favicon-32.png'),
  onBrokenLinks: 'throw',
  onDuplicateRoutes: 'throw',
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    localeConfigs: {
      es: {label: 'Español', htmlLang: 'es-CO'},
      en: {label: 'English', htmlLang: 'en'},
    },
  },
  markdown: {
    format: 'md',
    hooks: {onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw'},
  },
  presets: [['classic', {
    docs: {
      routeBasePath: '/',
      sidebarPath: require.resolve('./sidebars.js'),
      beforeDefaultRemarkPlugins: [[require('./plugins/remark-site-assets'), {siteRoot}]],
    },
    blog: false,
    pages: false,
    theme: {customCss: require.resolve('./src/css/custom.css')},
  }]],
  themeConfig: {
    image: rootLink('/assets/og-creangel.png'),
    colorMode: {defaultMode: 'light', disableSwitch: true, respectPrefersColorScheme: false},
    navbar: {
      title: 'Documentación',
      logo: {
        alt: 'Creangel',
        src: rootLink('/assets/logo-creangel.png'),
        href: rootLink('/'),
        width: 272,
        height: 67,
        style: {width: 'auto'},
      },
      items: [
        {type: 'docSidebar', sidebarId: 'documentation', label: 'IFINDIT', position: 'left'},
        {href: rootLink('/'), label: 'Sitio web', position: 'right', target: '_self'},
        {href: rootLink('/soporte/'), label: 'Soporte', position: 'right', target: '_self'},
        {type: 'localeDropdown', position: 'right'},
      ],
    },
    footer: {
      style: 'light',
      links: [
        {title: 'Creangel', items: [
          {label: 'Plataforma IFINDIT', href: rootLink('/plataforma/')},
          {label: 'Productos', href: rootLink('/productos/')},
        ]},
        {title: 'Recursos', items: [
          {label: 'Documentos', href: rootLink('/recursos/documentos/')},
          {label: 'Multimedia', href: rootLink('/recursos/multimedia/')},
        ]},
        {title: 'Contacto', items: [
          {label: 'Centro de soporte', href: rootLink('/soporte/')},
          {label: 'Solicitar demostración', href: rootLink('/contacto/')},
        ]},
      ],
      copyright: `© ${new Date().getFullYear()} Creangel Ltda.`,
    },
    tableOfContents: {minHeadingLevel: 2, maxHeadingLevel: 3},
  },
};
