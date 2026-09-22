import unittest
from unittest.mock import patch

from agent import agent_deployment, anam_api_key, avatar_id


class DeploymentTests(unittest.TestCase):
    def test_main_and_numbered_pr_deployments_are_allowed(self):
        for name in ('hana-gpt-live', 'hana-gpt-live-pr-1', 'hana-gpt-live-pr-12345'):
            with self.subTest(name=name), patch.dict('os.environ', {'LIVEKIT_AGENT_DEPLOYMENT': name}, clear=True):
                self.assertEqual(agent_deployment(), name)

    def test_production_unrelated_and_malformed_deployments_are_rejected(self):
        for name in ('', 'production', 'staging', 'hana-gpt-live-pr-', 'hana-gpt-live-pr-0',
                     'hana-gpt-live-pr-01', 'hana-gpt-live-pr--1', 'hana-gpt-live-pr-9\n',
                     'hana-gpt-live-extra', 'hana-gpt-live-pr-' + '9' * 64):
            with self.subTest(name=name), patch.dict('os.environ', {'LIVEKIT_AGENT_DEPLOYMENT': name}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'deployment'):
                    agent_deployment()


class AnamKeyTests(unittest.TestCase):
    def test_each_persona_uses_its_own_key(self):
        with patch.dict('os.environ', {
            'ANAM_API_KEY': 'test-hana-key',
            'ANAM_PIZZA_API_KEY': 'test-pizza-key',
        }, clear=True):
            self.assertEqual(anam_api_key(), 'test-hana-key')
            self.assertEqual(anam_api_key(pizza=True), 'test-pizza-key')

    def test_missing_key_never_falls_back_to_the_other_persona(self):
        for pizza, required, other in (
            (True, 'ANAM_PIZZA_API_KEY', 'ANAM_API_KEY'),
            (False, 'ANAM_API_KEY', 'ANAM_PIZZA_API_KEY'),
        ):
            with self.subTest(pizza=pizza), patch.dict('os.environ', {other: 'test-other-key'}, clear=True):
                with self.assertRaisesRegex(RuntimeError, required):
                    anam_api_key(pizza=pizza)

    def test_empty_pizza_key_is_rejected(self):
        for value in ('', '   '):
            with self.subTest(value=value), patch.dict('os.environ', {'ANAM_PIZZA_API_KEY': value}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'ANAM_PIZZA_API_KEY'):
                    anam_api_key(pizza=True)


class AvatarConfigTests(unittest.TestCase):
    def test_selects_the_requested_avatar_from_environment(self):
        with patch.dict('os.environ', {
            'ANAM_AVATAR_ID': 'hana-avatar',
            'ANAM_PIZZA_AVATAR_ID': 'pizza-avatar',
        }, clear=True):
            self.assertEqual(avatar_id(), 'hana-avatar')
            self.assertEqual(avatar_id(pizza=True), 'pizza-avatar')

    def test_missing_or_blank_avatar_does_not_use_the_other_demo(self):
        for pizza, required, other in (
            (True, 'ANAM_PIZZA_AVATAR_ID', 'ANAM_AVATAR_ID'),
            (False, 'ANAM_AVATAR_ID', 'ANAM_PIZZA_AVATAR_ID'),
        ):
            for missing in ({}, {required: ''}, {required: '   '}):
                with self.subTest(pizza=pizza, missing=missing), patch.dict(
                    'os.environ', {other: 'other-avatar', **missing}, clear=True
                ):
                    with self.assertRaisesRegex(RuntimeError, required):
                        avatar_id(pizza=pizza)


if __name__ == '__main__':
    unittest.main()
