// CMS media live at the marketing site's root, outside Docusaurus's base URL.
module.exports = function remarkSiteAssets({siteRoot}) {
  return (tree) => {
    function walk(node) {
      if (['link', 'image', 'definition'].includes(node.type) &&
          typeof node.url === 'string' && node.url.startsWith('/') &&
          !node.url.startsWith('//')) {
        node.url = `${siteRoot}${node.url}`;
      }
      for (const child of node.children || []) walk(child);
    }
    walk(tree);
  };
};
