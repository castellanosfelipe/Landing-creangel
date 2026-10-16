"""Regression checks for crawl discovery files using a small bilingual website."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree as ET
import html
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl import Page, collect_pages, generate, is_indexable, validate


SITEMAP = 'http://www.sitemaps.org/schemas/sitemap/0.9'
XHTML = 'http://www.w3.org/1999/xhtml'
NS = {'s': SITEMAP, 'x': XHTML}


class CrawlDiscoveryTests(unittest.TestCase):
    base = 'https://portal.example.test'

    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = {'routes': ['/', '/en/', '/buscar/', '/404.html']}
        self.home_alternates = {
            'es-CO': self.base + '/',
            'en': self.base + '/en/',
            'x-default': self.base + '/',
        }
        self.write_page('/', alternates=self.home_alternates)
        self.write_page('/en/', alternates=self.home_alternates)
        self.write_page('/buscar/', robots='noindex,follow')
        self.write_page('/404.html', robots='noindex,follow')

    def write_page(self, route, *, alternates=None, robots=None, canonical=True):
        location = self.root / route.lstrip('/')
        if route.endswith('/'):
            location /= 'index.html'
        location.parent.mkdir(parents=True, exist_ok=True)
        head = ['<meta charset="utf-8"><title>Fixture</title>']
        if canonical:
            url = self.base + route if canonical is True else canonical
            head.append('<link rel="canonical" href="' + html.escape(url, quote=True) + '">')
        if robots:
            head.append('<meta name="robots" content="' + html.escape(robots, quote=True) + '">')
        for language, url in (alternates or {}).items():
            head.append('<link rel="alternate" hreflang="' + language + '" href="' + html.escape(url, quote=True) + '">')
        markup = '<!doctype html><html lang="en"><head>' + ''.join(head) + '</head><body><main><h1>Fixture</h1></main></body></html>'
        location.write_text(markup, encoding='utf-8', newline='\n')
        return location

    def generate(self):
        return generate(self.root, self.base, config=self.config)

    def validate(self):
        return validate(self.root, self.base, pages=collect_pages(self.root, config=self.config))

    def sitemap(self, relative='sitemap.xml'):
        return ET.parse(self.root / relative)

    def locations(self, relative='sitemap.xml'):
        return [entry.text for entry in self.sitemap(relative).findall('s:url/s:loc', NS)]

    def save_sitemap(self, tree):
        tree.write(self.root / 'sitemap.xml', encoding='utf-8', xml_declaration=True)

    def include_documentation(self):
        alternates = {
            'es-CO': self.base + '/documentacion/',
            'en': self.base + '/documentacion/en/',
            'x-default': self.base + '/documentacion/',
        }
        for locale in ['', 'en/']:
            self.write_page('/documentacion/' + locale, alternates=alternates)
            target = self.root / 'documentacion' / locale / 'sitemap.xml'
            target.write_text('<urlset xmlns="' + SITEMAP + '"></urlset>', encoding='utf-8')
        return alternates

    def test_only_indexable_canonical_pages_are_discoverable(self):
        self.assertIsInstance(self.generate(), dict)
        self.assertCountEqual(self.locations(), [self.base + '/', self.base + '/en/'])
        self.assertEqual(len(self.locations()), len(set(self.locations())))
        self.assertEqual(self.validate(), [])
        self.assertTrue(is_indexable(Page('<head><meta name="robots" content="index,follow"></head>')))
        self.assertFalse(is_indexable(Page('<head><meta name="robots" content="noindex,follow"></head>')))

    def test_sitemap_has_self_reciprocal_and_default_language_links(self):
        self.generate()
        for entry in self.sitemap().findall('s:url', NS):
            alternates = {node.get('hreflang'): node.get('href') for node in entry.findall('x:link', NS)}
            self.assertEqual(alternates, self.home_alternates)
            self.assertIn(entry.find('s:loc', NS).text, alternates.values())
            self.assertTrue(all(node.get('rel') == 'alternate' for node in entry.findall('x:link', NS)))

    def test_unrelated_metadata_does_not_affect_indexability(self):
        page = Page('<head><meta charset="utf-8"><meta name="robots" content="NOINDEX,follow"></head>')
        page.meta[None] = ['unrelated']
        self.assertFalse(is_indexable(page))

    def test_noindex_documents_remain_crawlable(self):
        self.generate()
        robots = RobotFileParser()
        robots.parse((self.root / 'robots.txt').read_text('utf-8').splitlines())
        for crawler in ['Googlebot', 'bingbot', '*']:
            for route in ['/', '/en/', '/buscar/', '/404.html', '/assets/site.css', '/assets/site.js']:
                with self.subTest(crawler=crawler, route=route):
                    self.assertTrue(robots.can_fetch(crawler, self.base + route))
        self.assertIn(self.base + '/sitemap.xml', robots.site_maps())

    def test_documentation_is_included_in_root_and_locale_sitemaps(self):
        alternates = self.include_documentation()
        self.generate()
        self.assertCountEqual(self.locations(), [
            self.base + '/', self.base + '/en/',
            self.base + '/documentacion/', self.base + '/documentacion/en/',
        ])
        self.assertEqual(self.locations('documentacion/sitemap.xml'), [self.base + '/documentacion/'])
        self.assertEqual(self.locations('documentacion/en/sitemap.xml'), [self.base + '/documentacion/en/'])
        for relative in ['documentacion/sitemap.xml', 'documentacion/en/sitemap.xml']:
            entry = self.sitemap(relative).find('s:url', NS)
            self.assertEqual({node.get('hreflang'): node.get('href') for node in entry.findall('x:link', NS)}, alternates)
        self.assertEqual(self.validate(), [])

    def test_validation_rejects_robots_blocking_indexable_pages(self):
        self.generate()
        (self.root / 'robots.txt').write_text('User-agent: *\nDisallow: /\nSitemap: ' + self.base + '/sitemap.xml\n', encoding='utf-8')
        errors = self.validate()
        self.assertTrue(any(error.get('error') == 'robots_blocks_indexable' for error in errors), errors)

    def test_specific_robots_block_takes_precedence_over_general_allow(self):
        self.generate()
        text = 'User-agent: *\nAllow: /\nDisallow: /en/\nSitemap: ' + self.base + '/sitemap.xml\n'
        (self.root / 'robots.txt').write_text(text, encoding='utf-8')
        errors = self.validate()
        self.assertTrue(any(error.get('error') == 'robots_blocks_indexable' for error in errors), errors)

    def test_validation_rejects_stale_documentation_locale_sitemap(self):
        self.include_documentation()
        self.generate()
        tree = self.sitemap('documentacion/en/sitemap.xml')
        tree.find('s:url/s:loc', NS).text = self.base + '/documentacion/en/removed-page/'
        tree.write(self.root / 'documentacion/en/sitemap.xml', encoding='utf-8', xml_declaration=True)
        self.assertTrue(self.validate())

    def test_validation_rejects_duplicate_sitemap_entries(self):
        self.generate()
        tree = self.sitemap()
        tree.getroot().append(deepcopy(tree.find('s:url', NS)))
        self.save_sitemap(tree)
        self.assertTrue(self.validate())

    def test_validation_rejects_noncanonical_sitemap_locations(self):
        self.generate()
        tree = self.sitemap()
        tree.find('s:url/s:loc', NS).text = self.base + '/index.html'
        self.save_sitemap(tree)
        self.assertTrue(self.validate())

    def test_validation_rejects_broken_sitemap_language_links(self):
        self.generate()
        tree = self.sitemap()
        alternate = tree.find('s:url/x:link', NS)
        self.assertIsNotNone(alternate)
        alternate.set('href', self.base + '/missing-translation/')
        self.save_sitemap(tree)
        self.assertTrue(self.validate())

    def test_generation_fails_for_missing_canonical(self):
        self.write_page('/', canonical=False, alternates=self.home_alternates)
        with self.assertRaises(ValueError):
            self.generate()

    def test_generation_fails_for_foreign_canonical(self):
        self.write_page('/', canonical='https://unrelated.example/', alternates=self.home_alternates)
        with self.assertRaises(ValueError):
            self.generate()

    def test_generation_fails_for_foreign_language_target(self):
        alternates = {**self.home_alternates, 'en': 'https://unrelated.example/en/'}
        self.write_page('/', alternates=alternates)
        with self.assertRaises(ValueError):
            self.generate()


if __name__ == '__main__':
    unittest.main()
