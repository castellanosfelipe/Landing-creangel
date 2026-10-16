"""Crawl-rule matching for SEO checks (RFC 9309 and Google path precedence).

This evaluates the Allow/Disallow subset, not network errors or crawl rate.
References: https://www.rfc-editor.org/rfc/rfc9309.html and
https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
"""

from functools import lru_cache
from urllib.parse import quote, urlsplit
import re


@lru_cache(maxsize=16)
def _groups(text):
    groups = []
    agents = []
    rules = []
    has_rule = False
    for raw in text.lstrip('\ufeff').splitlines():
        line = raw.split('#', 1)[0]
        if ':' not in line:
            continue
        field, value = (part.strip() for part in line.split(':', 1))
        field = field.lower()
        if field == 'user-agent':
            if has_rule:
                groups.append((tuple(agents), tuple(rules)))
                agents, rules, has_rule = [], [], False
            if value == '*':
                agents.append('*')
            else:
                token = re.match(r'[A-Za-z_-]+', value)
                if token:
                    agents.append(token[0].lower())
        elif field in ('allow', 'disallow') and agents:
            has_rule = True
            if value.startswith('/'):
                rules.append((field == 'allow', value))
    if agents:
        groups.append((tuple(agents), tuple(rules)))
    return tuple(groups)


def _normalize(value, *, pattern=False):
    # Preserve escaped reserved octets; normalize unreserved escapes and UTF-8.
    safe = "/?&=:+,;@!'()[]%-._~" + ('*' if pattern else '')
    value = quote(value, safe=safe)

    def escaped(match):
        char = chr(int(match[0][1:], 16))
        return char if char.isascii() and (char.isalnum() or char in '-._~') else match[0].upper()

    return re.sub(r'%[0-9A-Fa-f]{2}', escaped, value)


@lru_cache(maxsize=256)
def _rule_matcher(value):
    anchored = value.endswith('$')
    body = value[:-1] if anchored else value.rstrip('*')
    body = _normalize(body, pattern=True)
    expression = '^' + re.escape(body).replace(r'\*', '.*') + ('$' if anchored else '')
    return re.compile(expression), len(body) + int(anchored)


@lru_cache(maxsize=128)
def _rules_for(text, agent):
    selected = []
    longest = -1
    for agents, rules in _groups(text):
        lengths = [len(token) for token in agents if token != '*' and token in agent]
        specificity = max(lengths, default=0 if '*' in agents else -1)
        if specificity > longest:
            selected, longest = list(rules), specificity
        elif specificity == longest and specificity >= 0:
            selected.extend(rules)
    return tuple(selected)


def allows(text, agent, url):
    """Return whether a crawler may fetch URL under the matching robots group."""
    target = urlsplit(url)
    path = _normalize((target.path or '/') + ('?' + target.query if target.query else ''))
    if target.path == '/robots.txt':
        return True
    matched = []
    for allowed, value in _rules_for(text, agent.lower()):
        matcher, specificity = _rule_matcher(value)
        if matcher.match(path):
            matched.append((specificity, allowed))
    # More specific paths win; Allow wins a tie regardless of record order.
    return max(matched, default=(-1, True))[1]
