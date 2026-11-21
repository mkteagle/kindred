import time
import unittest
from unittest.mock import MagicMock
import jwt
from fastapi import HTTPException
from social_auth import exchange_identity

SECRET = 'kindred-test-bridge-secret-never-production'


class SocialAuthTests(unittest.TestCase):
    def assertion(self, **claims):
        payload = dict(iss='kindred-web', aud='kindred-backend', sub='external-id',
                       iat=int(time.time()), exp=int(time.time()) + 60,
                       jti='single-use-id', provider='google')
        return jwt.encode({**payload, **claims}, SECRET, algorithm='HS256')

    def connection(self, results):
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value.fetchone.side_effect = results
        return conn

    def test_untrusted_and_expired_assertions_never_reach_database(self):
        for assertion in ('not-a-token', jwt.encode(dict(iss='kindred-web', aud='kindred-backend', sub='external-id',
                         iat=1, exp=2, jti='old', provider='google'), SECRET, algorithm='HS256'),
                         self.assertion()[:-8] + 'tampered'):
            connect = MagicMock()
            with self.assertRaises(HTTPException) as error:
                exchange_identity(assertion, SECRET, connect, MagicMock())
            self.assertEqual(error.exception.status_code, 401)
            connect.assert_not_called()

    def test_replay_does_not_create_a_session(self):
        conn = self.connection([None])
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(), SECRET, lambda: conn, create)
        self.assertEqual(error.exception.status_code, 401)
        create.assert_not_called()
        conn.close.assert_called_once()

    def test_existing_identity_keeps_its_household_role(self):
        conn = self.connection([{'id': 'single-use-id'}, {'id': 'member-id', 'username': 'member', 'display_name': 'Member', 'role': 'member'}])
        create = MagicMock(return_value={'token': 'session'})
        result = exchange_identity(self.assertion(), SECRET, lambda: conn, create)
        self.assertEqual(result['user']['role'], 'member')
        create.assert_called_once_with('member-id')
        conn.close.assert_called_once()

    def test_same_email_does_not_auto_link_or_join_existing_household(self):
        conn = self.connection([{'id': 'single-use-id'}, None, {'n': 1}])
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(email='owner@example.com'), SECRET, lambda: conn, create)
        self.assertEqual(error.exception.detail, 'account_not_linked')
        create.assert_not_called()

    def test_owner_approved_verified_email_links_the_existing_account(self):
        user = {'id': 'jen-existing', 'username': 'jen.a.jarrett', 'display_name': 'Jennifer', 'role': 'admin'}
        conn = self.connection([{'id': 'single-use-id'}, None,
                                {'user_id': 'jen-existing', 'linked_subject': None}, user, None])
        create = MagicMock(return_value={'token': 'linked-session'})
        result = exchange_identity(self.assertion(email='JEN.A.JARRETT@gmail.com', email_verified=True), SECRET, lambda: conn, create)
        self.assertEqual(result['user']['id'], 'jen-existing')
        self.assertEqual(result['user']['role'], 'admin')
        create.assert_called_once_with('jen-existing')

    def test_verified_email_without_owner_approval_cannot_join(self):
        conn = self.connection([{'id': 'single-use-id'}, None, None, {'n': 1}])
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(email='unapproved@example.com', email_verified=True), SECRET, lambda: conn, create)
        self.assertEqual(error.exception.detail, 'account_not_linked')
        create.assert_not_called()

    def test_email_approval_cannot_be_reused_for_another_provider_subject(self):
        conn = self.connection([{'id': 'single-use-id'}, None,
                                {'user_id': 'jen-existing', 'linked_subject': 'different-subject'}])
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(email='jen.a.jarrett@gmail.com', email_verified=True), SECRET, lambda: conn, MagicMock())
        self.assertEqual(error.exception.status_code, 409)

    def test_link_requires_the_original_authenticated_account(self):
        conn = self.connection([{'id': 'single-use-id'}, None])
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(link_user_id='owner'), SECRET, lambda: conn, create, {'user_id': 'someone-else'})
        self.assertEqual(error.exception.status_code, 403)
        create.assert_not_called()

    def test_identity_cannot_be_taken_from_another_account(self):
        conn = self.connection([{'id': 'single-use-id'}, {'id': 'another-account'}])
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(link_user_id='owner'), SECRET, lambda: conn, create, {'user_id': 'owner'})
        self.assertEqual(error.exception.status_code, 409)
        create.assert_not_called()

    def test_verified_apple_email_links_to_the_existing_google_account(self):
        user = {'id': 'existing', 'username': 'owner', 'display_name': 'Owner', 'role': 'admin'}
        conn = self.connection([{'id': 'single-use-id'}, None, None])
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [{**user, 'apple_subject': None}]
        create = MagicMock(return_value={'token': 'session'})
        result = exchange_identity(self.assertion(provider='apple', email='Owner@gmail.com', email_verified=True),
                                   SECRET, lambda: conn, create)
        self.assertEqual(result['user'], user)
        create.assert_called_once_with('existing')
        self.assertEqual(cursor.execute.call_args.args[1], ('apple', 'external-id', 'existing', 'owner@gmail.com'))

    def test_unverified_relay_and_third_party_email_do_not_trigger_auto_link(self):
        for claims in (
            dict(email='owner@gmail.com', email_verified=False),
            dict(email='owner@privaterelay.appleid.com', email_verified=True),
            dict(email='owner@private.icloud.com', email_verified=True),
            dict(email='owner@example.com', email_verified=True),
            dict(email='owner@gmail.com', email_verified=True, private_email=True),
        ):
            with self.subTest(claims=claims):
                approvals = [None] if claims['email_verified'] else []
                conn = self.connection([{'id': 'single-use-id'}, None, *approvals, {'n': 1}])
                with self.assertRaises(HTTPException) as error:
                    exchange_identity(self.assertion(provider='apple', **claims), SECRET, lambda: conn, MagicMock())
                self.assertEqual(error.exception.detail, 'account_not_linked')
                conn.cursor.return_value.__enter__.return_value.fetchall.assert_not_called()

    def test_a_google_account_with_an_existing_apple_link_cannot_be_reassigned(self):
        conn = self.connection([{'id': 'single-use-id'}, None, None])
        conn.cursor.return_value.__enter__.return_value.fetchall.return_value = [{'id': 'existing', 'apple_subject': 'other'}]
        create = MagicMock()
        with self.assertRaises(HTTPException) as error:
            exchange_identity(self.assertion(provider='apple', email='owner@gmail.com', email_verified=True),
                              SECRET, lambda: conn, create)
        self.assertEqual(error.exception.status_code, 409)
        create.assert_not_called()
