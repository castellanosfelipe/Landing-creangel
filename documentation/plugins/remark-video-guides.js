const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

function youtubeVideoId(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\s\\]/.test(value) ||
      !/^https:\/\/(?:www\.youtube\.com|youtube\.com|youtu\.be)\//.test(value)) return null;
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

  let id;
  if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') {
    if (!/^https:\/\/(?:www\.)?youtube\.com\/watch\?/.test(value) ||
        url.pathname !== '/watch' || url.searchParams.getAll('v').length !== 1) return null;
    id = url.search.match(/[?&]v=([A-Za-z0-9_-]{11})(?:&|$)/)?.[1];
  } else if (url.hostname === 'youtu.be') {
    if (!/^https:\/\/youtu\.be\/[A-Za-z0-9_-]{11}(?:[?#]|$)/.test(value)) return null;
    id = url.pathname.slice(1);
  }
  return videoIdPattern.test(id || '') ? id : null;
}

function labelText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (!['link', 'emphasis', 'strong', 'delete'].includes(node.type)) return null;
  const parts = (node.children || []).map(labelText);
  return parts.includes(null) ? null : parts.join('');
}

// An ordinary Markdown link opts in to a player without allowing raw HTML or MDX.
module.exports = function remarkVideoGuides() {
  return (tree) => {
    function walk(node) {
      if (!node.children) return;
      const children = [];
      for (const child of node.children) {
        walk(child);
        if (child.type === 'paragraph' && child.children.length === 1 && child.children[0].type === 'link') {
          const link = child.children[0];
          const label = labelText(link);
          const id = youtubeVideoId(link.url);
          const title = label?.startsWith('Video:') ? label.slice('Video:'.length).trim() : '';
          if (id && title) {
            children.push({
              type: 'paragraph',
              children: [],
              data: {
                hName: 'iframe',
                hProperties: {
                  src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
                  title,
                  loading: 'lazy',
                  width: 560,
                  height: 315,
                  className: ['documentation-video'],
                  allowFullScreen: true,
                  allow: 'encrypted-media; picture-in-picture; fullscreen',
                  referrerPolicy: 'strict-origin-when-cross-origin',
                },
              },
            });
          }
        }
        children.push(child);
      }
      node.children = children;
    }
    walk(tree);
  };
};
