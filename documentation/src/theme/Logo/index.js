import React from 'react';
import Logo from '@theme-original/Logo';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import usePortalHref from '../../hooks/usePortalHref';

export default function LocalizedLogo(props) {
  const {siteConfig} = useDocusaurusContext();
  const portalHref = usePortalHref();
  return <Logo {...props} to={portalHref(siteConfig.themeConfig.navbar.logo.href)} />;
}
