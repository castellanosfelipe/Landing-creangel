"""Meaningful robots crawl decisions independent of record ordering."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from robots_rules import allows


class RobotsRulesTests(unittest.TestCase):
    def allowed(self, text, path, agent='Googlebot'):
        return allows(text, agent, 'https://portal.example.test' + path)

    def test_longest_path_wins_and_equal_allow_wins(self):
        for rules in [
            'Allow: /\nDisallow: /productos/\nAllow: /productos/publico/',
            'Allow: /productos/publico/\nDisallow: /productos/\nAllow: /',
        ]:
            text = 'User-agent: *\n' + rules
            self.assertFalse(self.allowed(text, '/productos/privado/'))
            self.assertTrue(self.allowed(text, '/productos/publico/'))
            self.assertTrue(self.allowed(text, '/contacto/'))
        for rules in ['Allow: /docs\nDisallow: /docs', 'Disallow: /docs\nAllow: /docs']:
            self.assertTrue(self.allowed('User-agent: *\n' + rules, '/docs/pagina/'))

    def test_most_specific_agent_replaces_wildcard_and_broader_agent(self):
        text = ('User-agent: *\nDisallow: /\n'
                'User-agent: Googlebot\nDisallow: /general/\n'
                'User-agent: Googlebot-News\nDisallow: /noticias/\n')
        self.assertFalse(self.allowed(text, '/general/'))
        self.assertTrue(self.allowed(text, '/noticias/'))
        self.assertTrue(self.allowed(text, '/general/', 'Googlebot-News'))
        self.assertFalse(self.allowed(text, '/noticias/', 'Googlebot-News'))
        self.assertFalse(self.allowed(text, '/', 'bingbot'))

    def test_multiple_matching_groups_and_joint_agents_are_merged(self):
        text = ('User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /uno/\n'
                'User-agent: googlebot\nDisallow: /dos/\n'
                'User-agent: *\nDisallow: /tres/\n')
        self.assertFalse(self.allowed(text, '/uno/'))
        self.assertFalse(self.allowed(text, '/dos/'))
        self.assertTrue(self.allowed(text, '/tres/'))
        self.assertFalse(self.allowed(text, '/uno/', 'BINGBOT'))
        self.assertTrue(self.allowed(text, '/dos/', 'BINGBOT'))

    def test_comments_bom_case_and_empty_rules(self):
        text = '\ufeffuSeR-aGeNt: GOOGLEBOT # comment\nDisallow:\nAllow:\nDisAllow: /Privado/ # comment\n'
        self.assertTrue(self.allowed(text, '/'))
        self.assertFalse(self.allowed(text, '/Privado/'))
        self.assertTrue(self.allowed(text, '/privado/'))
        self.assertTrue(self.allowed('User-agent: Googlebot\n', '/'))
        self.assertTrue(self.allowed('Disallow: /\n', '/'))

    def test_unknown_records_do_not_split_joint_agents(self):
        text = 'User-agent: Googlebot\nSitemap: https://portal.example.test/sitemap.xml\n\nUser-agent: Bingbot\nDisallow: /\n'
        self.assertFalse(self.allowed(text, '/'))
        self.assertFalse(self.allowed(text, '/', 'Bingbot'))

    def test_wildcards_end_marker_and_query_matching(self):
        text = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?preview=*\n'
        self.assertFalse(self.allowed(text, '/docs/guia.pdf'))
        self.assertTrue(self.allowed(text, '/docs/guia.pdf?download=1'))
        self.assertFalse(self.allowed(text, '/producto/?preview=1'))
        self.assertTrue(self.allowed(text, '/docs/guia.PDF'))
        self.assertTrue(self.allowed(text, '/docs/guia.pdf.html'))
        root = 'User-agent: *\nDisallow: /\nAllow: /$\n'
        self.assertTrue(self.allowed(root, '/'))
        self.assertFalse(self.allowed(root, '/producto/'))

    def test_utf8_and_percent_encoded_paths_are_equivalent(self):
        text = 'User-agent: *\nDisallow: /documentación/\nDisallow: /foo/bar\nDisallow: /encoded%2Fsegment\n'
        self.assertFalse(self.allowed(text, '/documentación/'))
        self.assertFalse(self.allowed(text, '/documentaci%C3%B3n/'))
        self.assertFalse(self.allowed(text, '/foo/%62ar'))
        self.assertFalse(self.allowed(text, '/encoded%2fsegment'))
        self.assertTrue(self.allowed(text, '/encoded/segment'))

    def test_google_path_precedence_examples(self):
        text = 'User-agent: *\nAllow: /page\nDisallow: /*.htm\n'
        self.assertFalse(self.allowed(text, '/page.htm'))
        text = 'User-agent: *\nAllow: /page\nDisallow: /*.ph\n'
        self.assertTrue(self.allowed(text, '/page.php5'))
        self.assertTrue(self.allowed('User-agent: *\nDisallow: /\n', '/robots.txt'))


if __name__ == '__main__':
    unittest.main()
