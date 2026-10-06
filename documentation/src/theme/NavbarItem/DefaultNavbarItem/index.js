import React from 'react';
import DefaultNavbarItem from '@theme-original/NavbarItem/DefaultNavbarItem';
import usePortalHref from '../../../hooks/usePortalHref';

export default function LocalizedNavbarItem(props) {
  const portalHref = usePortalHref();
  return <DefaultNavbarItem {...props} href={portalHref(props.href)} />;
}
