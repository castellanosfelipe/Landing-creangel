/**
 * Adapted from Docusaurus TOCItems, Copyright (c) Facebook, Inc. and affiliates.
 * Licensed under the MIT license.
 */
import React, {useMemo} from 'react';
import {useThemeConfig} from '@docusaurus/theme-common';
import {useFilteredAndTreeifiedTOC} from '@docusaurus/theme-common/internal';
import TOCItemTree from '@theme/TOCItems/Tree';
import useDocumentationTOCHighlight from '../../utils/useDocumentationTOCHighlight';

export default function TOCItems({
  toc,
  className = 'table-of-contents table-of-contents__left-border',
  linkClassName = 'table-of-contents__link',
  linkActiveClassName,
  minHeadingLevel: minHeadingLevelOption,
  maxHeadingLevel: maxHeadingLevelOption,
  ...props
}) {
  const themeConfig = useThemeConfig();
  const minHeadingLevel = minHeadingLevelOption ?? themeConfig.tableOfContents.minHeadingLevel;
  const maxHeadingLevel = maxHeadingLevelOption ?? themeConfig.tableOfContents.maxHeadingLevel;
  const tocTree = useFilteredAndTreeifiedTOC({toc, minHeadingLevel, maxHeadingLevel});
  const config = useMemo(() => linkClassName && linkActiveClassName
    ? {linkClassName, linkActiveClassName, minHeadingLevel, maxHeadingLevel}
    : undefined, [toc, linkClassName, linkActiveClassName, minHeadingLevel, maxHeadingLevel]);
  useDocumentationTOCHighlight(config);
  return <TOCItemTree toc={tocTree} className={className} linkClassName={linkClassName} {...props} />;
}
