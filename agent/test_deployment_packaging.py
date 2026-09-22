"""Guard the explicit Docker file allowlist against missing local Python imports."""

import ast
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


AGENT_DIR = Path(__file__).resolve().parent


def copied_files():
    sources = set()
    for line in (AGENT_DIR / 'Dockerfile').read_text().splitlines():
        tokens = shlex.split(line)
        if tokens and tokens[0] == 'COPY':
            sources.update(tokens[1:-1])
    return sources


def allowed_files():
    # This deployment deliberately uses a deny-all plus explicit filename allowlist.
    rules = [line.strip() for line in (AGENT_DIR / '.dockerignore').read_text().splitlines()
             if line.strip() and not line.startswith('#')]
    if not rules or rules[0] != '*':
        raise AssertionError('Review packaging tests when changing the deny-all Docker context')
    return {rule[1:] for rule in rules[1:] if rule.startswith('!')}


class DeploymentPackagingTests(unittest.TestCase):
    def test_local_imports_are_copied_and_allowed(self):
        pending = ['agent.py']
        checked = set()
        copied, allowed = copied_files(), allowed_files()
        while pending:
            filename = pending.pop()
            if filename in checked:
                continue
            checked.add(filename)
            self.assertIn(filename, copied, f'Dockerfile omits {filename}')
            self.assertIn(filename, allowed, f'.dockerignore excludes {filename}')
            for node in ast.walk(ast.parse((AGENT_DIR / filename).read_text())):
                modules = [node.module] if isinstance(node, ast.ImportFrom) else (
                    [alias.name for alias in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    sibling = f'{module}.py'
                    if module and (AGENT_DIR / sibling).is_file():
                        pending.append(sibling)

    def test_import_from_packaged_files_without_source_directory(self):
        with tempfile.TemporaryDirectory(prefix='hana-agent-package-') as stage:
            for filename in copied_files() & allowed_files():
                if filename.endswith('.py'):
                    shutil.copy2(AGENT_DIR / filename, Path(stage) / filename)
            result = subprocess.run(
                [sys.executable, '-c',
                 'import agent; from pathlib import Path; '
                 'assert Path(agent.__file__).resolve().parent == Path.cwd()'],
                cwd=stage, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
