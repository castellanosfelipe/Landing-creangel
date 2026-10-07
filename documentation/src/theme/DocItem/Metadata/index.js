import React from 'react';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {applyTrailingSlash} from '@docusaurus/utils-common';
import {TitleFormatterProvider, useTitleFormatter} from '@docusaurus/theme-common/internal';
import DocItemMetadata from '@theme-original/DocItem/Metadata';

function DocumentationSocialMetadata({title, description}) {
  const formattedTitle = useTitleFormatter().format(title);
  return (
    <Head>
      <meta name="twitter:title" content={formattedTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image:alt" content="Creangel · IFINDIT" />
      <meta property="og:image:alt" content="Creangel · IFINDIT" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:type" content="image/png" />
    </Head>
  );
}

export default function DocumentationMetadata(props) {
  const {metadata} = useDoc();
  const {siteConfig, i18n} = useDocusaurusContext();
  const siteUrl = siteConfig.url.replace(/\/+$/, '');
  const canonicalPath = applyTrailingSlash(metadata.permalink, {
    trailingSlash: siteConfig.trailingSlash,
    baseUrl: siteConfig.baseUrl,
  });
  const canonicalUrl = `${siteUrl}${canonicalPath}`;
  const organizationId = `${siteUrl}/#organization`;
  const websiteId = `${siteUrl}/#website`;
  const pageId = `${canonicalUrl}#webpage`;
  const articleId = `${canonicalUrl}#article`;
  const inLanguage = i18n.localeConfigs[i18n.currentLocale].htmlLang;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'Creangel Ltda.',
        url: `${siteUrl}/`,
        logo: {
          '@type': 'ImageObject',
          url: `${siteUrl}/assets/logo-creangel.png`,
        },
        email: 'soluciones@creangel.com',
        telephone: '+576012218097',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Carrera 36ª #54-44',
          addressLocality: 'Bogotá',
          addressCountry: 'CO',
        },
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: 'IFINDIT | Creangel',
        url: `${siteUrl}/`,
        publisher: {'@id': organizationId},
        inLanguage: ['es-CO', 'en'],
      },
      {
        '@type': 'WebPage',
        '@id': pageId,
        name: metadata.title,
        description: metadata.description,
        url: canonicalUrl,
        inLanguage,
        isPartOf: {'@id': websiteId},
        mainEntity: {'@id': articleId},
        publisher: {'@id': organizationId},
      },
      {
        '@type': 'TechArticle',
        '@id': articleId,
        headline: metadata.title,
        description: metadata.description,
        url: canonicalUrl,
        inLanguage,
        mainEntityOfPage: {'@id': pageId},
        publisher: {'@id': organizationId},
        image: siteConfig.themeConfig.image,
      },
    ],
  };

  return (
    <>
      <TitleFormatterProvider
        formatter={({defaultFormatter, ...params}) => defaultFormatter({
          ...params,
          siteTitle: i18n.currentLocale === 'en' ? 'IFINDIT Documentation' : params.siteTitle,
        })}>
        <DocItemMetadata {...props} />
        <DocumentationSocialMetadata title={metadata.title} description={metadata.description} />
      </TitleFormatterProvider>
      <Head>
        <meta property="og:type" content="article" />
        <script id="ifindit-documentation-schema" type="application/ld+json">
          {JSON.stringify(schema).replace(/</g, '\\u003c')}
        </script>
      </Head>
    </>
  );
}
