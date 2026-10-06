import React from 'react';
import FooterLinkItem from '@theme-original/Footer/LinkItem';
import usePortalHref from '../../../hooks/usePortalHref';

export default function LocalizedFooterLinkItem({item, ...props}) {
  const portalHref = usePortalHref();
  return <FooterLinkItem {...props} item={{...item, href: portalHref(item.href)}} />;
}
